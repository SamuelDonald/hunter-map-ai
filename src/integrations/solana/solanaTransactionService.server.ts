// SolanaTransactionService — owns the whole transaction lifecycle:
// REQUEST -> VALIDATE -> BUILD -> SIMULATE -> RISK CHECK -> SIGN -> SUBMIT
// -> CONFIRM -> RECONCILE -> PERSIST.
//
// No React component, execution provider or route duplicates any of this. A
// failed validation, simulation or risk check stops the pipeline before signing.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { SOL_LAMPORTS, getNetworkConfig } from "./solanaConfig.server";
import { evaluateExecutionReadiness } from "./solanaExecutionGate.server";
import { getRpcProvider, type SolanaRpcProvider } from "./solanaRpc.server";
import { getSignerProvider } from "./solanaSigner.server";
import { SolanaWalletService, monitorWalletBalance } from "./solanaWalletService.server";

type Client = SupabaseClient<Database>;

export type TxStatus =
  | "REQUESTED" | "VALIDATED" | "BUILT" | "SIMULATED" | "SIGNED" | "SUBMITTED"
  | "CONFIRMING" | "CONFIRMED" | "FINALIZED" | "FAILED" | "SUBMITTED_UNKNOWN" | "REJECTED";

export type TransactionRequest = {
  userId: string;
  /** Idempotency is mandatory: one request can only ever produce one signature. */
  idempotencyKey: string;
  purpose: string;
  executionProvider: string;
  orderId?: string | null;
  positionId?: string | null;
  strategyId?: string | null;
  tokenId?: string | null;
  /** Instructions are built from the fee payer, never from client input. */
  build: (signer: KeyPairSigner) => Promise<Instruction[]> | Instruction[];
  /** Extra lamports the transaction is expected to spend, used for balance checks. */
  expectedLamportsSpend?: number;
  /** Strategy slippage in percent; exceeding the cap rejects the request. */
  requestedSlippage?: number;
  slippageCap?: number;
  /** Optional additional risk gate evaluated before signing. */
  riskCheck?: () => Promise<{ approved: boolean; reasons: string[] }>;
};

export type TransactionOutcome = {
  transactionId: string | null;
  status: TxStatus;
  signature: string | null;
  slot: number | null;
  fee: number | null;
  confirmationLevel: "processed" | "confirmed" | "finalized" | null;
  reconciliationStatus: "PENDING" | "RECONCILED" | "MISMATCH" | "UNRECONCILABLE" | "NOT_APPLICABLE";
  errorCode: string | null;
  errorMessage: string | null;
  simulation: { success: boolean; error: string | null; errorCode: string | null; unitsConsumed: number | null } | null;
  reasons: string[];
};

export class SolanaTransactionService {
  private readonly rpc: SolanaRpcProvider;
  private readonly wallets: SolanaWalletService;

  constructor(rpc: SolanaRpcProvider = getRpcProvider()) {
    this.rpc = rpc;
    this.wallets = new SolanaWalletService(rpc);
  }

  async execute(supabase: Client, request: TransactionRequest): Promise<TransactionOutcome> {
    const config = getNetworkConfig();
    const fail = (status: TxStatus, code: string, reasons: string[], extra: Partial<TransactionOutcome> = {}): TransactionOutcome => ({
      transactionId: null, status, signature: null, slot: null, fee: null, confirmationLevel: null,
      reconciliationStatus: "NOT_APPLICABLE", errorCode: code, errorMessage: reasons.join(", "),
      simulation: null, reasons, ...extra,
    });

    // ---------------------------------------------------------------- REQUEST
    // Idempotency: an existing record for this key is returned as-is. A prior
    // submission is never blindly resubmitted.
    const { data: existing } = await supabase
      .from("solana_transactions")
      .select("*")
      .eq("idempotency_key", request.idempotencyKey)
      .maybeSingle();
    if (existing) {
      return {
        transactionId: existing.id,
        status: existing.status as TxStatus,
        signature: existing.signature,
        slot: existing.slot === null ? null : Number(existing.slot),
        fee: existing.fee_lamports === null ? null : Number(existing.fee_lamports),
        confirmationLevel: existing.confirmation_level as TransactionOutcome["confirmationLevel"],
        reconciliationStatus: existing.reconciliation_status as TransactionOutcome["reconciliationStatus"],
        errorCode: existing.error_code,
        errorMessage: existing.error_message,
        simulation: null,
        reasons: ["DUPLICATE_REQUEST_IGNORED"],
      };
    }

    if (request.orderId) {
      const { data: orderTx } = await supabase
        .from("solana_transactions")
        .select("id")
        .eq("order_id", request.orderId)
        .not("status", "in", "(REJECTED,FAILED)")
        .maybeSingle();
      if (orderTx) return fail("REJECTED", "DUPLICATE_ORDER_TRANSACTION", ["ORDER_ALREADY_HAS_TRANSACTION"]);
    }

    const { data: row, error: insertError } = await supabase
      .from("solana_transactions")
      .insert({
        user_id: request.userId,
        strategy_id: request.strategyId ?? null,
        order_id: request.orderId ?? null,
        position_id: request.positionId ?? null,
        token_id: request.tokenId ?? null,
        execution_provider: request.executionProvider,
        cluster: config.cluster,
        purpose: request.purpose,
        idempotency_key: request.idempotencyKey,
        status: "REQUESTED",
      })
      .select("id")
      .single();
    if (insertError || !row) return fail("REJECTED", "PERSIST_FAILED", [insertError?.message ?? "INSERT_FAILED"]);
    const id = row.id;

    const update = async (patch: Database["public"]["Tables"]["solana_transactions"]["Update"]) => {
      await supabase.from("solana_transactions").update(patch).eq("id", id);
    };
    const reject = async (code: string, reasons: string[], status: TxStatus = "REJECTED"): Promise<TransactionOutcome> => {
      await update({ status, error_code: code, error_message: reasons.join(", "), reconciliation_status: "NOT_APPLICABLE" });
      await this.logFailure(supabase, request, code, reasons.join(", "));
      return { ...fail(status, code, reasons), transactionId: id };
    };

    // --------------------------------------------------------------- VALIDATE
    const readiness = await evaluateExecutionReadiness(supabase, request.userId);
    if (!readiness.signingAllowed) return reject("EXECUTION_NOT_PERMITTED", readiness.reasons);

    if (request.requestedSlippage !== undefined && request.slippageCap !== undefined && request.requestedSlippage > request.slippageCap) {
      await supabase.from("risk_events").insert({
        user_id: request.userId, strategy_id: request.strategyId ?? null, token_id: request.tokenId ?? null,
        order_id: request.orderId ?? null, event_type: "HIGH_SLIPPAGE", severity: "WARNING",
        message: `Required slippage ${request.requestedSlippage}% exceeds the configured maximum ${request.slippageCap}%`,
        metadata: { component: "SOLANA_TRANSACTION" },
      });
      return reject("SLIPPAGE_ABOVE_MAX", [`SLIPPAGE_ABOVE_MAX_${request.slippageCap}`]);
    }

    const signer = await getSignerProvider().getSigner();
    if (!signer) return reject("SIGNER_UNAVAILABLE", ["EXECUTION_WALLET_SECRET_NOT_CONFIGURED"]);

    const snapshot = await this.wallets.getExecutionWalletSnapshot(supabase, request.userId, {
      blocked: readiness.emergencyBlock === "ENABLED" && readiness.liveExecutionAvailable,
    });
    await monitorWalletBalance(supabase, request.userId, snapshot);
    if (snapshot.state !== "READY" && snapshot.state !== "CONFIGURED") {
      return reject("WALLET_NOT_READY", [`WALLET_STATE_${snapshot.state}`, ...snapshot.reasons]);
    }
    const requiredLamports = (request.expectedLamportsSpend ?? 0) + 10_000;
    const reserveLamports = Math.floor(snapshot.minSolReserve * SOL_LAMPORTS);
    if ((snapshot.lamports ?? 0) - requiredLamports < 0) {
      return reject("INSUFFICIENT_BALANCE", ["INSUFFICIENT_SOL_FOR_TRANSACTION"]);
    }
    if ((snapshot.lamports ?? 0) - requiredLamports < reserveLamports) {
      return reject("BELOW_MIN_SOL_RESERVE", [`SOL_RESERVE_WOULD_BE_BREACHED_${snapshot.minSolReserve}`]);
    }
    await update({ status: "VALIDATED" });

    // ------------------------------------------------------------------ BUILD
    const blockhashResult = await this.rpc.getLatestBlockhash();
    if (!blockhashResult.ok) return reject("BLOCKHASH_UNAVAILABLE", [blockhashResult.error]);
    let wireBase64: string;
    let instructions: Instruction[];
    try {
      instructions = await request.build(signer);
      if (instructions.length === 0) return reject("NO_INSTRUCTIONS", ["TRANSACTION_HAS_NO_INSTRUCTIONS"]);
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(signer, m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: blockhashResult.data.blockhash as Blockhash,
              lastValidBlockHeight: BigInt(blockhashResult.data.lastValidBlockHeight),
            },
            m,
          ),
        (m) => appendTransactionMessageInstructions(instructions, m),
      );
      wireBase64 = getBase64EncodedWireTransaction(compileTransaction(message));
      await update({ status: "BUILT", blockhash: blockhashResult.data.blockhash });

      // ------------------------------------------------------------- SIMULATE
      const simulation = await this.rpc.simulateTransaction(wireBase64);
      if (!simulation.ok) return reject("SIMULATION_UNAVAILABLE", [simulation.error]);
      await update({
        simulation: {
          success: simulation.data.success,
          error: simulation.data.error,
          error_code: simulation.data.errorCode,
          units_consumed: simulation.data.unitsConsumed,
          logs: simulation.data.logs.slice(-20),
        },
        compute_units_consumed: simulation.data.unitsConsumed,
        status: simulation.data.success ? "SIMULATED" : "REJECTED",
      });
      if (!simulation.data.success) {
        const outcome = await reject(simulation.data.errorCode ?? "SIMULATION_FAILED", ["SIMULATION_FAILED"]);
        return { ...outcome, simulation: { success: false, error: simulation.data.error, errorCode: simulation.data.errorCode, unitsConsumed: simulation.data.unitsConsumed } };
      }

      // ------------------------------------------------------------ RISK CHECK
      if (request.riskCheck) {
        const decision = await request.riskCheck();
        if (!decision.approved) return reject("RISK_REJECTED", decision.reasons);
      }
      // Re-check the gates: the kill switch may have flipped during simulation.
      const recheck = await evaluateExecutionReadiness(supabase, request.userId);
      if (!recheck.signingAllowed) return reject("EXECUTION_NOT_PERMITTED", recheck.reasons);

      // ------------------------------------------------------------------ SIGN
      const signed = await signTransactionMessageWithSigners(message);
      const signature = getSignatureFromTransaction(signed);
      await update({ status: "SIGNED", signature });

      // ---------------------------------------------------------------- SUBMIT
      const submission = await this.rpc.sendTransaction(getBase64EncodedWireTransaction(signed));
      if (!submission.ok) {
        await update({ status: "FAILED", error_code: "SUBMISSION_FAILED", error_message: submission.error });
        await this.logFailure(supabase, request, "SUBMISSION_FAILED", submission.error);
        return { ...fail("FAILED", "SUBMISSION_FAILED", [submission.error]), transactionId: id, signature };
      }
      await update({ status: "SUBMITTED", submitted_at: new Date().toISOString(), signature: submission.data });

      // --------------------------------------------------------------- CONFIRM
      const confirmation = await this.confirm(submission.data);
      if (confirmation.status === "UNKNOWN") {
        await update({ status: "SUBMITTED_UNKNOWN", error_code: "CONFIRMATION_TIMEOUT", error_message: "Confirmation timed out; reconciling from chain" });
        await this.logFailure(supabase, request, "CONFIRMATION_TIMEOUT", "Confirmation timed out");
      } else if (confirmation.status === "FAILED") {
        await update({ status: "FAILED", error_code: "TRANSACTION_FAILED", error_message: confirmation.err ?? "Transaction failed on chain", slot: confirmation.slot });
      } else {
        await update({
          status: confirmation.status === "FINALIZED" ? "FINALIZED" : "CONFIRMED",
          confirmation_level: confirmation.level,
          confirmed_at: new Date().toISOString(),
          slot: confirmation.slot,
        });
      }

      // ------------------------------------------------------------- RECONCILE
      const reconciliation = await this.reconcile(submission.data);
      await update({
        reconciliation_status: reconciliation.status,
        reconciliation: reconciliation.detail,
        reconciled_at: new Date().toISOString(),
        fee_lamports: reconciliation.fee,
        slot: reconciliation.slot ?? confirmation.slot,
        ...(reconciliation.status === "RECONCILED" && confirmation.status === "UNKNOWN"
          ? { status: reconciliation.onChainSucceeded ? "CONFIRMED" : "FAILED" }
          : {}),
      });

      const { data: finalRow } = await supabase.from("solana_transactions").select("*").eq("id", id).single();
      return {
        transactionId: id,
        status: (finalRow?.status ?? "SUBMITTED_UNKNOWN") as TxStatus,
        signature: submission.data,
        slot: finalRow?.slot === null || finalRow?.slot === undefined ? null : Number(finalRow.slot),
        fee: reconciliation.fee,
        confirmationLevel: confirmation.level,
        reconciliationStatus: reconciliation.status,
        errorCode: finalRow?.error_code ?? null,
        errorMessage: finalRow?.error_message ?? null,
        simulation: { success: true, error: null, errorCode: null, unitsConsumed: simulation.data.unitsConsumed },
        reasons: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reject("PIPELINE_ERROR", [message], "FAILED");
    }
  }

  /** Real confirmation — a signature alone never counts as success. */
  async confirm(signature: string): Promise<{
    status: "CONFIRMED" | "FINALIZED" | "FAILED" | "UNKNOWN";
    level: "processed" | "confirmed" | "finalized" | null;
    slot: number | null;
    err: string | null;
  }> {
    const config = getNetworkConfig();
    const deadline = Date.now() + config.confirmationTimeoutMs;
    while (Date.now() < deadline) {
      const statuses = await this.rpc.getSignatureStatuses([signature]);
      const state = statuses.ok ? statuses.data[0] : undefined;
      if (state?.found) {
        if (state.err) return { status: "FAILED", level: state.confirmationStatus, slot: state.slot, err: state.err };
        if (state.confirmationStatus === "finalized") return { status: "FINALIZED", level: "finalized", slot: state.slot, err: null };
        if (state.confirmationStatus === "confirmed") return { status: "CONFIRMED", level: "confirmed", slot: state.slot, err: null };
      }
      await new Promise((resolve) => setTimeout(resolve, config.confirmationPollIntervalMs));
    }
    return { status: "UNKNOWN", level: null, slot: null, err: null };
  }

  /** The chain is authoritative: settlement is read back from the transaction. */
  async reconcile(signature: string): Promise<{
    status: "RECONCILED" | "MISMATCH" | "UNRECONCILABLE";
    onChainSucceeded: boolean;
    fee: number | null;
    slot: number | null;
    detail: Json;
  }> {
    const tx = await this.rpc.getTransaction(signature);
    if (!tx.ok) return { status: "UNRECONCILABLE", onChainSucceeded: false, fee: null, slot: null, detail: { error: tx.error } };
    if (!tx.data.found) {
      return { status: "UNRECONCILABLE", onChainSucceeded: false, fee: null, slot: null, detail: { reason: "TRANSACTION_NOT_FOUND_ON_CHAIN" } };
    }
    const succeeded = tx.data.err === null;
    const solDelta = (tx.data.postBalances[0] ?? 0) - (tx.data.preBalances[0] ?? 0);
    return {
      status: "RECONCILED",
      onChainSucceeded: succeeded,
      fee: tx.data.fee,
      slot: tx.data.slot,
      detail: {
        on_chain_success: succeeded,
        on_chain_error: tx.data.err,
        fee_lamports: tx.data.fee,
        fee_payer_lamport_delta: solDelta,
        accounts_present: tx.data.preBalances.length,
        checked_at: new Date().toISOString(),
      },
    };
  }

  /** Reconciles transactions left in an unknown state by a previous run. */
  async reconcilePending(supabase: Client, userId: string): Promise<number> {
    const { data: pending } = await supabase
      .from("solana_transactions")
      .select("id, signature")
      .eq("user_id", userId)
      .in("status", ["SUBMITTED", "CONFIRMING", "SUBMITTED_UNKNOWN"])
      .not("signature", "is", null)
      .limit(10);
    let reconciled = 0;
    for (const tx of pending ?? []) {
      if (!tx.signature) continue;
      const result = await this.reconcile(tx.signature);
      if (result.status !== "RECONCILED") continue;
      await supabase
        .from("solana_transactions")
        .update({
          status: result.onChainSucceeded ? "CONFIRMED" : "FAILED",
          reconciliation_status: "RECONCILED",
          reconciliation: result.detail,
          reconciled_at: new Date().toISOString(),
          fee_lamports: result.fee,
          slot: result.slot,
        })
        .eq("id", tx.id);
      reconciled += 1;
    }
    return reconciled;
  }

  private async logFailure(supabase: Client, request: TransactionRequest, code: string, message: string) {
    await supabase.from("system_logs").insert({
      user_id: request.userId,
      level: code === "EXECUTION_NOT_PERMITTED" ? "WARNING" : "ERROR",
      component: "SOLANA_TRANSACTION",
      event: code,
      message,
      metadata: { purpose: request.purpose, idempotency_key: request.idempotencyKey, provider: request.executionProvider },
    });
  }
}

export function getTransactionService(): SolanaTransactionService {
  return new SolanaTransactionService();
}
