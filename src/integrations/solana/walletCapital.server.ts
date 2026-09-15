// Trading capital accounting.
//
// Wallet balance is NOT trading capital. Available capital excludes the minimum
// SOL reserve and any capital reserved by open positions. The risk engine uses
// available capital only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getNetworkConfig, SOL_LAMPORTS } from "./solanaConfig.server";
import { getRpcProvider } from "./solanaRpc.server";
import { ASSET_DECIMALS, USDC_MINT } from "./walletAssets.server";

type Client = SupabaseClient<Database>;

export type CapitalBreakdown = {
  cluster: "devnet" | "mainnet-beta";
  address: string | null;
  solBalance: number;
  usdcBalance: number;
  minSolReserve: number;
  /** Capital locked by open positions. */
  reservedCapital: number;
  /** What the risk engine may allocate. */
  availableCapital: number;
  belowReserve: boolean;
  syncedAt: string | null;
  rpcOk: boolean;
};

export async function computeCapital(supabase: Client, userId: string, address: string | null): Promise<CapitalBreakdown> {
  const { cluster } = getNetworkConfig();

  const { data: risk } = await supabase.from("risk_settings").select("min_sol_reserve").eq("user_id", userId).maybeSingle();
  const minSolReserve = Number(risk?.min_sol_reserve ?? 0.05);

  const { data: positions } = await supabase
    .from("positions")
    .select("invested_amount")
    .eq("user_id", userId)
    .eq("status", "OPEN");
  const reservedCapital = (positions ?? []).reduce((sum, row) => sum + Number(row.invested_amount ?? 0), 0);

  const base: CapitalBreakdown = {
    cluster,
    address,
    solBalance: 0,
    usdcBalance: 0,
    minSolReserve,
    reservedCapital,
    availableCapital: 0,
    belowReserve: true,
    syncedAt: null,
    rpcOk: false,
  };
  if (!address) return base;

  const rpc = getRpcProvider();
  const balance = await rpc.getBalance(address);
  if (!balance.ok) return base;

  base.rpcOk = true;
  base.solBalance = balance.data / SOL_LAMPORTS;
  base.syncedAt = new Date().toISOString();

  const tokens = await rpc.getTokenAccounts(address);
  if (tokens.ok) {
    base.usdcBalance = tokens.data
      .filter((t) => t.mint === USDC_MINT[cluster])
      .reduce((sum, t) => sum + Number(t.amount) / 10 ** (t.decimals || ASSET_DECIMALS.USDC), 0);
  }

  base.belowReserve = base.solBalance < minSolReserve;
  // USDC is the trading-capital asset; SOL above the reserve pays fees.
  const spendableUsdc = Math.max(0, base.usdcBalance - reservedCapital);
  base.availableCapital = base.belowReserve ? 0 : spendableUsdc;
  return base;
}
