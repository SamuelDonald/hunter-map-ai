// Shared, browser-safe types for the HUNTER 2X trading pipeline.
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type TokenRow = Tables["tokens"]["Row"];
export type StrategyRow = Tables["strategies"]["Row"];
export type StrategyParametersRow = Tables["strategy_parameters"]["Row"];
export type RiskSettingsRow = Tables["risk_settings"]["Row"];
export type PositionRow = Tables["positions"]["Row"];
export type OrderRow = Tables["orders"]["Row"];
export type TradeRow = Tables["trades"]["Row"];
export type SignalRow = Tables["signals"]["Row"];
export type RiskEventRow = Tables["risk_events"]["Row"];
export type BotStatusRow = Tables["bot_status"]["Row"];
export type BotSessionRow = Tables["bot_sessions"]["Row"];
export type WalletRow = Tables["wallets"]["Row"];
export type TokenRelationshipRow = Tables["token_relationships"]["Row"];
export type SystemLogRow = Tables["system_logs"]["Row"];
export type PortfolioSnapshotRow = Tables["portfolio_snapshots"]["Row"];

export type BotState = Database["public"]["Enums"]["bot_state"];
export type StrategyMode = Database["public"]["Enums"]["strategy_mode"];
export type ExecutionProviderName = Database["public"]["Enums"]["execution_provider"];
export type OrderSide = Database["public"]["Enums"]["order_side"];

/** Score weights, configurable per strategy via strategy_parameters.score_weights. */
export type ScoreWeights = {
  smart_money: number;
  momentum: number;
  volume_acceleration: number;
  liquidity_quality: number;
  holder_distribution: number;
  buy_sell_pressure: number;
  token_age: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  smart_money: 25,
  momentum: 20,
  volume_acceleration: 15,
  liquidity_quality: 15,
  holder_distribution: 10,
  buy_sell_pressure: 10,
  token_age: 5,
};

export type StrategySignal = "BUY" | "WATCH" | "CAUTION" | "NO_DATA";

export type StrategyEvaluation = {
  hunter_score: number | null;
  component_scores: Partial<Record<keyof ScoreWeights, number>>;
  signal: StrategySignal;
  reason_codes: string[];
  risk_flags: string[];
  data_available: boolean;
};

export type RiskDecision = {
  approved: boolean;
  risk_score: number;
  reasons: string[];
  warnings: string[];
};

/** Provider availability. Providers that are not wired up report NOT_CONFIGURED. */
export type ProviderStatus = "READY" | "NOT_CONFIGURED" | "UNAVAILABLE";

export type ProviderState = { name: string; status: ProviderStatus; detail?: string };
