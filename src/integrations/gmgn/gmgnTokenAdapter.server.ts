// Token intelligence: continuous discovery of tradable Solana tokens plus
// optional security checks. Discovery returns provider data only — never
// placeholder rows.
import { GMGN_CHAIN, LIMITS, isGmgnConfigured } from "./gmgnConfig.server";
import { gmgnRequest } from "./gmgnClient.server";
import { normalizeRankRow } from "./gmgnNormalizer";
import type { AdapterResult } from "./gmgnMarketAdapter.server";
import type { NormalizedToken } from "./gmgnTypes";

type RankEnvelope = unknown;

/** GMGN nests the payload (data.data.rank), so unwrap defensively. */
function extractRows(data: RankEnvelope, depth = 0): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object" || depth > 3) return [];
  const bag = data as Record<string, unknown>;
  for (const key of ["rank", "list", "tokens"]) {
    if (Array.isArray(bag[key])) return bag[key] as unknown[];
  }
  return extractRows(bag["data"], depth + 1);
}

/**
 * Discovery pass. Two complementary rankings are requested so the pipeline sees
 * both fresh launches and tokens with live smart-money participation.
 */
export async function discoverTokens(options: {
  interval?: string;
  limit?: number;
} = {}): Promise<AdapterResult<NormalizedToken[]>> {
  if (!isGmgnConfigured()) {
    return { ok: false, status: "NOT_CONFIGURED", error: "GMGN is not configured" };
  }
  const limit = Math.min(options.limit ?? LIMITS.DISCOVERY_LIMIT, 100);
  const interval = options.interval ?? "1h";

  const result = await gmgnRequest<RankEnvelope>({
    capability: "TOKEN_DISCOVERY",
    path: "/v1/market/rank",
    query: { chain: GMGN_CHAIN, interval, limit, orderby: "volume", direction: "desc" },
    cacheTtlMs: 20_000,
  });
  if (!result.ok) return { ok: false, status: "UNAVAILABLE", error: result.error };

  const tokens = extractRows(result.data)
    .map((row) => normalizeRankRow(row, GMGN_CHAIN))
    .filter((t): t is NormalizedToken => t !== null);

  if (tokens.length === 0) {
    return { ok: false, status: "UNAVAILABLE", error: "Provider returned no tokens" };
  }
  return { ok: true, data: tokens };
}

/** Security/rug checks for a single token, when the account plan exposes them. */
export async function fetchTokenSecurity(address: string): Promise<AdapterResult<Record<string, unknown>>> {
  if (!isGmgnConfigured()) {
    return { ok: false, status: "NOT_CONFIGURED", error: "GMGN is not configured" };
  }
  const result = await gmgnRequest<Record<string, unknown>>({
    capability: "TOKEN_SECURITY",
    path: "/v1/token/security",
    query: { chain: GMGN_CHAIN, address },
    cacheTtlMs: 300_000,
  });
  if (!result.ok) return { ok: false, status: "UNAVAILABLE", error: result.error };
  return { ok: true, data: result.data ?? {} };
}
