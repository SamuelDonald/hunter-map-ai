// Server-only Solana network configuration.
// Devnet is the default. Mainnet requires explicit configuration and can never
// be reached by accident: the cluster env var alone does not enable execution.
export type SolanaCluster = "devnet" | "mainnet-beta";

export type SolanaNetworkConfig = {
  cluster: SolanaCluster;
  rpcUrl: string;
  wsUrl: string;
  commitment: "processed" | "confirmed" | "finalized";
  /** Commitment required before a transaction is treated as settled. */
  confirmationCommitment: "confirmed" | "finalized";
  confirmationTimeoutMs: number;
  confirmationPollIntervalMs: number;
  explorerBase: string;
  /** True when the RPC endpoint came from configuration rather than a public default. */
  rpcConfigured: boolean;
};

const PUBLIC_DEFAULTS: Record<SolanaCluster, string> = {
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export const LIMITS = {
  RPC_TIMEOUT_MS: 15_000,
  RPC_MAX_RETRIES: 2,
  CONFIRMATION_TIMEOUT_MS: 60_000,
  CONFIRMATION_POLL_MS: 2_000,
  /** Below this SOL balance the execution wallet reports LOW_BALANCE. */
  DEFAULT_MIN_SOL_RESERVE: 0.05,
  /** Latency above this marks the RPC provider DEGRADED. */
  DEGRADED_LATENCY_MS: 2_500,
} as const;

const env = (name: string): string | null => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
};

/** Cluster resolution never silently upgrades an unknown value to mainnet. */
export function getCluster(): SolanaCluster {
  const raw = env("SOLANA_CLUSTER")?.toLowerCase();
  if (raw === "mainnet-beta" || raw === "mainnet") return "mainnet-beta";
  return "devnet";
}

export function getNetworkConfig(): SolanaNetworkConfig {
  const cluster = getCluster();
  const configured =
    cluster === "mainnet-beta" ? env("SOLANA_RPC_URL_MAINNET") : env("SOLANA_RPC_URL_DEVNET");
  const rpcUrl = configured ?? env("SOLANA_RPC_URL") ?? PUBLIC_DEFAULTS[cluster];
  return {
    cluster,
    rpcUrl,
    wsUrl: rpcUrl.replace(/^http/, "ws"),
    commitment: "confirmed",
    confirmationCommitment: "confirmed",
    confirmationTimeoutMs: LIMITS.CONFIRMATION_TIMEOUT_MS,
    confirmationPollIntervalMs: LIMITS.CONFIRMATION_POLL_MS,
    explorerBase: "https://explorer.solana.com",
    rpcConfigured: configured !== null || env("SOLANA_RPC_URL") !== null,
  };
}

/** Explorer link — only produced for a known cluster. */
export function explorerTxUrl(signature: string, cluster: SolanaCluster): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `${getNetworkConfig().explorerBase}/tx/${signature}${suffix}`;
}

/**
 * Live execution flag. This is only one of several gates — see
 * evaluateExecutionReadiness() in solanaExecutionGate.server.ts.
 */
export function isLiveExecutionEnvEnabled(): boolean {
  return env("SOLANA_LIVE_EXECUTION_ENABLED") === "true";
}

export const SOL_LAMPORTS = 1_000_000_000;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
