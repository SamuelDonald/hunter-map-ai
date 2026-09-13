import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { IntegrationHealth } from "@/integrations/gmgn/gmgnTypes";
import type { ScanReport } from "./scanner.server";
import type { StrategyEvaluation, TokenRow } from "./types";

export type DataFreshness = {
  tokens_tracked: number;
  last_market_update: string | null;
  last_smart_money_update: string | null;
  market_data_stale: boolean;
};

/** Real provider health — never optimistic, derived from actual request outcomes. */
export const getIntegrationHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ gmgn: IntegrationHealth; freshness: DataFreshness }> => {
    const { isGmgnConfigured, FRESHNESS } = await import("@/integrations/gmgn/gmgnConfig.server");
    const { readGmgnHealth } = await import("@/integrations/gmgn/gmgnHealth.server");
    const gmgn = await readGmgnHealth(isGmgnConfigured());

    const [{ count }, { data: market }, { data: smart }] = await Promise.all([
      context.supabase.from("tokens").select("id", { count: "exact", head: true }),
      context.supabase.from("tokens").select("last_market_update").order("last_market_update", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      context.supabase.from("tokens").select("last_smart_money_update").order("last_smart_money_update", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ]);

    const lastMarket = market?.last_market_update ?? null;
    return {
      gmgn,
      freshness: {
        tokens_tracked: count ?? 0,
        last_market_update: lastMarket,
        last_smart_money_update: smart?.last_smart_money_update ?? null,
        market_data_stale:
          lastMarket === null || Date.now() - new Date(lastMarket).getTime() > FRESHNESS.MARKET_DATA_MAX_AGE * 1000,
      },
    };
  });

export type CandidateAnalysis = {
  token_id: string;
  symbol: string | null;
  address: string;
  price: number | null;
  liquidity: number | null;
  evaluation: StrategyEvaluation;
};

/**
 * Analysis only. The AI/analysis layer explains scores and never places orders:
 * execution stays behind strategy validation, the risk engine and the provider.
 */
export const analyzeCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ candidates: CandidateAnalysis[]; dataSourceConnected: boolean }> => {
    const { evaluateToken } = await import("./strategy-engine");
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!strategy) return { candidates: [], dataSourceConnected: false };

    const { data: params } = await context.supabase
      .from("strategy_parameters")
      .select("*")
      .eq("strategy_id", strategy.id)
      .maybeSingle();
    if (!params) return { candidates: [], dataSourceConnected: false };

    const { data: tokens } = await context.supabase
      .from("tokens")
      .select("*")
      .eq("is_blacklisted", false)
      .not("price", "is", null)
      .order("hunter_score", { ascending: false, nullsFirst: false })
      .limit(10);

    const candidates = ((tokens ?? []) as TokenRow[]).map((token) => ({
      token_id: token.id,
      symbol: token.symbol,
      address: token.address,
      price: token.price === null ? null : Number(token.price),
      liquidity: token.liquidity === null ? null : Number(token.liquidity),
      evaluation: evaluateToken(token, params),
    }));

    return { candidates, dataSourceConnected: candidates.length > 0 };
  });

/** Manual scan trigger. Same bounded, single-flight cycle the scheduler runs. */
export const runScanNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ScanReport> => {
    const { runScannerCycle } = await import("./scanner.server");
    return runScannerCycle("manual");
  });
