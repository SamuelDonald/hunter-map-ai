// Controlled withdrawals from the HUNTER trading wallet.
//
// Only an authenticated user can start one, and only to an allow-listed
// destination that has passed its cooldown. The trading strategy, the AI layer
// and GMGN have NO withdrawal authority: nothing in this module is reachable
// from the scanner or from an execution provider.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { findAssociatedTokenPda, getTransferInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SupportedAsset } from "@/integrations/custody/custodyTypes";
import { getCustodyProvider } from "@/integrations/custody/custodyProvider.server";
import { getNetworkConfig, SOL_LAMPORTS } from "./solanaConfig.server";
import { getRpcProvider, SolanaRpcProvider, toAddress } from "./solanaRpc.server";
import { getTransactionService } from "./solanaTransactionService.server";
import { ASSET_DECIMALS, mintForAsset, WITHDRAWAL_LIMITS } from "./walletAssets.server";
import { computeCapital } from "./walletCapital.server";
import { getExecutionWalletRow } from "./walletProvisioning.server";

type Client = SupabaseClient<Database>;

export type WithdrawalRequest = {
  userId: string;
  asset: SupportedAsset;
  amount: number;
  destination: string;
  /** The user must explicitly confirm; there is no silent withdrawal path. */
  confirmed: boolean;
};

export type WithdrawalOutcome = {
  ok: boolean;
  withdrawalId: string | null;
  status: string;
  signature: string | null;
  reason: string | null;
};

export async function requestWithdrawal(supabase: Client, request: WithdrawalRequest): Promise<WithdrawalOutcome> {
  const { cluster } = getNetworkConfig();
  const reject = (reason: string): WithdrawalOutcome => ({ ok: false, withdrawalId: null, status: "REJECTED", signature: null, reason });

  if (!request.confirmed) return reject("EXPLICIT_CONFIRMATION_REQUIRED");
  if (!(request.amount > 0)) return reject("INVALID_AMOUNT");
  if (request.asset === "SOL" && request.amount < WITHDRAWAL_LIMITS.MIN_SOL) return reject("AMOUNT_BELOW_MINIMUM");
  if (request.asset === "USDC" && request.amount < WITHDRAWAL_LIMITS.MIN_USDC) return reject("AMOUNT_BELOW_MINIMUM");
  if (!SolanaRpcProvider.isValidAddress(request.destination)) return reject("INVALID_DESTINATION_ADDRESS");

  const wallet = await getExecutionWalletRow(supabase, request.userId);
  if (!wallet?.public_address || !wallet.provider_wallet_id) return reject("NO_EXECUTION_WALLET");
  if (request.destination === wallet.public_address) return reject("DESTINATION_IS_EXECUTION_WALLET");
  if (wallet.status === "BLOCKED" || wallet.status === "DISABLED") return reject(`WALLET_${wallet.status}`);

  // Allow-listed destination, past its cooldown.
  const { data: allowed } = await supabase
    .from("withdrawal_addresses")
    .select("status, usable_after")
    .eq("user_id", request.userId)
    .eq("chain", "solana")
    .eq("address", request.destination)
    .maybeSingle();
  if (!allowed) return reject("DESTINATION_NOT_ALLOWLISTED");
  if (allowed.status !== "ACTIVE") return reject(`DESTINATION_${allowed.status}`);
  if (new Date(allowed.usable_after).getTime() > Date.now()) return reject("DESTINATION_IN_COOLDOWN");

  // Rate limit per rolling 24 hours.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabase
    .from("wallet_withdrawals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", request.userId)
    .gte("created_at", since);
  if ((count ?? 0) >= WITHDRAWAL_LIMITS.MAX_PER_DAY) return reject("WITHDRAWAL_RATE_LIMIT_REACHED");

  // Balance and reserve checks — the SOL reserve is never spent by a withdrawal.
  const capital = await computeCapital(supabase, request.userId, wallet.public_address);
  if (!capital.rpcOk) return reject("RPC_UNAVAILABLE");
  const feeBuffer = 0.00002;
  if (request.asset === "SOL" && capital.solBalance - request.amount - feeBuffer < capital.minSolReserve) {
    return reject("WOULD_BREACH_MIN_SOL_RESERVE");
  }
  if (request.asset === "USDC") {
    if (request.amount > capital.usdcBalance - capital.reservedCapital) return reject("INSUFFICIENT_AVAILABLE_BALANCE");
    if (capital.solBalance < feeBuffer) return reject("INSUFFICIENT_SOL_FOR_FEES");
  }

  const custody = await getCustodyProvider();
  if (!custody.isConfigured()) return reject("CUSTODY_NOT_CONFIGURED");

  const idempotencyKey = `withdraw:${request.userId}:${request.asset}:${request.destination}:${request.amount}:${Math.floor(Date.now() / 60_000)}`;
  const { data: row, error: insertError } = await supabase
    .from("wallet_withdrawals")
    .insert({
      user_id: request.userId, wallet_id: wallet.id, cluster, initiated_by: "USER",
      destination: request.destination, asset: request.asset, mint: mintForAsset(request.asset, cluster),
      amount: request.amount, idempotency_key: idempotencyKey, status: "VALIDATING",
    })
    .select("id")
    .single();
  if (insertError || !row) {
    return insertError?.code === "23505" || insertError?.message.includes("duplicate")
      ? reject("DUPLICATE_WITHDRAWAL_REQUEST")
      : reject(insertError?.message ?? "WITHDRAWAL_INSERT_FAILED");
  }
  const id = row.id;
  const failRow = async (status: string, reason: string): Promise<WithdrawalOutcome> => {
    await supabase.from("wallet_withdrawals").update({ status, rejection_reason: reason }).eq("id", id);
    await supabase.from("system_logs").insert({
      user_id: request.userId, level: "WARNING", component: "WALLET_WITHDRAWAL", event: status,
      message: reason, metadata: { withdrawal_id: id, asset: request.asset, amount: request.amount },
    });
    return { ok: false, withdrawalId: id, status, signature: null, reason };
  };

  // ---------------------------------------------------------------- build
  const rpc = getRpcProvider();
  const blockhash = await rpc.getLatestBlockhash();
  if (!blockhash.ok) return failRow("REJECTED", "BLOCKHASH_UNAVAILABLE");

  const owner = toAddress(wallet.public_address);
  let instructions: Instruction[];
  if (request.asset === "SOL") {
    instructions = [
      getTransferSolInstruction({
        source: owner as never,
        destination: toAddress(request.destination),
        amount: BigInt(Math.round(request.amount * SOL_LAMPORTS)),
      }),
    ];
  } else {
    const mint = mintForAsset("USDC", cluster);
    if (!mint) return failRow("REJECTED", "ASSET_NOT_SUPPORTED_ON_NETWORK");
    const [source] = await findAssociatedTokenPda({ owner, mint: toAddress(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [destination] = await findAssociatedTokenPda({
      owner: toAddress(request.destination), mint: toAddress(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    // The withdrawal never creates accounts for the destination.
    const destInfo = await rpc.getAccountInfo(destination);
    if (!destInfo.ok || !destInfo.data.exists) return failRow("REJECTED", "DESTINATION_TOKEN_ACCOUNT_MISSING");
    instructions = [
      getTransferInstruction({
        source, destination, authority: owner as never,
        amount: BigInt(Math.round(request.amount * 10 ** ASSET_DECIMALS.USDC)),
      }),
    ];
  }

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: blockhash.data.blockhash as Blockhash, lastValidBlockHeight: BigInt(blockhash.data.lastValidBlockHeight) },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const wireBase64 = getBase64EncodedWireTransaction(compileTransaction(message));

  // ------------------------------------------------------------- simulate
  const simulation = await rpc.simulateTransaction(wireBase64);
  if (!simulation.ok) return failRow("REJECTED", "SIMULATION_UNAVAILABLE");
  if (!simulation.data.success) return failRow("REJECTED", simulation.data.errorCode ?? "SIMULATION_FAILED");

  await supabase.from("wallet_withdrawals").update({ status: "SIGNING" }).eq("id", id);

  // ------------------------------------- sign + submit through custody only
  const signed = await custody.signAndSendTransaction(wallet.provider_wallet_id, wireBase64, cluster);
  if (!signed.ok) return failRow("FAILED", signed.error);
  const signature = signed.data.signature;
  await supabase
    .from("wallet_withdrawals")
    .update({ status: "SUBMITTED", signature, submitted_at: new Date().toISOString() })
    .eq("id", id);

  // ---------------------------------------------------- confirm + reconcile
  const service = getTransactionService();
  const confirmation = await service.confirm(signature);
  const reconciliation = await service.reconcile(signature);

  const finalStatus = confirmation.status === "FAILED" || reconciliation.onChainSucceeded === false ? "FAILED" : "CONFIRMED";
  await supabase
    .from("wallet_withdrawals")
    .update({
      status: finalStatus,
      fee_lamports: reconciliation.fee,
      confirmed_at: finalStatus === "CONFIRMED" ? new Date().toISOString() : null,
      error_message: finalStatus === "FAILED" ? (confirmation.err ?? "Withdrawal failed on chain") : null,
    })
    .eq("id", id);

  // Immutable audit record alongside every other signed transaction.
  await supabase.from("solana_transactions").insert({
    user_id: request.userId, execution_provider: `CUSTODY_${custody.name}`, cluster,
    purpose: `WITHDRAWAL_${request.asset}`, idempotency_key: idempotencyKey, signature,
    status: finalStatus === "CONFIRMED" ? "CONFIRMED" : "FAILED",
    confirmation_level: confirmation.level, slot: reconciliation.slot ?? confirmation.slot,
    fee_lamports: reconciliation.fee, reconciliation_status: reconciliation.status,
    reconciliation: reconciliation.detail, confirmed_at: finalStatus === "CONFIRMED" ? new Date().toISOString() : null,
    submitted_at: new Date().toISOString(),
  });
  await supabase.from("system_logs").insert({
    user_id: request.userId, level: finalStatus === "CONFIRMED" ? "INFO" : "ERROR",
    component: "WALLET_WITHDRAWAL", event: `WITHDRAWAL_${finalStatus}`,
    message: `${request.amount} ${request.asset} withdrawal to ${request.destination}`,
    metadata: { withdrawal_id: id, signature, cluster },
  });

  return { ok: finalStatus === "CONFIRMED", withdrawalId: id, status: finalStatus, signature, reason: null };
}

/** Adds a destination to the allow-list; it stays unusable during the cooldown. */
export async function addWithdrawalAddress(
  supabase: Client,
  userId: string,
  input: { address: string; label?: string | null },
): Promise<{ ok: boolean; reason: string | null; usableAfter: string | null }> {
  if (!SolanaRpcProvider.isValidAddress(input.address)) return { ok: false, reason: "INVALID_ADDRESS", usableAfter: null };
  const usableAfter = new Date(Date.now() + WITHDRAWAL_LIMITS.ADDRESS_COOLDOWN_MINUTES * 60_000).toISOString();
  const { error } = await supabase.from("withdrawal_addresses").upsert(
    {
      user_id: userId, chain: "solana", address: input.address, label: input.label ?? null,
      status: "ACTIVE", usable_after: usableAfter,
    },
    { onConflict: "user_id,chain,address", ignoreDuplicates: true },
  );
  if (error) return { ok: false, reason: error.message, usableAfter: null };
  return { ok: true, reason: null, usableAfter };
}

export async function listWithdrawalRows(supabase: Client, userId: string, limit = 25) {
  const [{ data: withdrawals }, { data: addresses }] = await Promise.all([
    supabase.from("wallet_withdrawals").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit),
    supabase.from("withdrawal_addresses").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
  ]);
  return { withdrawals: withdrawals ?? [], addresses: addresses ?? [] };
}
