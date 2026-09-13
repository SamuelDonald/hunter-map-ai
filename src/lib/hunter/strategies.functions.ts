import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProviderState, RiskSettingsRow, StrategyParametersRow, StrategyRow } from "./types";

export type StrategyBundle = { strategy: StrategyRow; parameters: StrategyParametersRow | null };

/** Ensures the signed-in account has a profile, a paper strategy, parameters, risk settings and bot state. */
export const bootstrapAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!profile) {
      await supabase.from("profiles").insert({ id: userId, email: context.claims?.email ?? null });
    }

    let { data: strategies } = await supabase.from("strategies").select("*").eq("user_id", userId).order("created_at");
    if (!strategies || strategies.length === 0) {
      const { data: created } = await supabase
        .from("strategies")
        .insert({ user_id: userId, name: "HUNTER 2X", description: "Default paper strategy", enabled: true, mode: "PAPER" })
        .select()
        .single();
      if (created) {
        await supabase.from("strategy_parameters").insert({ strategy_id: created.id });
        strategies = [created];
      }
    }

    const strategyId = strategies?.[0]?.id ?? null;
    const { data: risk } = await supabase.from("risk_settings").select("id").eq("user_id", userId).maybeSingle();
    if (!risk) await supabase.from("risk_settings").insert({ user_id: userId });

    const { data: bot } = await supabase.from("bot_status").select("id").eq("user_id", userId).maybeSingle();
    if (!bot) await supabase.from("bot_status").insert({ user_id: userId, state: "OFFLINE", strategy_id: strategyId });

    return { ok: true };
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle();
    return data;
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { display_name?: string; avatar_url?: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").update(data).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listStrategies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StrategyBundle[]> => {
    const { data: strategies, error } = await context.supabase
      .from("strategies")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at");
    if (error) throw new Error(error.message);
    const ids = (strategies ?? []).map((s) => s.id);
    const { data: params } = ids.length
      ? await context.supabase.from("strategy_parameters").select("*").in("strategy_id", ids)
      : { data: [] as StrategyParametersRow[] };
    return (strategies ?? []).map((strategy) => ({
      strategy,
      parameters: (params ?? []).find((p) => p.strategy_id === strategy.id) ?? null,
    }));
  });

export const createStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; description?: string }) => {
    if (!input.name?.trim()) throw new Error("Strategy name is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: strategy, error } = await context.supabase
      .from("strategies")
      .insert({ user_id: context.userId, name: data.name.trim(), description: data.description ?? null, mode: "PAPER" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("strategy_parameters").insert({ strategy_id: strategy.id });
    return strategy;
  });

export const updateStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name?: string; description?: string; enabled?: boolean; mode?: "PAPER" | "LIVE" }) => input)
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    if (patch.mode === "LIVE") throw new Error("LIVE execution is not configured in this phase");
    const { error } = await context.supabase.from("strategies").update(patch).eq("id", id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("strategies").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateStrategyParameters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { strategy_id: string; patch: Record<string, number | boolean> }) => input)
  .handler(async ({ data, context }) => {
    // ownership check — RLS also enforces this, we fail fast with a clear error
    const { data: owned } = await context.supabase
      .from("strategies")
      .select("id")
      .eq("id", data.strategy_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!owned) throw new Error("Strategy not found");
    const { error } = await context.supabase
      .from("strategy_parameters")
      .update(data.patch)
      .eq("strategy_id", data.strategy_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getRiskSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RiskSettingsRow | null> => {
    const { data } = await context.supabase.from("risk_settings").select("*").eq("user_id", context.userId).maybeSingle();
    return data;
  });

export const updateRiskSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, number>) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("risk_settings").update(data).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProviderStates = createServerFn({ method: "GET" }).handler(async (): Promise<ProviderState[]> => {
  const { providerStates } = await import("./providers.server");
  return providerStates();
});
