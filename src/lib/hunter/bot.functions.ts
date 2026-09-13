import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BotSessionRow, BotState, BotStatusRow } from "./types";

/** Allowed transitions for the server-side bot state machine. */
const TRANSITIONS: Record<BotState, BotState[]> = {
  OFFLINE: ["STARTING"],
  STARTING: ["SCANNING", "ERROR", "KILLED", "OFFLINE"],
  SCANNING: ["ANALYZING", "READY", "PAUSED", "RISK_PAUSED", "ERROR", "KILLED", "OFFLINE"],
  ANALYZING: ["READY", "TRADING", "PAUSED", "RISK_PAUSED", "ERROR", "KILLED", "OFFLINE"],
  READY: ["TRADING", "SCANNING", "PAUSED", "RISK_PAUSED", "ERROR", "KILLED", "OFFLINE"],
  TRADING: ["READY", "PAUSED", "RISK_PAUSED", "ERROR", "KILLED", "OFFLINE"],
  PAUSED: ["READY", "SCANNING", "OFFLINE", "KILLED", "RISK_PAUSED"],
  RISK_PAUSED: ["PAUSED", "READY", "OFFLINE", "KILLED"],
  ERROR: ["OFFLINE", "STARTING", "KILLED"],
  KILLED: [], // requires an explicit reset action
};

export const TRADING_STATES: BotState[] = ["SCANNING", "ANALYZING", "READY", "TRADING"];

export type BotSnapshot = { status: BotStatusRow | null; session: BotSessionRow | null };

async function loadStatus(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("bot_status").select("*").eq("user_id", userId).maybeSingle();
  return data;
}

export const getBotStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BotSnapshot> => {
    const status = await loadStatus(context.supabase, context.userId);
    let session: BotSessionRow | null = null;
    if (status?.session_id) {
      const { data } = await context.supabase.from("bot_sessions").select("*").eq("id", status.session_id).maybeSingle();
      session = data ?? null;
    }
    return { status: status ?? null, session };
  });

type Action = "START" | "PAUSE" | "RESUME" | "STOP" | "KILL" | "RESET_KILL" | "RISK_PAUSE";

const TARGET: Record<Exclude<Action, "RESET_KILL">, BotState> = {
  START: "STARTING",
  PAUSE: "PAUSED",
  RESUME: "READY",
  STOP: "OFFLINE",
  KILL: "KILLED",
  RISK_PAUSE: "RISK_PAUSED",
};

/** Single audited entry point for every bot state change. */
export const controlBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { action: Action; strategyId?: string; reason?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const current = await loadStatus(supabase, userId);
    if (!current) throw new Error("Bot state has not been initialised for this account");

    if (data.action === "RESET_KILL") {
      if (current.state !== "KILLED") throw new Error("Bot is not in a killed state");
      await supabase
        .from("bot_status")
        .update({ state: "OFFLINE", killed_at: null, last_error: null, state_changed_at: new Date().toISOString() })
        .eq("user_id", userId);
      await supabase.from("system_logs").insert({
        user_id: userId, level: "WARNING", component: "BOT", event: "KILL_RESET", message: "Kill switch cleared by user",
      });
      return { state: "OFFLINE" as BotState };
    }

    const target = TARGET[data.action];
    if (current.state === "KILLED") throw new Error("Bot is killed and requires an explicit reset");
    if (!TRANSITIONS[current.state].includes(target)) {
      throw new Error(`Invalid transition ${current.state} → ${target}`);
    }

    let sessionId = current.session_id;
    let strategyId = data.strategyId ?? current.strategy_id;

    if (data.action === "START") {
      if (!strategyId) {
        const { data: fallback } = await supabase.from("strategies").select("id").eq("user_id", userId).limit(1).maybeSingle();
        strategyId = fallback?.id ?? null;
      }
      if (!strategyId) throw new Error("Create a strategy before starting the hunter");
      const { data: strategy } = await supabase.from("strategies").select("*").eq("id", strategyId).eq("user_id", userId).maybeSingle();
      if (!strategy) throw new Error("Strategy not found");
      if (strategy.mode === "LIVE") throw new Error("LIVE execution is not configured — switch the strategy to PAPER");
      const { data: session, error } = await supabase
        .from("bot_sessions")
        .insert({ user_id: userId, strategy_id: strategyId, mode: strategy.mode, status: "SCANNING" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      sessionId = session.id;
    }

    if (data.action === "STOP" || data.action === "KILL") {
      if (sessionId) {
        await supabase
          .from("bot_sessions")
          .update({ status: target, stopped_at: new Date().toISOString() })
          .eq("id", sessionId)
          .eq("user_id", userId);
      }
      sessionId = null;
    } else if (sessionId) {
      await supabase.from("bot_sessions").update({ status: target }).eq("id", sessionId).eq("user_id", userId);
    }

    const { error: updateError } = await supabase
      .from("bot_status")
      .update({
        state: target,
        strategy_id: strategyId,
        session_id: sessionId,
        killed_at: data.action === "KILL" ? new Date().toISOString() : null,
        last_error: data.reason ?? null,
        state_changed_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (updateError) throw new Error(updateError.message);

    await supabase.from("system_logs").insert({
      user_id: userId,
      level: data.action === "KILL" ? "CRITICAL" : "INFO",
      component: "BOT",
      event: `BOT_${data.action}`,
      message: `Bot state ${current.state} → ${target}`,
      metadata: { from: current.state, to: target, reason: data.reason ?? null },
    });

    if (data.action === "KILL") {
      await supabase.from("risk_events").insert({
        user_id: userId, strategy_id: strategyId, event_type: "MANUAL_KILL", severity: "CRITICAL",
        message: data.reason ?? "Bot killed by user",
      });
    }

    return { state: target };
  });

export const listSystemLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("system_logs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });
