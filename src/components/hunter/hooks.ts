import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getBotStatus, listSystemLogs } from "@/lib/hunter/bot.functions";
import {
  getProviderStates,
  getRiskSettings,
  listStrategies,
} from "@/lib/hunter/strategies.functions";
import {
  getPortfolioSummary,
  listOrders,
  listPositions,
  listRiskEvents,
  listSignals,
  listTrades,
} from "@/lib/hunter/trading.functions";
import { getHunterMap, listSmartMoney, listTokens, type TokenFilters } from "@/lib/hunter/market.functions";
import { analyzeCandidates, getIntegrationHealth } from "@/lib/hunter/integrations.functions";
import { getSolanaWalletOverview } from "@/lib/hunter/solana.functions";

/** Keeps queries fresh from Realtime instead of polling. */
export function useHunterRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("hunter-2x")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["positions"] });
        void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["trades"] });
        void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["signals"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "risk_events" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["risk-events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_status" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["bot-status"] });
        void queryClient.invalidateQueries({ queryKey: ["logs"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tokens" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["tokens"] });
        void queryClient.invalidateQueries({ queryKey: ["hunter-map"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_activity" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["smart-money"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export function useBotStatus() {
  const fn = useServerFn(getBotStatus);
  return useQuery({ queryKey: ["bot-status"], queryFn: () => fn() });
}

export function useStrategies() {
  const fn = useServerFn(listStrategies);
  return useQuery({ queryKey: ["strategies"], queryFn: () => fn() });
}

export function useRiskSettings() {
  const fn = useServerFn(getRiskSettings);
  return useQuery({ queryKey: ["risk-settings"], queryFn: () => fn() });
}

export function usePortfolio() {
  const fn = useServerFn(getPortfolioSummary);
  return useQuery({ queryKey: ["portfolio"], queryFn: () => fn() });
}

export function usePositions() {
  const fn = useServerFn(listPositions);
  return useQuery({ queryKey: ["positions"], queryFn: () => fn() });
}

export function useOrders() {
  const fn = useServerFn(listOrders);
  return useQuery({ queryKey: ["orders"], queryFn: () => fn() });
}

export function useTrades() {
  const fn = useServerFn(listTrades);
  return useQuery({ queryKey: ["trades"], queryFn: () => fn() });
}

export function useSignals() {
  const fn = useServerFn(listSignals);
  return useQuery({ queryKey: ["signals"], queryFn: () => fn() });
}

export function useRiskEvents() {
  const fn = useServerFn(listRiskEvents);
  return useQuery({ queryKey: ["risk-events"], queryFn: () => fn() });
}

export function useSystemLogs() {
  const fn = useServerFn(listSystemLogs);
  return useQuery({ queryKey: ["logs"], queryFn: () => fn() });
}

export function useProviderStates() {
  const fn = useServerFn(getProviderStates);
  return useQuery({ queryKey: ["providers"], queryFn: () => fn() });
}

/** Live GMGN health plus data freshness, refreshed every 20s. */
export function useIntegrationHealth() {
  const fn = useServerFn(getIntegrationHealth);
  return useQuery({ queryKey: ["integration-health"], queryFn: () => fn(), refetchInterval: 20_000 });
}

export function useCandidateAnalysis() {
  const fn = useServerFn(analyzeCandidates);
  return useQuery({ queryKey: ["candidate-analysis"], queryFn: () => fn(), refetchInterval: 30_000 });
}

export function useTokens(filters: TokenFilters) {
  const fn = useServerFn(listTokens);
  return useQuery({ queryKey: ["tokens", filters], queryFn: () => fn({ data: filters }) });
}

export function useHunterMapData(filters: { minHunterScore?: number; minLiquidity?: number }) {
  const fn = useServerFn(getHunterMap);
  return useQuery({ queryKey: ["hunter-map", filters], queryFn: () => fn({ data: filters }) });
}

export function useSmartMoney() {
  const fn = useServerFn(listSmartMoney);
  return useQuery({ queryKey: ["smart-money"], queryFn: () => fn() });
}

export function useSolanaWallet() {
  const fn = useServerFn(getSolanaWalletOverview);
  return useQuery({ queryKey: ["solana-wallet"], queryFn: () => fn(), refetchInterval: 30_000 });
}
