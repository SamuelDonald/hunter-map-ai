// Server-only GMGN configuration. Credentials are read inside functions and
// never leave the server runtime. The signing key used by GMGN trade routes is
// deliberately NOT read here — Phase 3 uses read-only intelligence endpoints.

export const GMGN_HOST = "https://openapi.gmgn.ai";
export const GMGN_CHAIN = "sol";

/** Freshness windows (seconds). Stale data must never be treated as live. */
export const FRESHNESS = {
  MARKET_DATA_MAX_AGE: 180,
  SMART_MONEY_MAX_AGE: 900,
  WALLET_ACTIVITY_MAX_AGE: 1800,
} as const;

export const LIMITS = {
  /** Minimum gap between two provider requests from one worker. */
  MIN_REQUEST_INTERVAL_MS: 1_000,
  REQUEST_TIMEOUT_MS: 15_000,
  MAX_RETRIES: 2,
  /** Bounded work per scan run. */
  DISCOVERY_LIMIT: 50,
  SMART_MONEY_LIMIT: 50,
  TOKEN_REFRESH_PER_RUN: 3,
  CANDIDATES_PER_USER: 5,
  /** Consecutive provider failures before the scanner circuit-breaks. */
  FAILURE_CIRCUIT_BREAK: 5,
  CIRCUIT_PAUSE_MS: 10 * 60 * 1000,
  /** Provider-signalled rate limiting parks the integration immediately. */
  RATE_LIMIT_PAUSE_MS: 5 * 60 * 1000,
} as const;

/** Provider rate limiting is reported by message, not only by HTTP 429. */
export function isRateLimitMessage(message: string): boolean {
  return /rate.?limit|too many requests|banned/i.test(message);
}

export function getGmgnApiKey(): string | null {
  const key = process.env["GMGN_API_KEY"];
  return key && key.trim() ? key.trim() : null;
}

export function isGmgnConfigured(): boolean {
  return getGmgnApiKey() !== null;
}
