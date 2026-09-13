// Smart Money intelligence: which tracked wallets are actually trading right now.
import { GMGN_CHAIN, LIMITS, isGmgnConfigured } from "./gmgnConfig.server";
import { gmgnRequest } from "./gmgnClient.server";
import { normalizeSmartMoneyTrade, normalizeWalletStats } from "./gmgnNormalizer";
import type { AdapterResult } from "./gmgnMarketAdapter.server";
import type { NormalizedWallet, NormalizedWalletEvent } from "./gmgnTypes";

function extractRows(data: unknown, depth = 0): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object" || depth > 3) return [];
  const bag = data as Record<string, unknown>;
  for (const key of ["list", "trades", "activities", "rank"]) {
    if (Array.isArray(bag[key])) return bag[key] as unknown[];
  }
  return extractRows(bag["data"], depth + 1);
}

/** Recent smart-money trades across Solana. */
export async function fetchSmartMoneyActivity(options: { limit?: number } = {}): Promise<
  AdapterResult<NormalizedWalletEvent[]>
> {
  if (!isGmgnConfigured()) {
    return { ok: false, status: "NOT_CONFIGURED", error: "GMGN is not configured" };
  }
  const result = await gmgnRequest<unknown>({
    capability: "SMART_MONEY",
    path: "/v1/user/smartmoney",
    query: { chain: GMGN_CHAIN, limit: Math.min(options.limit ?? LIMITS.SMART_MONEY_LIMIT, 100) },
    cacheTtlMs: 20_000,
  });
  if (!result.ok) return { ok: false, status: "UNAVAILABLE", error: result.error };

  const events = extractRows(result.data)
    .map((row) => normalizeSmartMoneyTrade(row, GMGN_CHAIN))
    .filter((e): e is NormalizedWalletEvent => e !== null);
  if (events.length === 0) {
    return { ok: false, status: "UNAVAILABLE", error: "Provider returned no smart money activity" };
  }
  return { ok: true, data: events };
}

/** Per-wallet performance statistics, when the account plan exposes them. */
export async function fetchWalletStats(address: string): Promise<AdapterResult<NormalizedWallet>> {
  if (!isGmgnConfigured()) {
    return { ok: false, status: "NOT_CONFIGURED", error: "GMGN is not configured" };
  }
  const result = await gmgnRequest<unknown>({
    capability: "WALLET_STATS",
    path: "/v1/user/wallet_stats",
    query: { chain: GMGN_CHAIN, wallet: address, period: "7d" },
    cacheTtlMs: 300_000,
  });
  if (!result.ok) return { ok: false, status: "UNAVAILABLE", error: result.error };
  const wallet = normalizeWalletStats(result.data, GMGN_CHAIN);
  if (!wallet) return { ok: false, status: "UNAVAILABLE", error: "Provider returned no wallet statistics" };
  return { ok: true, data: wallet };
}
