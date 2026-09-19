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

/**
 * PEM signing credential for GMGN's signed trade routes. Separate from both the
 * data API key and any Solana wallet key. Server-side only.
 */
export function getGmgnSigningKey(): string | null {
  const key = process.env["GMGN_SIGNING_KEY"];
  return key && key.trim() ? key.trim() : null;
}

/**
 * Wallet address GMGN executes from. GMGN's signed swap routes submit from a
 * wallet GMGN itself controls for the account, so this must be configured
 * explicitly and can never be inferred from a custody wallet.
 */
export function getGmgnTradeAddress(): string | null {
  const address = process.env["GMGN_TRADE_FROM_ADDRESS"];
  return address && address.trim() ? address.trim() : null;
}

const numberEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Explicit, configurable execution policy. Nothing here is silently relaxed at
 * runtime: a quote that needs more slippage or more fee than configured is
 * rejected, never auto-widened.
 */
export const EXECUTION_POLICY = {
  /** Hard cap regardless of strategy configuration (percent). */
  get MAX_SLIPPAGE_PERCENT() {
    return numberEnv("GMGN_MAX_SLIPPAGE_PERCENT", 10);
  },
  /** Priority fee offered per transaction, in SOL. */
  get PRIORITY_FEE_SOL() {
    return numberEnv("GMGN_PRIORITY_FEE_SOL", 0.001);
  },
  /** Absolute ceiling for the priority fee, in SOL. Never exceeded. */
  get MAX_PRIORITY_FEE_SOL() {
    return numberEnv("GMGN_MAX_PRIORITY_FEE_SOL", 0.01);
  },
  /** Anti-MEV routing is deterministic configuration, off unless requested. */
  get ANTI_MEV() {
    return process.env["GMGN_ANTI_MEV"] === "true";
  },
} as const;

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

