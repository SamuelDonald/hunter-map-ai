// GMGN response JSON -> internal normalized models.
// Pure functions. A field the provider omits stays null; nothing is invented.
import type { NormalizedToken, NormalizedWallet, NormalizedWalletEvent } from "./gmgnTypes";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));

/** Base58, 32-44 chars — a Solana mint address. */
export function isValidSolanaAddress(address: unknown): address is string {
  return typeof address === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

type Bag = Record<string, unknown>;

function ageSeconds(bag: Bag): number | null {
  const opened = num(bag["open_timestamp"]) ?? num(bag["creation_timestamp"]);
  if (opened === null || opened <= 0) return null;
  return Math.max(0, Math.floor(Date.now() / 1000) - opened);
}

/** Deterministic smart-money score from GMGN's live wallet-participation counts. */
function smartMoneyScore(bag: Bag): number | null {
  const degen = num(bag["smart_degen_count"]);
  const renowned = num(bag["renowned_count"]);
  if (degen === null && renowned === null) return null;
  return Math.round(clamp((degen ?? 0) * 2 + (renowned ?? 0) * 5) * 1000) / 1000;
}

function riskFlags(bag: Bag): string[] {
  const flags: string[] = [];
  if (num(bag["is_honeypot"])) flags.push("HONEYPOT");
  if (bag["is_wash_trading"] === true) flags.push("WASH_TRADING");
  const rug = num(bag["rug_ratio"]);
  if (rug !== null && rug >= 0.5) flags.push("HIGH_RUG_RATIO");
  const bundler = num(bag["bundler_rate"]);
  if (bundler !== null && bundler >= 0.5) flags.push("BUNDLER_HEAVY");
  const rat = num(bag["rat_trader_amount_rate"]);
  if (rat !== null && rat >= 0.1) flags.push("INSIDER_VOLUME");
  const sniper = num(bag["sniper_count"]);
  if (sniper !== null && sniper >= 100) flags.push("SNIPER_HEAVY");
  return flags;
}

/** /v1/market/rank row -> NormalizedToken (discovery already carries full metrics). */
export function normalizeRankRow(raw: unknown, chain: string): NormalizedToken | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Bag;
  const address = str(bag["address"]);
  if (!isValidSolanaAddress(address)) return null;
  const topTen = num(bag["top_10_holder_rate"]);
  const age = ageSeconds(bag);
  return {
    chain: str(bag["chain"]) ?? chain,
    address,
    symbol: str(bag["symbol"]),
    name: str(bag["name"]),
    logoUrl: str(bag["logo"]),
    decimals: num(bag["decimals"]),
    price: num(bag["price"]),
    marketCap: num(bag["market_cap"]),
    liquidity: num(bag["liquidity"]),
    volume5m: null,
    volume1h: num(bag["volume"]),
    volume24h: null,
    priceChange5m: num(bag["price_change_percent5m"]),
    priceChange1h: num(bag["price_change_percent1h"]),
    priceChange24h: num(bag["price_change_percent24h"]),
    buys5m: null,
    sells5m: null,
    holders: num(bag["holder_count"]),
    topHolderPercentage: topTen === null ? null : Math.round(clamp(topTen * 100) * 1000) / 1000,
    tokenAgeSeconds: age,
    smartMoneyScore: smartMoneyScore(bag),
    momentumScore: null,
    isNew: age === null ? null : age < 24 * 3600,
    isVerified: num(bag["is_open_source"]) === 1 ? true : null,
    riskFlags: riskFlags(bag),
    lastMarketUpdate: new Date().toISOString(),
  };
}

/** /v1/token/info -> NormalizedToken with short-window volume and trade counts. */
export function normalizeTokenInfo(raw: unknown, chain: string): NormalizedToken | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Bag;
  const address = str(bag["address"]);
  if (!isValidSolanaAddress(address)) return null;
  const priceBag = (bag["price"] && typeof bag["price"] === "object" ? bag["price"] : {}) as Bag;
  const price = num(priceBag["price"]);
  const pctFrom = (past: unknown): number | null => {
    const p = num(past);
    if (price === null || p === null || p <= 0) return null;
    return Math.round(((price - p) / p) * 100 * 1000) / 1000;
  };
  const age = ageSeconds(bag);
  return {
    chain,
    address,
    symbol: str(bag["symbol"]),
    name: str(bag["name"]),
    logoUrl: str(bag["logo"]),
    decimals: num(bag["decimals"]),
    price,
    marketCap: (() => {
      const supply = num(bag["circulating_supply"]) ?? num(bag["total_supply"]);
      return price !== null && supply !== null ? Math.round(price * supply * 1e6) / 1e6 : null;
    })(),
    liquidity: num(bag["liquidity"]),
    volume5m: num(priceBag["volume_5m"]),
    volume1h: num(priceBag["volume_1h"]),
    volume24h: num(priceBag["volume_24h"]),
    priceChange5m: pctFrom(priceBag["price_5m"]),
    priceChange1h: pctFrom(priceBag["price_1h"]),
    priceChange24h: pctFrom(priceBag["price_24h"]),
    buys5m: num(priceBag["buys_5m"]),
    sells5m: num(priceBag["sells_5m"]),
    holders: num(bag["holder_count"]),
    topHolderPercentage: null,
    tokenAgeSeconds: age,
    smartMoneyScore: smartMoneyScore(bag),
    momentumScore: null,
    isNew: age === null ? null : age < 24 * 3600,
    isVerified: null,
    riskFlags: riskFlags(bag),
    lastMarketUpdate: new Date().toISOString(),
  };
}

const WALLET_TAGS: [string, NormalizedWallet["walletType"]][] = [
  ["bundler", "BUNDLER"],
  ["rat_trader", "INSIDER"],
  ["sneak", "INSIDER"],
  ["whale", "WHALE"],
  ["kol", "KOL"],
  ["renowned", "KOL"],
  ["smart_degen", "SMART_MONEY"],
];

function walletTypeFromTags(tags: string[]): NormalizedWallet["walletType"] {
  const lower = tags.map((t) => t.toLowerCase());
  for (const [needle, type] of WALLET_TAGS) {
    if (lower.some((t) => t.includes(needle))) return type;
  }
  return "UNKNOWN";
}

/** /v1/user/smartmoney trade row -> wallet + wallet activity event. */
export function normalizeSmartMoneyTrade(raw: unknown, chain: string): NormalizedWalletEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Bag;
  const maker = str(bag["maker"]);
  const tokenAddress = str(bag["base_address"]);
  const side = str(bag["side"])?.toUpperCase();
  const timestamp = num(bag["timestamp"]);
  if (!maker || !isValidSolanaAddress(tokenAddress) || (side !== "BUY" && side !== "SELL")) return null;

  const info = (bag["maker_info"] && typeof bag["maker_info"] === "object" ? bag["maker_info"] : {}) as Bag;
  const tags = Array.isArray(info["tags"]) ? (info["tags"] as unknown[]).map((t) => String(t)) : [];
  const baseToken = (bag["base_token"] && typeof bag["base_token"] === "object" ? bag["base_token"] : {}) as Bag;
  const hash = str(bag["transaction_hash"]);
  const occurredAt = new Date((timestamp && timestamp > 0 ? timestamp : Math.floor(Date.now() / 1000)) * 1000).toISOString();

  return {
    wallet: {
      chain,
      address: maker,
      label: str(info["name"]) ?? str(info["twitter_name"]),
      walletType: walletTypeFromTags(tags),
      // GMGN exposes wallet role tags on this feed, not a numeric score.
      smartMoneyScore: null,
      winRate: null,
      realizedPnl: null,
      totalTrades: null,
    },
    tokenChain: chain,
    tokenAddress,
    tokenSymbol: str(baseToken["symbol"]),
    activityType: side,
    amount: num(bag["token_amount"]) ?? num(bag["base_amount"]),
    price: num(bag["price_usd"]) ?? num(bag["price"]),
    amountUsd: num(bag["amount_usd"]),
    transactionHash: hash,
    occurredAt,
    // Deterministic: never random, so replays are ignored on ingest.
    fingerprint: `gmgn:sm:${hash ?? `${maker}:${tokenAddress}:${timestamp ?? 0}`}:${side}`,
  };
}

/** /v1/user/wallet_stats row -> wallet performance, when the plan exposes it. */
export function normalizeWalletStats(raw: unknown, chain: string): NormalizedWallet | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Bag;
  const address = str(bag["wallet_address"]) ?? str(bag["address"]);
  if (!address) return null;
  const winRate = num(bag["winrate"]) ?? num(bag["win_rate"]);
  return {
    chain,
    address,
    label: null,
    walletType: "SMART_MONEY",
    smartMoneyScore: winRate === null ? null : Math.round(clamp(winRate <= 1 ? winRate * 100 : winRate) * 1000) / 1000,
    winRate: winRate === null ? null : Math.round(clamp(winRate <= 1 ? winRate * 100 : winRate) * 1000) / 1000,
    realizedPnl: num(bag["realized_profit"]) ?? num(bag["pnl"]),
    totalTrades: num(bag["buy"]) !== null && num(bag["sell"]) !== null
      ? (num(bag["buy"]) ?? 0) + (num(bag["sell"]) ?? 0)
      : num(bag["total_trades"]),
  };
}
