// Server functions for the Solana infrastructure layer.
// Everything returned here is safe metadata. No key material, no seed phrase,
// and there is deliberately no endpoint that can reveal a private key.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ExecutionReadiness } from "@/integrations/solana/solanaExecutionGate.server";
import type { WalletSnapshot } from "@/integrations/solana/solanaWalletService.server";
import type { TransactionOutcome } from "@/integrations/solana/solanaTransactionService.server";

export type SolanaTransactionRecord = {
  id: string;
  cluster: "devnet" | "mainnet-beta";
  purpose: string;
  status: string;
  signature: string | null;
  explorer_url: string | null;
  slot: number | null;
  fee_lamports: number | null;
  confirmation_level: string | null;
  reconciliation_status: string;
  error_code: string | null;
  error_message: string | null;
  execution_provider: string;
  order_id: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type WalletOverview = {
  network: {
    cluster: "devnet" | "mainnet-beta";
    rpc_configured: boolean;
    commitment: string;
    confirmation_commitment: string;
  };
  wallet: WalletSnapshot;
  readiness: ExecutionReadiness;
  transactions: SolanaTransactionRecord[];
};

/** Wallet + network + execution readiness, all read from the chain and the DB. */
export const getSolanaWalletOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletOverview> => {
    const { getNetworkConfig, explorerTxUrl } = await import("@/integrations/solana/solanaConfig.server");
    const { SolanaWalletService, monitorWalletBalance } = await import("@/integrations/solana/solanaWalletService.server");
    const { evaluateExecutionReadiness } = await import("@/integrations/solana/solanaExecutionGate.server");
    // Wallet metadata is written by the execution service, so persistence uses
    // the privileged client — scoped to the authenticated caller's own id.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const config = getNetworkConfig();
    const service = new SolanaWalletService();
    const readiness = await evaluateExecutionReadiness(context.supabase, context.userId);
    const wallet = await service.getExecutionWalletSnapshot(supabaseAdmin, context.userId, {
      blocked: readiness.emergencyBlock === "ENABLED" && readiness.liveExecutionAvailable,
      blockedReasons: ["EMERGENCY_EXECUTION_BLOCK_ENGAGED"],
    });
    await monitorWalletBalance(supabaseAdmin, context.userId, wallet);

    const rows = await service.getRecentTransactions(context.supabase, context.userId, 25);
    const transactions: SolanaTransactionRecord[] = rows.map((row) => ({
      id: row.id,
      cluster: row.cluster as "devnet" | "mainnet-beta",
      purpose: row.purpose,
      status: row.status,
      signature: row.signature,
      explorer_url: row.signature ? explorerTxUrl(row.signature, row.cluster as "devnet" | "mainnet-beta") : null,
      slot: row.slot === null ? null : Number(row.slot),
      fee_lamports: row.fee_lamports === null ? null : Number(row.fee_lamports),
      confirmation_level: row.confirmation_level,
      reconciliation_status: row.reconciliation_status,
      error_code: row.error_code,
      error_message: row.error_message,
      execution_provider: row.execution_provider,
      order_id: row.order_id,
      submitted_at: row.submitted_at,
      confirmed_at: row.confirmed_at,
      created_at: row.created_at,
    }));

    return {
      network: {
        cluster: config.cluster,
        rpc_configured: config.rpcConfigured,
        commitment: config.commitment,
        confirmation_commitment: config.confirmationCommitment,
      },
      wallet,
      readiness,
      transactions,
    };
  });

/**
 * Devnet-only infrastructure self-test: a minimal self-transfer that exercises
 * build -> simulate -> risk -> sign -> submit -> confirm -> reconcile.
 * It never runs on mainnet and never touches strategy positions.
 */
export const runSolanaSelfTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { simulateOnly?: boolean }) => ({ simulateOnly: input?.simulateOnly === true }))
  .handler(async ({ context, data }): Promise<TransactionOutcome> => {
    const { getCluster } = await import("@/integrations/solana/solanaConfig.server");
    if (getCluster() !== "devnet") {
      return {
        transactionId: null, status: "REJECTED", signature: null, slot: null, fee: null, confirmationLevel: null,
        reconciliationStatus: "NOT_APPLICABLE", errorCode: "NON_DEVNET_TEST_BLOCKED",
        errorMessage: "Infrastructure self-tests only run on devnet", simulation: null,
        reasons: ["NON_DEVNET_TEST_BLOCKED"],
      };
    }
    const { getTransferSolInstruction } = await import("@solana-program/system");
    const { getTransactionService } = await import("@/integrations/solana/solanaTransactionService.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const bucket = Math.floor(Date.now() / 60_000);
    return getTransactionService().execute(supabaseAdmin, {
      userId: context.userId,
      idempotencyKey: `selftest:${context.userId}:${bucket}:${data.simulateOnly ? "sim" : "send"}`,
      purpose: data.simulateOnly ? "INFRASTRUCTURE_SIMULATION" : "INFRASTRUCTURE_TEST",
      executionProvider: "SOLANA_INFRASTRUCTURE",
      expectedLamportsSpend: 1_000,
      build: (signer) => [
        getTransferSolInstruction({ source: signer, destination: signer.address, amount: 1_000n }),
      ],
      riskCheck: async () =>
        data.simulateOnly
          ? { approved: false, reasons: ["SIMULATION_ONLY_REQUESTED"] }
          : { approved: true, reasons: [] },
    });
  });

/** Reconciles any transaction left in an unknown state — the chain is authoritative. */
export const reconcileSolanaTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ reconciled: number }> => {
    const { getTransactionService } = await import("@/integrations/solana/solanaTransactionService.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reconciled = await getTransactionService().reconcilePending(supabaseAdmin, context.userId);
    return { reconciled };
  });

/** On-chain token validation for a stored token — GMGN metadata is not trusted. */
export const validateTokenOnChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) => ({ address: String(input.address) }))
  .handler(async ({ data }) => {
    const { validateSolanaToken } = await import("@/integrations/solana/solanaTokenValidation.server");
    return validateSolanaToken(data.address);
  });
