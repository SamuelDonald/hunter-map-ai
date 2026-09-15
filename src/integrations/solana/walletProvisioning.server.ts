// Execution wallet provisioning.
//
// One wallet per user — never a shared hot wallet. The wallet is created by the
// custody provider, verified against Solana, and only safe metadata is stored:
// provider name, provider wallet id, public address, status, balances.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getCustodyProvider } from "@/integrations/custody/custodyProvider.server";
import { getNetworkConfig, LIMITS } from "./solanaConfig.server";
import { getRpcProvider, SolanaRpcProvider } from "./solanaRpc.server";

type Client = SupabaseClient<Database>;

export type ProvisionResult =
  | { ok: true; address: string; provider: string; status: string; created: boolean }
  | { ok: false; code: string; error: string };

export async function getExecutionWalletRow(supabase: Client, userId: string) {
  const { cluster } = getNetworkConfig();
  const { data } = await supabase
    .from("execution_wallets")
    .select("*")
    .eq("user_id", userId)
    .eq("purpose", "EXECUTION")
    .eq("cluster", cluster)
    .maybeSingle();
  return data ?? null;
}

/**
 * Creates the HUNTER trading wallet for an authenticated user. Refuses to
 * create a second wallet, never returns key material, and leaves live
 * execution disabled regardless of funding.
 */
export async function provisionExecutionWallet(supabase: Client, userId: string): Promise<ProvisionResult> {
  const { cluster } = getNetworkConfig();

  // The account must exist before a wallet is attached to it.
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!profile) return { ok: false, code: "ACCOUNT_NOT_FOUND", error: "No HUNTER account found for this user" };

  const existing = await getExecutionWalletRow(supabase, userId);
  if (existing?.public_address && existing.custody_provider !== "NONE") {
    return { ok: true, address: existing.public_address, provider: existing.custody_provider, status: existing.status, created: false };
  }

  const custody = await getCustodyProvider();
  if (!custody.isConfigured()) {
    return { ok: false, code: "CUSTODY_NOT_CONFIGURED", error: "Wallet custody provider is not configured" };
  }

  // Mark provisioning before calling out, so a failed attempt is visible.
  await supabase.from("execution_wallets").upsert(
    {
      user_id: userId,
      chain: "solana",
      cluster,
      purpose: "EXECUTION",
      status: "PROVISIONING",
      custody_provider: custody.name,
      min_sol_reserve: LIMITS.DEFAULT_MIN_SOL_RESERVE,
      live_execution_enabled: false,
    },
    { onConflict: "user_id,purpose,cluster" },
  );

  const created = await custody.createWallet({ userId, cluster });
  if (!created.ok) {
    await supabase
      .from("execution_wallets")
      .update({ status: "ERROR", last_error: created.error })
      .eq("user_id", userId)
      .eq("purpose", "EXECUTION")
      .eq("cluster", cluster);
    return { ok: false, code: created.code ?? "CUSTODY_ERROR", error: created.error };
  }

  const { address, providerWalletId } = created.data;
  if (!SolanaRpcProvider.isValidAddress(address)) {
    await supabase
      .from("execution_wallets")
      .update({ status: "ERROR", last_error: "Custody provider returned an invalid Solana address" })
      .eq("user_id", userId)
      .eq("purpose", "EXECUTION")
      .eq("cluster", cluster);
    return { ok: false, code: "INVALID_ADDRESS", error: "Custody provider returned an invalid Solana address" };
  }

  // Verify against the chain. A brand new account has no lamports yet, so we
  // only require that the RPC answers for the address.
  const rpc = getRpcProvider();
  const balance = await rpc.getBalance(address);
  const lamports = balance.ok ? balance.data : 0;

  await supabase
    .from("execution_wallets")
    .update({
      public_address: address,
      provider_wallet_id: providerWalletId,
      custody_provider: custody.name,
      status: "READY",
      sol_balance: lamports / 1_000_000_000,
      last_sync_at: new Date().toISOString(),
      last_error: balance.ok ? null : balance.error,
      live_execution_enabled: false,
      metadata: { verified_on_chain: balance.ok, custody_provider: custody.name },
    })
    .eq("user_id", userId)
    .eq("purpose", "EXECUTION")
    .eq("cluster", cluster);

  await supabase.from("system_logs").insert({
    user_id: userId,
    level: "INFO",
    component: "EXECUTION_WALLET",
    event: "WALLET_PROVISIONED",
    message: "HUNTER trading wallet provisioned through the custody provider.",
    metadata: { cluster, custody_provider: custody.name, public_address: address },
  });

  return { ok: true, address, provider: custody.name, status: "READY", created: true };
}
