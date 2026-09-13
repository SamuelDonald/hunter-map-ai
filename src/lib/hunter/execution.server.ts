// Server-side execution helpers shared by the manual (UI) path and the
// autonomous scanner. The order is always the same and can never be skipped:
// TOKEN DATA -> STRATEGY -> HUNTER SCORE -> STRATEGY VALIDATION -> RISK ENGINE
// -> EXECUTION PROVIDER -> POSITION.
import { evaluateToken } from "./strategy-engine";
import { evaluateTradeRisk, logRiskEvents, type Client } from "./risk-engine.server";
import { getExecutionProvider } from "./providers.server";
import type { PositionRow, RiskSettingsRow, StrategyParametersRow, StrategyRow, TokenRow } from "./types";

export type AutoEntryResult = {
  opened: boolean;
  reason: string;
  orderId: string | null;
  positionId: string | null;
  hunterScore: number | null;
};

/**
 * Opens one position after full strategy + risk validation.
 * A rejected proposal is persisted as a REJECTED order plus risk events and
 * never reaches the execution provider.
 */
export async function openPositionInternal(
  supabase: Client,
  input: {
    userId: string;
    strategy: StrategyRow;
    params: StrategyParametersRow;
    risk: RiskSettingsRow;
    token: TokenRow;
    idempotencyKey: string;
    source: string;
  },
): Promise<AutoEntryResult> {
  const { userId, strategy, params, risk, token, idempotencyKey } = input;

  const { data: existing } = await supabase
    .from("orders")
    .select("id, status, position_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) {
    return {
      opened: false,
      reason: "DUPLICATE_REQUEST_IGNORED",
      orderId: existing.id,
      positionId: existing.position_id,
      hunterScore: null,
    };
  }

  const evaluation = evaluateToken(token, params);
  if (evaluation.signal !== "BUY") {
    return { opened: false, reason: `STRATEGY_${evaluation.signal}`, orderId: null, positionId: null, hunterScore: evaluation.hunter_score };
  }

  const investedAmount = Number(params.position_size);
  const price = Number(token.price ?? 0);

  const decision = await evaluateTradeRisk(supabase, {
    userId,
    strategy,
    params,
    risk,
    token,
    side: "BUY",
    investedAmount,
    slippage: 0,
    hunterScore: evaluation.hunter_score,
    strategyRiskFlags: evaluation.risk_flags,
  });

  const provider = getExecutionProvider(strategy.mode);
  const baseOrder = {
    user_id: userId,
    strategy_id: strategy.id,
    token_id: token.id,
    side: "BUY" as const,
    order_type: "MARKET" as const,
    quantity: price > 0 ? investedAmount / price : null,
    requested_price: token.price,
    execution_provider: provider.name,
    idempotency_key: idempotencyKey,
    risk_snapshot: {
      source: input.source,
      hunter_score: evaluation.hunter_score,
      component_scores: evaluation.component_scores,
      reason_codes: evaluation.reason_codes,
      risk_flags: evaluation.risk_flags,
      risk_score: decision.risk_score,
      reasons: decision.reasons,
      warnings: decision.warnings,
    },
  };

  if (!decision.approved) {
    const { data: rejected } = await supabase
      .from("orders")
      .insert({ ...baseOrder, status: "REJECTED", failure_reason: decision.reasons.join(", ") })
      .select("id")
      .single();
    await logRiskEvents(supabase, {
      userId, strategyId: strategy.id, tokenId: token.id, orderId: rejected?.id ?? null, decision,
    });
    await supabase.from("system_logs").insert({
      user_id: userId, level: "WARNING", component: "RISK_ENGINE", event: "TRADE_REJECTED",
      message: decision.reasons.join(", "), metadata: baseOrder.risk_snapshot,
    });
    return {
      opened: false,
      reason: decision.reasons.join(", "),
      orderId: rejected?.id ?? null,
      positionId: null,
      hunterScore: evaluation.hunter_score,
    };
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({ ...baseOrder, status: "APPROVED" })
    .select("*")
    .single();
  if (orderError || !order) {
    return { opened: false, reason: orderError?.message ?? "ORDER_INSERT_FAILED", orderId: null, positionId: null, hunterScore: evaluation.hunter_score };
  }

  await supabase.from("orders").update({ status: "SUBMITTED", submitted_at: new Date().toISOString() }).eq("id", order.id);

  const execution = await provider.createOrder({
    userId,
    strategyId: strategy.id,
    tokenId: token.id,
    side: "BUY",
    orderType: "MARKET",
    quantity: Number(order.quantity ?? 0),
    requestedPrice: price,
    maxSlippage: Number(params.max_slippage),
    idempotencyKey,
  });

  if (!execution.ok) {
    await supabase.from("orders").update({ status: "FAILED", failure_reason: execution.error }).eq("id", order.id);
    await supabase.from("system_logs").insert({
      user_id: userId, level: "ERROR", component: "EXECUTION", event: "EXECUTION_FAILED",
      message: execution.error, metadata: { provider: provider.name, status: execution.status },
    });
    return { opened: false, reason: execution.error, orderId: order.id, positionId: null, hunterScore: evaluation.hunter_score };
  }

  const fill = execution.data;
  const invested = fill.executedPrice * fill.filledQuantity;
  const { data: position, error: positionError } = await supabase
    .from("positions")
    .insert({
      user_id: userId,
      strategy_id: strategy.id,
      token_id: token.id,
      status: "OPEN",
      entry_price: fill.executedPrice,
      current_price: fill.executedPrice,
      quantity: fill.filledQuantity,
      invested_amount: invested,
      current_value: invested,
      unrealized_pnl: 0,
      unrealized_pnl_percent: 0,
      take_profit_price: fill.executedPrice * Number(params.take_profit_multiplier),
      stop_loss_price: fill.executedPrice * (1 - Number(params.stop_loss_percent) / 100),
      trailing_stop_price: params.trailing_stop_enabled
        ? fill.executedPrice * (1 - Number(params.trailing_stop_percent) / 100)
        : null,
      execution_provider: provider.name,
    })
    .select("id")
    .single();

  if (positionError || !position) {
    await supabase.from("orders").update({ status: "FAILED", failure_reason: positionError?.message ?? "POSITION_INSERT_FAILED" }).eq("id", order.id);
    return { opened: false, reason: positionError?.message ?? "POSITION_INSERT_FAILED", orderId: order.id, positionId: null, hunterScore: evaluation.hunter_score };
  }

  await supabase
    .from("orders")
    .update({
      status: fill.status,
      executed_price: fill.executedPrice,
      slippage: fill.slippage,
      external_order_id: fill.externalOrderId,
      executed_at: new Date().toISOString(),
      position_id: position.id,
    })
    .eq("id", order.id);

  await supabase.from("system_logs").insert({
    user_id: userId, level: "INFO", component: "EXECUTION", event: "POSITION_OPENED",
    message: `Opened ${provider.name} position on ${token.symbol ?? token.address}`,
    metadata: { order_id: order.id, position_id: position.id, source: input.source, hunter_score: evaluation.hunter_score },
  });

  return { opened: true, reason: "OPENED", orderId: order.id, positionId: position.id, hunterScore: evaluation.hunter_score };
}

/** Closes a position at a real market price and writes the immutable trade record. */
export async function closePositionInternal(
  supabase: Client,
  input: { position: PositionRow; exitPrice: number; reason: string; idempotencyKey: string },
): Promise<{ closed: boolean; reason: string; realizedPnl: number | null }> {
  const { position, exitPrice, reason, idempotencyKey } = input;
  if (!(exitPrice > 0)) return { closed: false, reason: "NO_MARKET_PRICE", realizedPnl: null };

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return { closed: false, reason: "DUPLICATE_REQUEST_IGNORED", realizedPnl: null };

  const provider = getExecutionProvider(position.execution_provider === "GMGN" ? "LIVE" : "PAPER");
  await supabase.from("positions").update({ status: "CLOSING" }).eq("id", position.id);

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: position.user_id, strategy_id: position.strategy_id, token_id: position.token_id,
      position_id: position.id, side: "SELL", order_type: "MARKET", quantity: position.quantity,
      requested_price: exitPrice, status: "SUBMITTED", execution_provider: provider.name,
      idempotency_key: idempotencyKey, submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !order) {
    await supabase.from("positions").update({ status: "OPEN" }).eq("id", position.id);
    return { closed: false, reason: error?.message ?? "ORDER_INSERT_FAILED", realizedPnl: null };
  }

  const execution = await provider.createOrder({
    userId: position.user_id, strategyId: position.strategy_id ?? "", tokenId: position.token_id ?? "",
    side: "SELL", orderType: "MARKET", quantity: Number(position.quantity ?? 0), requestedPrice: exitPrice,
    maxSlippage: 0, idempotencyKey,
  });
  if (!execution.ok) {
    await supabase.from("orders").update({ status: "FAILED", failure_reason: execution.error }).eq("id", order.id);
    await supabase.from("positions").update({ status: "OPEN" }).eq("id", position.id);
    return { closed: false, reason: execution.error, realizedPnl: null };
  }

  const fill = execution.data;
  const exitValue = fill.executedPrice * fill.filledQuantity;
  const invested = Number(position.invested_amount ?? 0);
  const pnl = exitValue - invested;

  await supabase
    .from("orders")
    .update({ status: "FILLED", executed_price: fill.executedPrice, executed_at: new Date().toISOString(), external_order_id: fill.externalOrderId })
    .eq("id", order.id);
  await supabase
    .from("positions")
    .update({
      status: "CLOSED", closed_at: new Date().toISOString(), close_reason: reason,
      current_price: fill.executedPrice, current_value: exitValue, unrealized_pnl: 0, unrealized_pnl_percent: 0,
    })
    .eq("id", position.id);
  await supabase.from("trades").insert({
    user_id: position.user_id, strategy_id: position.strategy_id, position_id: position.id,
    token_id: position.token_id, order_id: order.id, side: "SELL", entry_price: position.entry_price,
    exit_price: fill.executedPrice, quantity: fill.filledQuantity, invested_amount: invested,
    exit_value: exitValue, realized_pnl: pnl, realized_pnl_percent: invested > 0 ? (pnl / invested) * 100 : null,
    slippage: fill.slippage, execution_provider: provider.name, opened_at: position.opened_at, close_reason: reason,
  });
  await supabase.from("system_logs").insert({
    user_id: position.user_id, level: "INFO", component: "EXECUTION", event: "POSITION_CLOSED",
    message: `Closed position (${reason}) with P&L ${pnl.toFixed(4)}`,
    metadata: { position_id: position.id, order_id: order.id, reason },
  });

  return { closed: true, reason, realizedPnl: pnl };
}
