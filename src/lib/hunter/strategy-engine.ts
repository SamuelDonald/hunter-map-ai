// Deterministic, explainable strategy engine.
// Pure functions only — no database, no randomness, no clock reads.
import {
  DEFAULT_SCORE_WEIGHTS,
  type ScoreWeights,
  type StrategyEvaluation,
  type StrategyParametersRow,
  type TokenRow,
} from "./types";

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const num = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

export function resolveWeights(raw: unknown): ScoreWeights {
  if (!raw || typeof raw !== "object") return DEFAULT_SCORE_WEIGHTS;
  const source = raw as Record<string, unknown>;
  const out = { ...DEFAULT_SCORE_WEIGHTS };
  for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS) as (keyof ScoreWeights)[]) {
    const value = num(source[key]);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * evaluateToken — turns real token intelligence into a Hunter Score.
 * Every component records the reason it contributed, so a score can always
 * be explained. Missing market data is never substituted with a guess.
 */
export function evaluateToken(token: TokenRow, params: StrategyParametersRow): StrategyEvaluation {
  const weights = resolveWeights(params.score_weights);
  const reason_codes: string[] = [];
  const risk_flags: string[] = [];
  const component_scores: StrategyEvaluation["component_scores"] = {};

  const price = num(token.price);
  const liquidity = num(token.liquidity);
  const smartMoney = num(token.smart_money_score);
  const change5m = num(token.price_change_5m);
  const volume5m = num(token.volume_5m);
  const volume1h = num(token.volume_1h);
  const topHolder = num(token.top_holder_percentage);
  const ratio = num(token.buy_sell_ratio);
  const age = num(token.token_age_seconds);

  if (smartMoney !== null) {
    component_scores.smart_money = clamp(smartMoney);
    reason_codes.push(`SMART_MONEY_SCORE_${Math.round(smartMoney)}`);
  }
  if (change5m !== null) {
    component_scores.momentum = clamp(50 + change5m * 2);
    reason_codes.push(change5m >= 0 ? `MOMENTUM_UP_${change5m.toFixed(1)}PCT` : `MOMENTUM_DOWN_${change5m.toFixed(1)}PCT`);
  }
  if (volume5m !== null && volume1h !== null && volume1h > 0) {
    const accel = (volume5m * 12) / volume1h;
    component_scores.volume_acceleration = clamp(accel * 50);
    reason_codes.push(`VOLUME_ACCEL_${accel.toFixed(2)}X`);
  }
  if (liquidity !== null) {
    const floor = Number(params.min_liquidity) || 1;
    component_scores.liquidity_quality = clamp((Math.log10(Math.max(liquidity, 1) / floor) + 1) * 50);
    reason_codes.push(`LIQUIDITY_${Math.round(liquidity)}`);
    if (liquidity < floor) risk_flags.push("BELOW_MIN_LIQUIDITY");
  }
  if (topHolder !== null) {
    component_scores.holder_distribution = clamp(100 - topHolder * 2);
    reason_codes.push(`TOP_HOLDER_${topHolder.toFixed(1)}PCT`);
    if (topHolder > 30) risk_flags.push("HOLDER_CONCENTRATION");
  }
  if (ratio !== null) {
    component_scores.buy_sell_pressure = clamp(ratio * 50);
    reason_codes.push(`BUY_SELL_RATIO_${ratio.toFixed(2)}`);
    if (ratio < 0.8) risk_flags.push("SELL_PRESSURE");
  }
  if (age !== null) {
    const min = Number(params.min_token_age);
    const max = Number(params.max_token_age);
    const inWindow = age >= min && age <= max;
    component_scores.token_age = inWindow ? 100 : 25;
    reason_codes.push(`TOKEN_AGE_${Math.round(age)}S`);
    if (age < min) risk_flags.push("TOKEN_TOO_NEW");
    if (age > max) risk_flags.push("TOKEN_TOO_OLD");
  }

  if (token.is_blacklisted) risk_flags.push("BLACKLISTED_TOKEN");
  if (price === null) risk_flags.push("NO_PRICE_DATA");

  const present = (Object.keys(component_scores) as (keyof ScoreWeights)[]);
  if (present.length === 0) {
    return {
      hunter_score: null,
      component_scores,
      signal: "NO_DATA",
      reason_codes: ["NO_MARKET_DATA"],
      risk_flags: [...risk_flags, "MISSING_MARKET_DATA"],
      data_available: false,
    };
  }

  const totalWeight = present.reduce((sum, key) => sum + weights[key], 0);
  const weighted = present.reduce((sum, key) => sum + (component_scores[key] ?? 0) * weights[key], 0);
  const hunter_score = Math.round((weighted / (totalWeight || 1)) * 10) / 10;

  if (present.length < 5) {
    reason_codes.push("PARTIAL_MARKET_DATA");
    risk_flags.push("PARTIAL_MARKET_DATA");
  }

  const min = Number(params.hunter_score_min);
  const smartFloor = Number(params.smart_money_score_min);
  const blocking = risk_flags.some((f) =>
    ["BLACKLISTED_TOKEN", "BELOW_MIN_LIQUIDITY", "NO_PRICE_DATA", "TOKEN_TOO_NEW", "TOKEN_TOO_OLD"].includes(f),
  );

  let signal: StrategyEvaluation["signal"] = "CAUTION";
  if (!blocking && hunter_score >= min && (smartMoney === null || smartMoney >= smartFloor)) signal = "BUY";
  else if (!blocking && hunter_score >= min - 10) signal = "WATCH";

  reason_codes.push(`HUNTER_SCORE_${hunter_score}`, `THRESHOLD_${min}`, `SIGNAL_${signal}`);

  return { hunter_score, component_scores, signal, reason_codes, risk_flags, data_available: true };
}
