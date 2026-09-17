// Trading wallet server functions.
//
// Everything returned here is safe metadata: public addresses, balances,
// statuses and audit rows. There is deliberately no endpoint that can return
// key material, and no endpoint the scanner, strategy engine, AI layer or GMGN
// can reach — withdrawals and the live-trading switch require the authenticated
// user themselves.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupportedAsset } from "@/integrations/custody/custodyTypes";
import type { CapitalBreakdown } from "@/integrations/solana/walletCapital.server";

export type TradingWalletState = {
  cluster: "devnet" | "mainnet-beta";
  provisioned: boolean;
  address: string | null;
  custodyProvider: string | null;
  status: string;
  liveExecutionEnabled: boolean;
  liveExecutionConfirmedAt: string | null;
  firstLiveTradeCompleted: boolean;
  capital: CapitalBreakdown;
  custodyConfigured: boolean;
  supportedAssets: SupportedAsset[];
  minSolReserve: number;
};

export type DepositRow = {
  id: string;
  signature: string;
  asset: string;
  amount: number;
  sender: string | null;
  slot: number | null;
  block_time: string | null;
  confirmation_status: string;
  created_at: string;
};

export type WithdrawalRow = {
  id: string;
  asset: string;
  amount: number;
  destination: string;
  status: string;
  signature: string | null;
  rejection_reason: string | null;
  error_message: string | null;
  created_at: string;
  confirmed_at: string | null;
};

export type WithdrawalAddressRow = {
  id: string;
  address: string;
  label: string | null;
  status: string;
  usable_after: string;
  created_at: string;
};

export type ConnectedWalletRow = {
  id: string;
  address: string;
  wallet_name: string | null;
  connected_at: string;
};

/** Wallet, capital, deposits, withdrawals, allow-list and connected wallets. */
export const getTradingWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    wallet: TradingWalletState;
    deposits: DepositRow[];
    withdrawals: WithdrawalRow[];
    addresses: WithdrawalAddressRow[];
    connected: ConnectedWalletRow[];
  }> => {
    const { getNetworkConfig, LIMITS } = await import("@/integrations/solana/solanaConfig.server");
    const { getExecutionWalletRow } = await import("@/integrations/solana/walletProvisioning.server");
    const { computeCapital } = await import("@/integrations/solana/walletCapital.server");
    const { listDepositRows } = await import("@/integrations/solana/walletDeposits.server");
    const { listWithdrawalRows } = await import("@/integrations/solana/walletWithdrawals.server");
    const { getCustodyProvider } = await import("@/integrations/custody/custodyProvider.server");

    const { cluster } = getNetworkConfig();
    const row = await getExecutionWalletRow(context.supabase, context.userId);
    const address = row?.public_address ?? null;
    const capital = await computeCapital(context.supabase, context.userId, address);
    const custody = await getCustodyProvider();

    const [deposits, withdrawalData, { data: connected }] = await Promise.all([
      listDepositRows(context.supabase, context.userId, 25),
      listWithdrawalRows(context.supabase, context.userId, 25),
      context.supabase
        .from("connected_wallets")
        .select("id, address, wallet_name, connected_at")
        .eq("user_id", context.userId)
        .order("connected_at", { ascending: false }),
    ]);

    return {
      wallet: {
        cluster,
        provisioned: Boolean(address && row?.custody_provider && row.custody_provider !== "NONE"),
        address,
        custodyProvider: row?.custody_provider && row.custody_provider !== "NONE" ? row.custody_provider : null,
        status: row?.status ?? "NOT_CONFIGURED",
        liveExecutionEnabled: row?.live_execution_enabled === true,
        liveExecutionConfirmedAt: row?.live_execution_confirmed_at ?? null,
        firstLiveTradeCompleted: row?.first_live_trade_completed === true,
        capital,
        custodyConfigured: custody.isConfigured(),
        supportedAssets: ["SOL", "USDC"],
        minSolReserve: Number(row?.min_sol_reserve ?? LIMITS.DEFAULT_MIN_SOL_RESERVE),
      },
      deposits: (deposits as DepositRow[]) ?? [],
      withdrawals: (withdrawalData.withdrawals as WithdrawalRow[]) ?? [],
      addresses: (withdrawalData.addresses as WithdrawalAddressRow[]) ?? [],
      connected: (connected as ConnectedWalletRow[]) ?? [],
    };
  });

/** Provisions the user's own segregated HUNTER trading wallet through custody. */
export const createTradingWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; address: string | null; provider: string | null; reason: string | null }> => {
    const { provisionExecutionWallet } = await import("@/integrations/solana/walletProvisioning.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await provisionExecutionWallet(supabaseAdmin, context.userId);
    return result.ok
      ? { ok: true, address: result.address, provider: result.provider, reason: null }
      : { ok: false, address: null, provider: null, reason: result.code };
  });

/** Reads confirmed deposits straight from the chain — the chain is authoritative. */
export const syncTradingWalletDeposits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ scanned: number; recorded: number; error: string | null }> => {
    const { syncWalletDeposits } = await import("@/integrations/solana/walletDeposits.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return syncWalletDeposits(supabaseAdmin, context.userId, 40);
  });

/** Adds a withdrawal destination; it stays unusable during its cooldown. */
export const addTradingWithdrawalAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string; label?: string | null }) => ({
    address: String(input?.address ?? "").trim(),
    label: input?.label ? String(input.label).slice(0, 64) : null,
  }))
  .handler(async ({ context, data }) => {
    const { addWithdrawalAddress } = await import("@/integrations/solana/walletWithdrawals.server");
    return addWithdrawalAddress(context.supabase, context.userId, data);
  });

/** User-initiated withdrawal. Requires explicit confirmation every time. */
export const submitTradingWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { asset: SupportedAsset; amount: number; destination: string; confirmed: boolean }) => ({
    asset: input?.asset === "USDC" ? ("USDC" as const) : ("SOL" as const),
    amount: Number(input?.amount ?? 0),
    destination: String(input?.destination ?? "").trim(),
    confirmed: input?.confirmed === true,
  }))
  .handler(async ({ context, data }) => {
    const { requestWithdrawal } = await import("@/integrations/solana/walletWithdrawals.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return requestWithdrawal(supabaseAdmin, { userId: context.userId, ...data });
  });

const LIVE_CONFIRMATION = "ENABLE LIVE TRADING";

/**
 * Per-wallet live trading switch. Off by default even after funding, and only
 * flipped by the authenticated user typing the confirmation phrase. Until the
 * first live trade has completed and reconciled, canary limits are applied.
 */
export const setLiveTrading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled: boolean; confirmation?: string }) => ({
    enabled: input?.enabled === true,
    confirmation: String(input?.confirmation ?? ""),
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean; enabled: boolean; reason: string | null; canary: boolean }> => {
    const { getNetworkConfig } = await import("@/integrations/solana/solanaConfig.server");
    const { getExecutionWalletRow } = await import("@/integrations/solana/walletProvisioning.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { cluster } = getNetworkConfig();

    const row = await getExecutionWalletRow(context.supabase, context.userId);
    if (!row?.public_address || row.custody_provider === "NONE") {
      return { ok: false, enabled: false, reason: "NO_EXECUTION_WALLET", canary: false };
    }

    if (data.enabled) {
      if (data.confirmation.trim().toUpperCase() !== LIVE_CONFIRMATION) {
        return { ok: false, enabled: false, reason: "CONFIRMATION_REQUIRED", canary: false };
      }
      if (row.status !== "READY") return { ok: false, enabled: false, reason: `WALLET_NOT_READY_${row.status}`, canary: false };
    }

    const canary = data.enabled && row.first_live_trade_completed !== true;

    await supabaseAdmin
      .from("execution_wallets")
      .update({
        live_execution_enabled: data.enabled,
        live_execution_confirmed_at: data.enabled ? new Date().toISOString() : null,
      })
      .eq("user_id", context.userId)
      .eq("purpose", "EXECUTION")
      .eq("cluster", cluster);

    // First-live-trade safety mode: one open position at a time until a live
    // trade has been executed and reconciled.
    if (canary) {
      await supabaseAdmin.from("risk_settings").update({ max_positions: 1 }).eq("user_id", context.userId);
    }

    await supabaseAdmin.from("system_logs").insert({
      user_id: context.userId,
      level: "WARNING",
      component: "EXECUTION_WALLET",
      event: data.enabled ? "LIVE_TRADING_ENABLED" : "LIVE_TRADING_DISABLED",
      message: data.enabled
        ? "User explicitly enabled live trading for their execution wallet."
        : "Live trading disabled for the execution wallet.",
      metadata: { cluster, canary, wallet_address: row.public_address },
    });

    return { ok: true, enabled: data.enabled, reason: null, canary };
  });

/**
 * Records an external wallet (Phantom / Solflare / Backpack) the user connected
 * for funding and withdrawals. It gets NO trading permissions of any kind.
 */
export const connectExternalWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string; walletName?: string | null }) => ({
    address: String(input?.address ?? "").trim(),
    walletName: input?.walletName ? String(input.walletName).slice(0, 64) : null,
  }))
  .handler(async ({ context, data }): Promise<{ ok: boolean; reason: string | null }> => {
    const { SolanaRpcProvider } = await import("@/integrations/solana/solanaRpc.server");
    if (!SolanaRpcProvider.isValidAddress(data.address)) return { ok: false, reason: "INVALID_ADDRESS" };
    const { error } = await context.supabase.from("connected_wallets").upsert(
      { user_id: context.userId, chain: "solana", address: data.address, wallet_name: data.walletName },
      { onConflict: "user_id,chain,address" },
    );
    return error ? { ok: false, reason: error.message } : { ok: true, reason: null };
  });

export const disconnectExternalWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) => ({ address: String(input?.address ?? "").trim() }))
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    await context.supabase
      .from("connected_wallets")
      .delete()
      .eq("user_id", context.userId)
      .eq("address", data.address);
    return { ok: true };
  });
