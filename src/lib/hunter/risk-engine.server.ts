// Centralized server-side risk engine.
// Every proposed trade must pass through evaluateTradeRisk() before it can
// reach any execution provider. A rejected trade never reaches execution.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  RiskDecision,
  RiskSettingsRow,
  StrategyParametersRow,
  StrategyRow,
  TokenRow,
} from "./types";

export type Client = SupabaseClient<Database>;

export type RiskEventType = Database["public"]["Enums"]["risk_event_type"];

export type TradeProposal = {
  userId: string;
  strategy: StrategyRow;
  params: StrategyParametersRow;
  risk: RiskSettingsRow;
  token: TokenRow;
  side: "BUY" | "SELL";
  investedAmount: number;
  slippage: number;
  hunterScore: number | null;
  strategyRiskFlags: string[];
};

const n = (v: unknown) => Number(v ?? 0);

export async function evaluateTradeRisk(
  supabase: Client,
  proposal: TradeProposal,
): Promise<RiskDecision & { event_types: RiskEventType[] }> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const event_types: RiskEventType[] = [];
  let risk_score = 0;

  const { token, params, risk, strategy } = proposal;

  // --- account / bot / strategy status -------------------------------------
  const [{ data: botStatus }, { data: openPositions }, { data: todaysTrades }, { data: recentTrades }] =
    await Promise.all([
      supabase.from("bot_status").select("*").eq("user_id", proposal.userId).maybeSingle(),
      supabase.from("positions").select("id, token_id, invested_amount, current_value").eq("user_id", proposal.userId).in("status", ["OPEN", "CLOSING"]),
      supabase.from("trades").select("realized_pnl").eq("user_id", proposal.userId).gte("closed_at", startOfUtcDay()),
      supabase.from("trades").select("realized_pnl").eq("user_id", proposal.userId).order("closed_at", { ascending: false }).limit(20),
    ]);

  if (!botStatus) {
    reasons.push("BOT_STATE_UNKNOWN");
    event_types.push("SYSTEM_ERROR");
  } else {
    if (botStatus.state === "KILLED") {
      reasons.push("BOT_KILLED_REQUIRES_MANUAL_RESET");
      event_types.push("MANUAL_KILL");
    }
    if (botStatus.state === "RISK_PAUSED") {
      reasons.push("BOT_RISK_PAUSED");
      event_types.push("SYSTEM_ERROR");
    }
    if (["OFFLINE", "PAUSED", "ERROR"].includes(botStatus.state)) reasons.push(`BOT_NOT_TRADING_${botStatus.state}`);
  }

  if (!strategy.enabled) reasons.push("STRATEGY_DISABLED");
  if (strategy.mode === "LIVE") reasons.push("LIVE_EXECUTION_NOT_CONFIGURED");

  // --- token gates ---------------------------------------------------------
  if (token.is_blacklisted) {
    reasons.push("BLACKLISTED_TOKEN");
    event_types.push("BLACKLISTED_TOKEN");
  }
  if (token.price === null) reasons.push("NO_MARKET_PRICE");
  if (token.liquidity === null) {
    reasons.push("LIQUIDITY_UNKNOWN");
    event_types.push("LOW_LIQUIDITY");
  } else if (n(token.liquidity) < n(params.min_liquidity)) {
    reasons.push(`LIQUIDITY_BELOW_MIN_${n(params.min_liquidity)}`);
    event_types.push("LOW_LIQUIDITY");
    risk_score += 25;
  }
  if (token.volume_1h !== null && n(token.volume_1h) < n(params.min_volume)) {
    warnings.push("VOLUME_BELOW_STRATEGY_MIN");
    risk_score += 5;
  }
  if (proposal.hunterScore === null) {
    reasons.push("HUNTER_SCORE_UNAVAILABLE");
    event_types.push("LOW_SCORE");
  } else if (proposal.hunterScore < n(params.hunter_score_min)) {
    reasons.push(`HUNTER_SCORE_BELOW_MIN_${n(params.hunter_score_min)}`);
    event_types.push("LOW_SCORE");
    risk_score += 20;
  }
  if (token.smart_money_score !== null && n(token.smart_money_score) < n(params.smart_money_score_min)) {
    reasons.push(`SMART_MONEY_BELOW_MIN_${n(params.smart_money_score_min)}`);
    event_types.push("LOW_SCORE");
    risk_score += 10;
  }
  const age = token.token_age_seconds === null ? null : Number(token.token_age_seconds);
  if (age !== null && age < n(params.min_token_age)) reasons.push("TOKEN_TOO_NEW");
  if (age !== null && age > n(params.max_token_age)) reasons.push("TOKEN_TOO_OLD");
  for (const flag of proposal.strategyRiskFlags) {
    if (!warnings.includes(flag)) warnings.push(flag);
  }

  // --- sizing / exposure ---------------------------------------------------
  const positions = openPositions ?? [];
  const positionCap = Math.min(n(params.max_positions), n(risk.max_positions));
  if (proposal.side === "BUY" && positions.length >= positionCap) {
    reasons.push(`MAX_POSITIONS_${positionCap}`);
    event_types.push("MAX_POSITIONS");
    risk_score += 15;
  }
  if (proposal.side === "BUY" && positions.some((p) => p.token_id === token.id)) {
    reasons.push("DUPLICATE_POSITION");
    risk_score += 10;
  }

  const exposure = positions.reduce((sum, p) => sum + n(p.current_value ?? p.invested_amount), 0);
  const exposureCap = Math.min(n(params.max_exposure), n(risk.max_exposure));
  if (proposal.side === "BUY" && exposure + proposal.investedAmount > exposureCap) {
    reasons.push(`MAX_EXPOSURE_${exposureCap}`);
    event_types.push("MAX_EXPOSURE");
    risk_score += 20;
  }
  if (proposal.investedAmount <= 0) reasons.push("INVALID_POSITION_SIZE");
  if (proposal.investedAmount > n(params.position_size)) {
    reasons.push(`POSITION_SIZE_ABOVE_STRATEGY_${n(params.position_size)}`);
    risk_score += 10;
  }
  const worstCaseLoss = proposal.investedAmount * (n(params.stop_loss_percent) / 100);
  if (worstCaseLoss > n(risk.max_trade_loss)) {
    reasons.push(`TRADE_LOSS_LIMIT_${n(risk.max_trade_loss)}`);
    event_types.push("TRADE_LOSS_LIMIT");
    risk_score += 15;
  }

  const slippageCap = Math.min(n(params.max_slippage), n(risk.max_slippage));
  if (proposal.slippage > slippageCap) {
    reasons.push(`SLIPPAGE_ABOVE_MAX_${slippageCap}`);
    event_types.push("HIGH_SLIPPAGE");
    risk_score += 15;
  }

  // --- daily loss / losing streak -----------------------------------------
  const dailyPnl = (todaysTrades ?? []).reduce((sum, t) => sum + n(t.realized_pnl), 0);
  if (dailyPnl < 0 && Math.abs(dailyPnl) >= n(risk.max_daily_loss)) {
    reasons.push(`DAILY_LOSS_LIMIT_${n(risk.max_daily_loss)}`);
    event_types.push("DAILY_LOSS_LIMIT");
    risk_score += 30;
  } else if (dailyPnl < 0 && Math.abs(dailyPnl) >= n(risk.max_daily_loss) * 0.8) {
    warnings.push("DAILY_LOSS_APPROACHING_LIMIT");
    risk_score += 10;
  }

  let streak = 0;
  for (const trade of recentTrades ?? []) {
    if (n(trade.realized_pnl) < 0) streak += 1;
    else break;
  }
  if (streak >= n(risk.consecutive_loss_limit)) {
    reasons.push(`CONSECUTIVE_LOSSES_${streak}`);
    event_types.push("CONSECUTIVE_LOSSES");
    risk_score += 20;
  }

  return {
    approved: reasons.length === 0,
    risk_score: Math.min(100, risk_score),
    reasons,
    warnings,
    event_types: [...new Set(event_types)],
  };
}

export function startOfUtcDay(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function logRiskEvents(
  supabase: Client,
  input: {
    userId: string;
    strategyId: string | null;
    tokenId: string | null;
    orderId: string | null;
    decision: RiskDecision & { event_types: RiskEventType[] };
  },
) {
  const types: RiskEventType[] = input.decision.event_types.length
    ? input.decision.event_types
    : ["SYSTEM_ERROR"];
  await supabase.from("risk_events").insert(
    types.map((event_type) => ({
      user_id: input.userId,
      strategy_id: input.strategyId,
      token_id: input.tokenId,
      order_id: input.orderId,
      event_type,
      severity: "WARNING" as const,
      message: input.decision.reasons.join(", ") || "Risk check failed",
      metadata: { reasons: input.decision.reasons, warnings: input.decision.warnings, risk_score: input.decision.risk_score },
    })),
  );
}
