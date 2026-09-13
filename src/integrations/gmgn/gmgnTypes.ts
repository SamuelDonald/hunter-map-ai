// Provider-independent internal models. Nothing downstream of the adapters
// should ever see a GMGN-shaped object.

export type GmgnCapability =
  | "ACCOUNT"
  | "TOKEN_DISCOVERY"
  | "TOKEN_INFO"
  | "TOKEN_SECURITY"
  | "TOKEN_HOLDERS"
  | "SMART_MONEY"
  | "WALLET_STATS";

export type CapabilityState = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

export type IntegrationStatus = "NOT_CONFIGURED" | "CONNECTING" | "CONNECTED" | "DEGRADED" | "ERROR";

export type IntegrationHealth = {
  provider: string;
  status: IntegrationStatus;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  latency_ms: number | null;
  capabilities: Partial<Record<GmgnCapability, CapabilityState>>;
  paused_until: string | null;
  updated_at: string | null;
};

/** Strictly nullable: a field the provider did not return stays null. */
export type NormalizedToken = {
  chain: string;
  address: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  decimals: number | null;
  price: number | null;
  marketCap: number | null;
  liquidity: number | null;
  volume5m: number | null;
  volume1h: number | null;
  volume24h: number | null;
  priceChange5m: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  buys5m: number | null;
  sells5m: number | null;
  holders: number | null;
  topHolderPercentage: number | null;
  tokenAgeSeconds: number | null;
  smartMoneyScore: number | null;
  momentumScore: number | null;
  isNew: boolean | null;
  isVerified: boolean | null;
  riskFlags: string[];
  lastMarketUpdate: string;
};

export type NormalizedWallet = {
  chain: string;
  address: string;
  label: string | null;
  walletType: "SMART_MONEY" | "KOL" | "WHALE" | "INSIDER" | "BUNDLER" | "UNKNOWN";
  smartMoneyScore: number | null;
  winRate: number | null;
  realizedPnl: number | null;
  totalTrades: number | null;
};

export type NormalizedWalletEvent = {
  wallet: NormalizedWallet;
  tokenChain: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  activityType: "BUY" | "SELL";
  amount: number | null;
  price: number | null;
  amountUsd: number | null;
  transactionHash: string | null;
  occurredAt: string;
  /** Stable provider fingerprint used for idempotent ingestion. */
  fingerprint: string;
};
