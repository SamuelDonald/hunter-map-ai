import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateToken } from "./strategy-engine";
import type { OrderRow, PositionRow, RiskEventRow, SignalRow, TradeRow } from "./types";

export type PositionWithToken = PositionRow & { token: { symbol: string | null; address: string; hunter_score: number | null } | null };
export type TradeWithToken = TradeRow & { token: { symbol: string | null } | null };

export const listPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PositionWithToken[]> => {
    const { data, error } = await context.supabase
      .from("positions")
      .select("*, token:tokens(symbol, address, hunter_score)")
      .eq("user_id", context.userId)
      .order("opened_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PositionWithToken[];
  });

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrderRow[]> => {
    const { data } = await context.supabase
      .from("orders")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

export const listTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TradeWithToken[]> => {
    const { data } = await context.supabase
      .from("trades")
      .select("*, token:tokens(symbol)")
      .eq("user_id", context.userId)
      .order("closed_at", { ascending: false })
      .limit(200);
    return (data ?? []) as TradeWithToken[];
  });

export const listSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<(SignalRow & { token: { symbol: string | null } | null })[]> => {
    const { data } = await context.supabase
      .from("signals")
      .select("*, token:tokens(symbol)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(40);
    return (data ?? []) as (SignalRow & { token: { symbol: string | null } | null })[];
  });

export const listRiskEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RiskEventRow[]> => {
    const { data } = await context.supabase
      .from("risk_events")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(40);
    return data ?? [];
  });

/** Account-level portfolio view, derived from stored positions and trades only. */
export const getPortfolioSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { startOfUtcDay } = await import("./risk-engine.server");
    const [{ data: positions }, { data: trades }, { data: today }] = await Promise.all([
      supabase.from("positions").select("invested_amount, current_value, unrealized_pnl, status").eq("user_id", userId).in("status", ["OPEN", "CLOSING"]),
      supabase.from("trades").select("realized_pnl").eq("user_id", userId),
      supabase.from("trades").select("realized_pnl").eq("user_id", userId).gte("closed_at", startOfUtcDay()),
    ]);
    const open = positions ?? [];
    const allTrades = trades ?? [];
    const n = (v: unknown) => Number(v ?? 0);
    const invested = open.reduce((s, p) => s + n(p.invested_amount), 0);
    const value = open.reduce((s, p) => s + n(p.current_value ?? p.invested_amount), 0);
    const unrealized = open.reduce((s, p) => s + n(p.unrealized_pnl), 0);
    const realized = allTrades.reduce((s, t) => s + n(t.realized_pnl), 0);
    const wins = allTrades.filter((t) => n(t.realized_pnl) > 0);
    const losses = allTrades.filter((t) => n(t.realized_pnl) < 0);
    return {
      open_positions: open.length,
      invested_amount: invested,
      total_exposure: value,
      unrealized_pnl: unrealized,
      realized_pnl: realized,
      today_pnl: (today ?? []).reduce((s, t) => s + n(t.realized_pnl), 0),
      trades_today: (today ?? []).length,
      total_trades: allTrades.length,
      win_rate: allTrades.length ? (wins.length / allTrades.length) * 100 : null,
      average_winner: wins.length ? wins.reduce((s, t) => s + n(t.realized_pnl), 0) / wins.length : null,
      average_loser: losses.length ? losses.reduce((s, t) => s + n(t.realized_pnl), 0) / losses.length : null,
      profit_factor: losses.length
        ? wins.reduce((s, t) => s + n(t.realized_pnl), 0) / Math.abs(losses.reduce((s, t) => s + n(t.realized_pnl), 0))
        : null,
    };
  });

export type TradeDecision = {
  approved: boolean;
  order_id: string | null;
  position_id: string | null;
  hunter_score: number | null;
  risk_score: number;
  reasons: string[];
  warnings: string[];
  reason_codes: string[];
  status: string;
};

/**
 * The single entry point for opening a position.
 * Strategy engine → risk engine → order lifecycle → execution provider → position.
 * A rejected proposal is persisted as a REJECTED order and never executed.
 */
export const proposeTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { strategyId: string; tokenId: string; idempotencyKey: string; investedAmount?: number }) => {
    if (!input.strategyId || !input.tokenId) throw new Error("strategyId and tokenId are required");
    if (!input.idempotencyKey) throw new Error("idempotencyKey is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<TradeDecision> => {
    const { supabase, userId } = context;
    const { evaluateTradeRisk, logRiskEvents } = await import("./risk-engine.server");
    const { getExecutionProvider } = await import("./providers.server");

    // idempotency: never re-run an order that already exists
    const { data: existing } = await supabase
      .from("orders")
      .select("*")
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();
    if (existing) {
      return {
        approved: existing.status === "FILLED",
        order_id: existing.id,
        position_id: existing.position_id,
        hunter_score: null,
        risk_score: 0,
        reasons: existing.failure_reason ? [existing.failure_reason] : ["DUPLICATE_REQUEST_IGNORED"],
        warnings: [],
        reason_codes: [],
        status: existing.status,
      };
    }

    const [{ data: strategy }, { data: token }, { data: risk }] = await Promise.all([
      supabase.from("strategies").select("*").eq("id", data.strategyId).eq("user_id", userId).maybeSingle(),
      supabase.from("tokens").select("*").eq("id", data.tokenId).maybeSingle(),
      supabase.from("risk_settings").select("*").eq("user_id", userId).maybeSingle(),
    ]);
    if (!strategy) throw new Error("Strategy not found");
    if (!token) throw new Error("Token not found");
    if (!risk) throw new Error("Risk settings missing for this account");

    const { data: params } = await supabase
      .from("strategy_parameters")
      .select("*")
      .eq("strategy_id", strategy.id)
      .maybeSingle();
    if (!params) throw new Error("Strategy parameters missing");

    const evaluation = evaluateToken(token, params);
    const investedAmount = data.investedAmount ?? Number(params.position_size);
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
      idempotency_key: data.idempotencyKey,
      risk_snapshot: {
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
        approved: false, order_id: rejected?.id ?? null, position_id: null,
        hunter_score: evaluation.hunter_score, risk_score: decision.risk_score,
        reasons: decision.reasons, warnings: decision.warnings, reason_codes: evaluation.reason_codes,
        status: "REJECTED",
      };
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({ ...baseOrder, status: "APPROVED" })
      .select("*")
      .single();
    if (orderError) throw new Error(orderError.message);

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
      idempotencyKey: data.idempotencyKey,
    });

    if (!execution.ok) {
      await supabase.from("orders").update({ status: "FAILED", failure_reason: execution.error }).eq("id", order.id);
      await supabase.from("system_logs").insert({
        user_id: userId, level: "ERROR", component: "EXECUTION", event: "EXECUTION_FAILED",
        message: execution.error, metadata: { provider: provider.name, status: execution.status },
      });
      return {
        approved: false, order_id: order.id, position_id: null, hunter_score: evaluation.hunter_score,
        risk_score: decision.risk_score, reasons: [execution.error], warnings: decision.warnings,
        reason_codes: evaluation.reason_codes, status: "FAILED",
      };
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
    if (positionError) {
      await supabase.from("orders").update({ status: "FAILED", failure_reason: positionError.message }).eq("id", order.id);
      throw new Error(positionError.message);
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

    await supabase.from("signals").insert({
      user_id: userId, token_id: token.id, signal_type: "SMART_MONEY_BUY", direction: "BULLISH",
      confidence: evaluation.hunter_score, hunter_score: evaluation.hunter_score,
      reason_codes: evaluation.reason_codes, source: "STRATEGY_ENGINE", status: "ACTED",
    });
    await supabase.from("system_logs").insert({
      user_id: userId, level: "INFO", component: "EXECUTION", event: "POSITION_OPENED",
      message: `Opened ${provider.name} position`, metadata: { order_id: order.id, position_id: position.id },
    });

    return {
      approved: true, order_id: order.id, position_id: position.id, hunter_score: evaluation.hunter_score,
      risk_score: decision.risk_score, reasons: [], warnings: decision.warnings,
      reason_codes: evaluation.reason_codes, status: fill.status,
    };
  });

/** Closes a position through the same order lifecycle and records a trade. */
export const closePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { positionId: string; idempotencyKey: string; reason?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { getExecutionProvider } = await import("./providers.server");

    const { data: existing } = await supabase.from("orders").select("id, status").eq("idempotency_key", data.idempotencyKey).maybeSingle();
    if (existing) return { ok: existing.status === "FILLED", duplicate: true, order_id: existing.id };

    const { data: position } = await supabase
      .from("positions")
      .select("*, token:tokens(price)")
      .eq("id", data.positionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!position) throw new Error("Position not found");
    if (position.status !== "OPEN") throw new Error(`Position is ${position.status}`);

    const tokenPrice = Number((position as unknown as { token: { price: number | null } | null }).token?.price ?? 0);
    const exitPrice = tokenPrice > 0 ? tokenPrice : Number(position.current_price ?? 0);
    if (!(exitPrice > 0)) {
      await supabase.from("system_logs").insert({
        user_id: userId, level: "ERROR", component: "EXECUTION", event: "CLOSE_BLOCKED",
        message: "No market price available to close position", metadata: { position_id: position.id },
      });
      throw new Error("No market price available — data source not connected");
    }

    await supabase.from("positions").update({ status: "CLOSING" }).eq("id", position.id);
    const provider = getExecutionProvider(position.execution_provider === "GMGN" ? "LIVE" : "PAPER");

    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        user_id: userId, strategy_id: position.strategy_id, token_id: position.token_id, position_id: position.id,
        side: "SELL", order_type: "MARKET", quantity: position.quantity, requested_price: exitPrice,
        status: "SUBMITTED", execution_provider: provider.name, idempotency_key: data.idempotencyKey,
        submitted_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const execution = await provider.createOrder({
      userId, strategyId: position.strategy_id ?? "", tokenId: position.token_id ?? "", side: "SELL",
      orderType: "MARKET", quantity: Number(position.quantity ?? 0), requestedPrice: exitPrice,
      maxSlippage: 0, idempotencyKey: data.idempotencyKey,
    });

    if (!execution.ok) {
      await supabase.from("orders").update({ status: "FAILED", failure_reason: execution.error }).eq("id", order.id);
      await supabase.from("positions").update({ status: "OPEN" }).eq("id", position.id);
      throw new Error(execution.error);
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
        status: "CLOSED", closed_at: new Date().toISOString(), close_reason: data.reason ?? "MANUAL_CLOSE",
        current_price: fill.executedPrice, current_value: exitValue, unrealized_pnl: 0, unrealized_pnl_percent: 0,
      })
      .eq("id", position.id);
    await supabase.from("trades").insert({
      user_id: userId, strategy_id: position.strategy_id, position_id: position.id, token_id: position.token_id,
      order_id: order.id, side: "SELL", entry_price: position.entry_price, exit_price: fill.executedPrice,
      quantity: fill.filledQuantity, invested_amount: invested, exit_value: exitValue, realized_pnl: pnl,
      realized_pnl_percent: invested > 0 ? (pnl / invested) * 100 : null, slippage: fill.slippage,
      execution_provider: provider.name, opened_at: position.opened_at, close_reason: data.reason ?? "MANUAL_CLOSE",
    });
    await supabase.from("system_logs").insert({
      user_id: userId, level: "INFO", component: "EXECUTION", event: "POSITION_CLOSED",
      message: `Closed position with P&L ${pnl.toFixed(2)}`, metadata: { position_id: position.id, order_id: order.id },
    });

    return { ok: true, duplicate: false, order_id: order.id, realized_pnl: pnl };
  });
