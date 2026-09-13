// Market data: live price and full token snapshot for a single token.
import { GMGN_CHAIN, isGmgnConfigured } from "./gmgnConfig.server";
import { gmgnRequest } from "./gmgnClient.server";
import { normalizeTokenInfo } from "./gmgnNormalizer";
import type { NormalizedToken } from "./gmgnTypes";

export type AdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: "NOT_CONFIGURED" | "UNAVAILABLE"; error: string };

const unavailable = <T>(error: string): AdapterResult<T> => ({ ok: false, status: "UNAVAILABLE", error });

export async function fetchTokenSnapshot(
  chain: string,
  address: string,
): Promise<AdapterResult<NormalizedToken>> {
  if (!isGmgnConfigured()) {
    return { ok: false, status: "NOT_CONFIGURED", error: "GMGN is not configured" };
  }
  const result = await gmgnRequest<unknown>({
    capability: "TOKEN_INFO",
    path: "/v1/token/info",
    query: { chain: chain || GMGN_CHAIN, address },
    cacheTtlMs: 15_000,
  });
  if (!result.ok) return unavailable(result.error);
  const token = normalizeTokenInfo(result.data, chain || GMGN_CHAIN);
  if (!token) return unavailable("Provider returned no usable token data");
  return { ok: true, data: token };
}

export async function fetchTokenPrice(chain: string, address: string): Promise<AdapterResult<number>> {
  const snapshot = await fetchTokenSnapshot(chain, address);
  if (!snapshot.ok) return snapshot;
  if (snapshot.data.price === null) return unavailable("Provider returned no price");
  return { ok: true, data: snapshot.data.price };
}
