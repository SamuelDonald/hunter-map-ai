// Deterministic, reproducible token-level scoring.
// Pure functions: no clock, no randomness, no AI. Every component is normalized
// to 0-100 before the configured weights are applied.
import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from "./types";

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const round = (v: number, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;

export type ScoringInput = {
  smartMoneyScore: number | null;
  priceChange5m: number | null;
  priceChange1h: number | null;
  volume5m: number | null;
  volume1h: number | null;
  volume24h: number | null;
  liquidity: number | null;
  minLiquidity: number;
  topHolderPercentage: number | null;
  holders: number | null;
  buys5m: number | null;
  sells5m: number | null;
  tokenAgeSeconds: number | null;
  minTokenAge: number;
  maxTokenAge: number;
};

export type ComponentScores = Partial<Record<keyof ScoreWeights, number>>;

export function momentumScore(input: Pick<ScoringInput, "priceChange5m" | "priceChange1h">): number | null {
  const short = input.priceChange5m;
  const medium = input.priceChange1h;
  if (short === null && medium === null) return null;
  const shortPart = short === null ? null : clamp(50 + short * 2);
  const mediumPart = medium === null ? null : clamp(50 + medium * 0.5);
  const parts = [shortPart, mediumPart].filter((v): v is number => v !== null);
  return round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

export function volumeAccelerationScore(input: Pick<ScoringInput, "volume5m" | "volume1h" | "volume24h">): number | null {
  const { volume5m, volume1h, volume24h } = input;
  if (volume5m !== null && volume1h !== null && volume1h > 0) {
    return round(clamp(((volume5m * 12) / volume1h) * 50));
  }
  if (volume1h !== null && volume24h !== null && volume24h > 0) {
    return round(clamp(((volume1h * 24) / volume24h) * 50));
  }
  if (volume1h !== null) return round(clamp(Math.log10(Math.max(volume1h, 1)) * 16));
  return null;
}

export function liquidityQualityScore(liquidity: number | null, minLiquidity: number): number | null {
  if (liquidity === null) return null;
  const floor = minLiquidity > 0 ? minLiquidity : 1;
  return round(clamp((Math.log10(Math.max(liquidity, 1) / floor) + 1) * 50));
}

export function holderDistributionScore(topHolderPercentage: number | null, holders: number | null): number | null {
  if (topHolderPercentage !== null) return round(clamp(100 - topHolderPercentage * 2));
  if (holders !== null) return round(clamp(Math.log10(Math.max(holders, 1)) * 25));
  return null;
}

export function buySellPressureScore(buys: number | null, sells: number | null): number | null {
  if (buys === null && sells === null) return null;
  const b = buys ?? 0;
  const s = sells ?? 0;
  if (b + s === 0) return null;
  return round(clamp((b / (b + s)) * 100));
}

export function tokenAgeScore(age: number | null, min: number, max: number): number | null {
  if (age === null) return null;
  if (age < min) return round(clamp((age / Math.max(min, 1)) * 50));
  if (age > max) return 25;
  return 100;
}

/** Component scores plus the weighted Hunter Score (0-100), or null with no data. */
export function computeScores(
  input: ScoringInput,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): { components: ComponentScores; hunterScore: number | null; momentum: number | null } {
  const components: ComponentScores = {};
  const set = (key: keyof ScoreWeights, value: number | null) => {
    if (value !== null) components[key] = value;
  };

  const momentum = momentumScore(input);
  set("smart_money", input.smartMoneyScore === null ? null : round(clamp(input.smartMoneyScore)));
  set("momentum", momentum);
  set("volume_acceleration", volumeAccelerationScore(input));
  set("liquidity_quality", liquidityQualityScore(input.liquidity, input.minLiquidity));
  set("holder_distribution", holderDistributionScore(input.topHolderPercentage, input.holders));
  set("buy_sell_pressure", buySellPressureScore(input.buys5m, input.sells5m));
  set("token_age", tokenAgeScore(input.tokenAgeSeconds, input.minTokenAge, input.maxTokenAge));

  const present = Object.keys(components) as (keyof ScoreWeights)[];
  if (present.length === 0) return { components, hunterScore: null, momentum };

  const totalWeight = present.reduce((sum, key) => sum + weights[key], 0);
  const weighted = present.reduce((sum, key) => sum + (components[key] ?? 0) * weights[key], 0);
  const hunterScore = round(clamp(weighted / (totalWeight || 1)), 3);
  return { components, hunterScore, momentum };
}
