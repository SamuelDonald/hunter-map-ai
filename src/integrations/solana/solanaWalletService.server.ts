// SolanaWalletService — safe wallet metadata only.
// It can read balances, accounts and history, and it can report state. It has
// no access to key material: signing lives behind SignerProvider.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { LIMITS, SOL_LAMPORTS, getNetworkConfig, type SolanaCluster } from "./solanaConfig.server";
import { SolanaRpcProvider, getRpcProvider, type RpcHealth, type TokenBalance } from "./solanaRpc.server";
import { getSignerProvider } from "./solanaSigner.server";

type Client = SupabaseClient<Database>;

export type ExecutionWalletState =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "READY"
  | "LOW_BALANCE"
  | "BLOCKED"
  | "ERROR";

export type WalletSnapshot = {
  purpose: "EXECUTION";
  cluster: SolanaCluster;
  state: ExecutionWalletState;
  address: string | null;
  signerBackend: string | null;
  /** Custody backend that controls signing for this wallet (never a credential). */
  custodyProvider: string | null;
  /** Per-wallet live trading switch; false until the user explicitly enables it. */
  liveExecutionEnabled: boolean;
  solBalance: number | null;
  lamports: number | null;
  minSolReserve: number;
  aboveReserve: boolean | null;
  tokenBalances: TokenBalance[];
  transactionCount: number;
  lastSyncAt: string | null;
  rpc: RpcHealth;
  reasons: string[];
};

export class SolanaWalletService {
  private readonly rpc: SolanaRpcProvider;

  constructor(rpc: SolanaRpcProvider = getRpcProvider()) {
    this.rpc = rpc;
  }

  validateAddress(value: string): boolean {
    return SolanaRpcProvider.isValidAddress(value);
  }

  validateCluster(cluster: string): cluster is SolanaCluster {
    return cluster === "devnet" || cluster === "mainnet-beta";
  }

  async getAccountInformation(account: string) {
    return this.rpc.getAccountInfo(account);
  }

  async getTokenAccountInformation(owner: string) {
    return this.rpc.getTokenAccounts(owner);
  }

  async getRecentTransactions(supabase: Client, userId: string, limit = 25) {
    const { data } = await supabase
      .from("solana_transactions")
      .select(
        "id, cluster, purpose, status, signature, slot, fee_lamports, confirmation_level, reconciliation_status, error_code, error_message, execution_provider, order_id, submitted_at, confirmed_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  /**
   * Full execution-wallet snapshot. READY is only returned when the signer is
   * configured, the address validates, the RPC answered and the balance is at
   * or above the configured reserve.
   */
  async getExecutionWalletSnapshot(
    supabase: Client,
    userId: string,
    options: { blocked?: boolean; blockedReasons?: string[] } = {},
  ): Promise<WalletSnapshot> {
    const config = getNetworkConfig();
    const signerProvider = getSignerProvider();
    const availability = await signerProvider.availability();
    const reasons: string[] = [];

    // The custody-provisioned wallet is authoritative; the env signer is only a
    // fallback for infrastructure testing.
    const { data: walletRow } = await supabase
      .from("execution_wallets")
      .select("public_address, custody_provider, status, live_execution_enabled")
      .eq("user_id", userId)
      .eq("purpose", "EXECUTION")
      .eq("cluster", config.cluster)
      .maybeSingle();
    const custodyProvider =
      walletRow?.custody_provider && walletRow.custody_provider !== "NONE" ? walletRow.custody_provider : null;
    const custodyAddress = custodyProvider ? (walletRow?.public_address ?? null) : null;
    const address = custodyAddress ?? availability.address;

    const { data: riskRow } = await supabase
      .from("risk_settings")
      .select("min_sol_reserve, kill_switch")
      .eq("user_id", userId)
      .maybeSingle();
    const minSolReserve = Number(riskRow?.min_sol_reserve ?? LIMITS.DEFAULT_MIN_SOL_RESERVE);

    const rpcHealth = await this.rpc.health();

    const base: WalletSnapshot = {
      purpose: "EXECUTION",
      cluster: config.cluster,
      state: "NOT_CONFIGURED",
      address,
      signerBackend: custodyProvider ?? availability.backend,
      custodyProvider,
      liveExecutionEnabled: walletRow?.live_execution_enabled === true,
      solBalance: null,
      lamports: null,
      minSolReserve,
      aboveReserve: null,
      tokenBalances: [],
      transactionCount: 0,
      lastSyncAt: null,
      rpc: rpcHealth,
      reasons,
    };

    const { count } = await supabase
      .from("solana_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("cluster", config.cluster);
    base.transactionCount = count ?? 0;

    if (!custodyAddress && availability.error) {
      reasons.push("SIGNER_ERROR");
      base.state = "ERROR";
      await this.persist(supabase, userId, base, availability.error);
      return base;
    }
    if (!address) {
      reasons.push("NO_EXECUTION_WALLET_PROVISIONED");
      base.state = "NOT_CONFIGURED";
      await this.persist(supabase, userId, base, null);
      return base;
    }
    if (!this.validateAddress(address)) {
      reasons.push("INVALID_EXECUTION_WALLET_ADDRESS");
      base.state = "ERROR";
      await this.persist(supabase, userId, base, "Invalid execution wallet address");
      return base;
    }

    base.state = "CONFIGURED";

    const balance = await this.rpc.getBalance(address);
    if (!balance.ok) {
      reasons.push("RPC_UNAVAILABLE");
      base.state = "ERROR";
      await this.persist(supabase, userId, base, balance.error);
      return base;
    }

    base.lamports = balance.data;
    base.solBalance = balance.data / SOL_LAMPORTS;
    base.aboveReserve = base.solBalance >= minSolReserve;
    base.lastSyncAt = new Date().toISOString();

    const tokens = await this.rpc.getTokenAccounts(address);
    if (tokens.ok) base.tokenBalances = tokens.data.filter((t) => Number(t.amount) > 0);

    if (riskRow?.kill_switch) reasons.push("RISK_KILL_SWITCH_ENGAGED");
    if (options.blocked) reasons.push(...(options.blockedReasons ?? ["EXECUTION_BLOCKED"]));

    if (!base.aboveReserve) {
      reasons.push(`SOL_BELOW_MIN_RESERVE_${minSolReserve}`);
      base.state = "LOW_BALANCE";
    } else if (riskRow?.kill_switch || options.blocked) {
      base.state = "BLOCKED";
    } else {
      base.state = "READY";
    }

    await this.persist(supabase, userId, base, null);
    return base;
  }

  /**
   * Stores safe metadata only — address, cluster, state, balance, timestamps.
   * Custody fields (provider, provider wallet id, live switch) are never written
   * here, so a monitoring pass can not detach or re-enable a custody wallet.
   */
  private async persist(supabase: Client, userId: string, snapshot: WalletSnapshot, error: string | null) {
    // A monitoring pass must not overwrite provisioning progress or hide a
    // provisioning failure behind "not configured".
    if (!snapshot.address) {
      const { data: current } = await supabase
        .from("execution_wallets")
        .select("status")
        .eq("user_id", userId)
        .eq("purpose", "EXECUTION")
        .eq("cluster", snapshot.cluster)
        .maybeSingle();
      if (current && ["PROVISIONING", "ERROR", "DISABLED"].includes(current.status)) return;
    }
    await supabase
      .from("execution_wallets")
      .upsert(
        {
          user_id: userId,
          chain: "solana",
          cluster: snapshot.cluster,
          purpose: "EXECUTION",
          // Never clear a provisioned address with a null.
          ...(snapshot.address ? { public_address: snapshot.address } : {}),
          status: snapshot.state,
          sol_balance: snapshot.solBalance,
          min_sol_reserve: snapshot.minSolReserve,
          transaction_count: snapshot.transactionCount,
          last_sync_at: snapshot.lastSyncAt,
          last_error: error,
          metadata: { signer_backend: snapshot.signerBackend, rpc_status: snapshot.rpc.status, reasons: snapshot.reasons },
        },
        { onConflict: "user_id,purpose,cluster" },
      );
  }
}

/**
 * Balance monitoring. Writes a risk event when the reserve is breached and
 * never moves funds: the system cannot fund itself from another wallet.
 */
export async function monitorWalletBalance(
  supabase: Client,
  userId: string,
  snapshot: WalletSnapshot,
): Promise<void> {
  if (snapshot.state !== "LOW_BALANCE") return;
  await supabase.from("risk_events").insert({
    user_id: userId,
    event_type: "SYSTEM_ERROR",
    severity: "WARNING",
    message: `Execution wallet SOL balance ${snapshot.solBalance ?? 0} is below the configured reserve ${snapshot.minSolReserve}`,
    metadata: {
      component: "SOLANA_WALLET",
      cluster: snapshot.cluster,
      sol_balance: snapshot.solBalance,
      min_sol_reserve: snapshot.minSolReserve,
    },
  });
  await supabase.from("system_logs").insert({
    user_id: userId,
    level: "WARNING",
    component: "SOLANA_WALLET",
    event: "LOW_SOL_BALANCE",
    message: "Execution wallet is below its minimum SOL reserve; new transactions are blocked.",
    metadata: { cluster: snapshot.cluster, sol_balance: snapshot.solBalance, min_sol_reserve: snapshot.minSolReserve },
  });
}
