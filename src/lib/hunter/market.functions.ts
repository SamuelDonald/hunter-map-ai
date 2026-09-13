import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateToken } from "./strategy-engine";
import type { StrategyEvaluation, TokenRelationshipRow, TokenRow, WalletRow } from "./types";

export type TokenFilters = {
  search?: string;
  minHunterScore?: number;
  minLiquidity?: number;
  minMarketCap?: number;
  maxTokenAge?: number;
  sortBy?: "hunter_score" | "market_cap" | "liquidity" | "volume_24h" | "smart_money_score";
  limit?: number;
  offset?: number;
};

export type TokenPage = { rows: TokenRow[]; total: number; dataSourceConnected: boolean };

export const listTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: TokenFilters | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<TokenPage> => {
    const limit = Math.min(data.limit ?? 25, 100);
    const offset = data.offset ?? 0;
    let query = context.supabase.from("tokens").select("*", { count: "exact" });
    if (data.search) query = query.or(`symbol.ilike.%${data.search}%,name.ilike.%${data.search}%`);
    if (data.minHunterScore) query = query.gte("hunter_score", data.minHunterScore);
    if (data.minLiquidity) query = query.gte("liquidity", data.minLiquidity);
    if (data.minMarketCap) query = query.gte("market_cap", data.minMarketCap);
    if (data.maxTokenAge) query = query.lte("token_age_seconds", data.maxTokenAge);
    const { data: rows, count, error } = await query
      .order(data.sortBy ?? "hunter_score", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, dataSourceConnected: (count ?? 0) > 0 };
  });

export type TokenDetail = {
  token: TokenRow;
  evaluation: StrategyEvaluation | null;
  relationships: TokenRelationshipRow[];
  smartMoneyWallets: WalletRow[];
  activity: { id: string; activity_type: string; amount: number | null; price: number | null; occurred_at: string }[];
};

export const getTokenDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tokenId: string; strategyId?: string }) => input)
  .handler(async ({ data, context }): Promise<TokenDetail | null> => {
    const { supabase, userId } = context;
    const { data: token } = await supabase.from("tokens").select("*").eq("id", data.tokenId).maybeSingle();
    if (!token) return null;

    const strategyQuery = supabase.from("strategies").select("id").eq("user_id", userId);
    const { data: strategy } = data.strategyId
      ? await strategyQuery.eq("id", data.strategyId).maybeSingle()
      : await strategyQuery.limit(1).maybeSingle();

    let evaluation: StrategyEvaluation | null = null;
    if (strategy) {
      const { data: params } = await supabase.from("strategy_parameters").select("*").eq("strategy_id", strategy.id).maybeSingle();
      if (params) evaluation = evaluateToken(token, params);
    }

    const [{ data: relationships }, { data: wallets }, { data: activity }] = await Promise.all([
      supabase.from("token_relationships").select("*").or(`source_token_id.eq.${token.id},target_token_id.eq.${token.id}`),
      supabase.from("wallets").select("*").eq("is_tracked", true).order("smart_money_score", { ascending: false, nullsFirst: false }).limit(10),
      supabase.from("wallet_activity").select("id, activity_type, amount, price, occurred_at").eq("token_id", token.id).order("occurred_at", { ascending: false }).limit(20),
    ]);

    return {
      token,
      evaluation,
      relationships: relationships ?? [],
      smartMoneyWallets: wallets ?? [],
      activity: activity ?? [],
    };
  });

export type MapNode = {
  id: string;
  kind: "TOKEN" | "WALLET";
  symbol: string | null;
  address: string;
  market_cap: number | null;
  liquidity: number | null;
  volume_24h: number | null;
  smart_money_score: number | null;
  hunter_score: number | null;
  price_change_5m: number | null;
  is_new: boolean;
};

export type MapEdge = { id: string; source: string; target: string; type: string; strength: number };

export type HunterMapData = { nodes: MapNode[]; edges: MapEdge[]; dataSourceConnected: boolean };

/** Hunter Map graph, generated entirely from stored tokens, wallets and relationships. */
export const getHunterMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { minHunterScore?: number; minLiquidity?: number; includeWallets?: boolean } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<HunterMapData> => {
    let tokenQuery = context.supabase.from("tokens").select("*").limit(60);
    if (data.minHunterScore) tokenQuery = tokenQuery.gte("hunter_score", data.minHunterScore);
    if (data.minLiquidity) tokenQuery = tokenQuery.gte("liquidity", data.minLiquidity);
    const { data: tokens } = await tokenQuery.order("hunter_score", { ascending: false, nullsFirst: false });
    const tokenRows = tokens ?? [];
    const ids = tokenRows.map((t) => t.id);

    const { data: relationships } = ids.length
      ? await context.supabase.from("token_relationships").select("*").in("source_token_id", ids)
      : { data: [] as TokenRelationshipRow[] };

    const { data: wallets } = data.includeWallets === false
      ? { data: [] as WalletRow[] }
      : await context.supabase.from("wallets").select("*").eq("is_tracked", true).limit(20);

    const nodes: MapNode[] = [
      ...tokenRows.map((t) => ({
        id: t.id, kind: "TOKEN" as const, symbol: t.symbol, address: t.address,
        market_cap: t.market_cap, liquidity: t.liquidity, volume_24h: t.volume_24h,
        smart_money_score: t.smart_money_score, hunter_score: t.hunter_score,
        price_change_5m: t.price_change_5m, is_new: t.is_new,
      })),
      ...(wallets ?? []).map((w) => ({
        id: w.id, kind: "WALLET" as const, symbol: w.label ?? w.address.slice(0, 6), address: w.address,
        market_cap: null, liquidity: null, volume_24h: null,
        smart_money_score: w.smart_money_score, hunter_score: null, price_change_5m: null, is_new: false,
      })),
    ];

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: MapEdge[] = (relationships ?? [])
      .filter((r) => nodeIds.has(r.source_token_id) && nodeIds.has(r.target_token_id))
      .map((r) => ({ id: r.id, source: r.source_token_id, target: r.target_token_id, type: r.relationship_type, strength: Number(r.strength) }));

    return { nodes, edges, dataSourceConnected: tokenRows.length > 0 };
  });

export type SmartMoneyWallet = WalletRow & { watchlisted: boolean };

export const listSmartMoney = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ wallets: SmartMoneyWallet[]; dataSourceConnected: boolean }> => {
    const [{ data: wallets }, { data: watchlist }] = await Promise.all([
      context.supabase.from("wallets").select("*").order("smart_money_score", { ascending: false, nullsFirst: false }).limit(50),
      context.supabase.from("wallet_watchlist").select("wallet_id").eq("user_id", context.userId),
    ]);
    const watched = new Set((watchlist ?? []).map((w) => w.wallet_id));
    return {
      wallets: (wallets ?? []).map((w) => ({ ...w, watchlisted: watched.has(w.id) })),
      dataSourceConnected: (wallets ?? []).length > 0,
    };
  });

export const toggleWalletWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { walletId: string; enabled: boolean }) => input)
  .handler(async ({ data, context }) => {
    if (data.enabled) {
      const { error } = await context.supabase
        .from("wallet_watchlist")
        .upsert({ user_id: context.userId, wallet_id: data.walletId }, { onConflict: "user_id,wallet_id" });
      if (error) throw new Error(error.message);
    } else {
      await context.supabase.from("wallet_watchlist").delete().eq("user_id", context.userId).eq("wallet_id", data.walletId);
    }
    return { ok: true };
  });

export const listWalletActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { walletId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("wallet_activity")
      .select("*, token:tokens(symbol)")
      .eq("wallet_id", data.walletId)
      .order("occurred_at", { ascending: false })
      .limit(30);
    return rows ?? [];
  });
