// The autonomous hunting loop.
//
// One bounded, single-flight cycle:
//   1. provider health / circuit breaker check
//   2. token discovery  (GMGN token intelligence)
//   3. detail refresh   (GMGN market data, bounded batch)
//   4. smart money ingestion + derived signals (INPUT only)
//   5. per-user: strategy -> hunter score -> validation -> risk engine -> paper execution
//   6. open position mark-to-market + TP / SL / trailing exits
//
// Nothing here fabricates market data, and nothing here bypasses the risk
// engine. Every provider failure is recorded and surfaced, never masked.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FRESHNESS, LIMITS, isGmgnConfigured } from "@/integrations/gmgn/gmgnConfig.server";
import { isGmgnPaused, markNotConfigured } from "@/integrations/gmgn/gmgnHealth.server";
import { discoverTokens } from "@/integrations/gmgn/gmgnTokenAdapter.server";
import { fetchTokenSnapshot } from "@/integrations/gmgn/gmgnMarketAdapter.server";
import { fetchSmartMoneyActivity } from "@/integrations/gmgn/gmgnWalletAdapter.server";
import { signalsFromWalletEvents } from "@/integrations/gmgn/gmgnSignalAdapter.server";
import type { NormalizedToken } from "@/integrations/gmgn/gmgnTypes";
import { computeScores } from "./scoring";
import { closePositionInternal, openPositionInternal } from "./execution.server";
import type { Client } from "./risk-engine.server";
import type { PositionRow, StrategyParametersRow, TokenRow } from "./types";

const JOB = "hunter-scan";
const LEASE_TTL_SECONDS = 110;

export type ScanReport = {
  status: "OK" | "NOT_CONFIGURED" | "PROVIDER_PAUSED" | "LOCKED" | "ERROR";
  trigger: string;
  started_at: string;
  duration_ms: number;
  tokens_discovered: number;
  tokens_refreshed: number;
  smart_money_events: number;
  signals_created: number;
  users_processed: number;
  positions_opened: number;
  positions_closed: number;
  errors: string[];
};

const admin = () => supabaseAdmin as unknown as Client;

async function logSystem(
  level: "INFO" | "WARNING" | "ERROR",
  event: string,
  message: string,
  metadata: Record<string, unknown> = {},
  userId: string | null = null,
) {
  await admin()
    .from("system_logs")
    .insert({ user_id: userId, level, component: "SCANNER", event, message, metadata: metadata as never });
}

// ------------------------------------------------------------------ ingestion

function scoreToken(token: NormalizedToken) {
  return computeScores({
    smartMoneyScore: token.smartMoneyScore,
    priceChange5m: token.priceChange5m,
    priceChange1h: token.priceChange1h,
    volume5m: token.volume5m,
    volume1h: token.volume1h,
    volume24h: token.volume24h,
    liquidity: token.liquidity,
    minLiquidity: 50_000,
    topHolderPercentage: token.topHolderPercentage,
    holders: token.holders,
    buys5m: token.buys5m,
    sells5m: token.sells5m,
    tokenAgeSeconds: token.tokenAgeSeconds,
    minTokenAge: 0,
    maxTokenAge: 7 * 24 * 3600,
  });
}

function toTokenRow(token: NormalizedToken) {
  const { hunterScore, momentum } = scoreToken(token);
  const buys = token.buys5m;
  const sells = token.sells5m;
  return {
    chain: token.chain,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    logo_url: token.logoUrl,
    decimals: token.decimals,
    price: token.price,
    market_cap: token.marketCap,
    liquidity: token.liquidity,
    volume_5m: token.volume5m,
    volume_1h: token.volume1h,
    volume_24h: token.volume24h,
    price_change_5m: token.priceChange5m,
    price_change_1h: token.priceChange1h,
    price_change_24h: token.priceChange24h,
    buys_5m: buys,
    sells_5m: sells,
    buy_sell_ratio: buys !== null && sells !== null && sells > 0 ? Math.round((buys / sells) * 1e6) / 1e6 : null,
    holders: token.holders,
    top_holder_percentage: token.topHolderPercentage,
    token_age_seconds: token.tokenAgeSeconds,
    smart_money_score: token.smartMoneyScore,
    momentum_score: momentum,
    hunter_score: hunterScore,
    is_new: token.isNew ?? false,
    is_verified: token.isVerified ?? false,
    is_blacklisted: token.riskFlags.includes("HONEYPOT"),
    last_market_update: token.lastMarketUpdate,
    data_source: "GMGN",
  };
}

/** Drops keys whose provider value is null so a refresh never erases known data. */
function withoutNulls<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as Partial<T>;
}

async function ingestDiscovery(report: ScanReport) {
  const result = await discoverTokens();
  if (!result.ok) {
    report.errors.push(`DISCOVERY_${result.status}: ${result.error}`);
    return;
  }
  const rows = result.data.map(toTokenRow);
  const { error } = await admin().from("tokens").upsert(rows, { onConflict: "chain,address" });
  if (error) {
    report.errors.push(`TOKEN_UPSERT: ${error.message}`);
    return;
  }
  report.tokens_discovered = rows.length;
}

/** Bounded detail refresh so short-window volume and trade counts stay live. */
async function refreshTopTokens(report: ScanReport) {
  const { data } = await admin()
    .from("tokens")
    .select("id, chain, address")
    .eq("is_blacklisted", false)
    .order("hunter_score", { ascending: false, nullsFirst: false })
    .limit(LIMITS.TOKEN_REFRESH_PER_RUN);

  for (const token of data ?? []) {
    const snapshot = await fetchTokenSnapshot(token.chain, token.address);
    if (!snapshot.ok) {
      report.errors.push(`REFRESH_${token.address.slice(0, 6)}: ${snapshot.error}`);
      continue;
    }
    const row = withoutNulls(toTokenRow(snapshot.data));
    const { error } = await admin().from("tokens").update(row).eq("id", token.id);
    if (error) report.errors.push(`REFRESH_UPDATE: ${error.message}`);
    else report.tokens_refreshed += 1;
  }
}

async function ingestSmartMoney(report: ScanReport) {
  const result = await fetchSmartMoneyActivity();
  if (!result.ok) {
    report.errors.push(`SMART_MONEY_${result.status}: ${result.error}`);
    return [] as ReturnType<typeof signalsFromWalletEvents>;
  }
  const events = result.data;
  report.smart_money_events = events.length;

  // wallets
  const walletRows = new Map<string, ReturnType<typeof Object>>();
  for (const event of events) {
    walletRows.set(event.wallet.address, {
      chain: event.wallet.chain,
      address: event.wallet.address,
      label: event.wallet.label,
      wallet_type: event.wallet.walletType,
      smart_money_score: event.wallet.smartMoneyScore,
      win_rate: event.wallet.winRate,
      realized_pnl: event.wallet.realizedPnl,
      total_trades: event.wallet.totalTrades,
      is_tracked: true,
      data_source: "GMGN",
      last_provider_sync: new Date().toISOString(),
    });
  }
  const { error: walletError } = await admin()
    .from("wallets")
    .upsert([...walletRows.values()] as never[], { onConflict: "chain,address" });
  if (walletError) report.errors.push(`WALLET_UPSERT: ${walletError.message}`);

  const addresses = [...walletRows.keys()];
  const { data: walletIds } = await admin().from("wallets").select("id, address").in("address", addresses);
  const walletIdByAddress = new Map((walletIds ?? []).map((w) => [w.address, w.id]));

  const tokenAddresses = [...new Set(events.map((e) => e.tokenAddress))];
  const { data: tokenIds } = await admin().from("tokens").select("id, address").in("address", tokenAddresses);
  const tokenIdByAddress = new Map((tokenIds ?? []).map((t) => [t.address, t.id]));

  // wallet activity — idempotent per transaction hash
  const hashes = events.map((e) => e.transactionHash).filter((h): h is string => h !== null);
  const { data: known } = hashes.length
    ? await admin().from("wallet_activity").select("transaction_hash").in("transaction_hash", hashes)
    : { data: [] as { transaction_hash: string | null }[] };
  const knownHashes = new Set((known ?? []).map((row) => row.transaction_hash));

  const seen = new Set<string>();
  const activityRows = events
    .filter((e) => e.transactionHash === null || !knownHashes.has(e.transactionHash))
    .filter((e) => {
      // In-batch de-duplication: the provider can repeat one on-chain trade.
      const key = `${e.wallet.address}:${e.transactionHash ?? e.fingerprint}:${e.activityType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((e) => ({
      wallet_id: walletIdByAddress.get(e.wallet.address) ?? null,
      token_id: tokenIdByAddress.get(e.tokenAddress) ?? null,
      activity_type: e.activityType,
      amount: e.amount,
      price: e.price,
      transaction_hash: e.transactionHash,
      metadata: { provider: "GMGN", amount_usd: e.amountUsd, token_symbol: e.tokenSymbol },
      occurred_at: e.occurredAt,
    }))
    .filter((row) => row.wallet_id !== null);

  if (activityRows.length) {
    const { error } = await admin().from("wallet_activity").insert(activityRows as never[]);
    if (error) {
      // Fall back to row-by-row so one duplicate cannot drop the whole batch.
      let failed = 0;
      for (const row of activityRows) {
        const { error: rowError } = await admin().from("wallet_activity").insert(row as never);
        if (rowError && !rowError.message.includes("duplicate key")) failed += 1;
      }
      if (failed) report.errors.push(`WALLET_ACTIVITY: ${failed} rows rejected`);
    }
  }

  // token-level smart money freshness marker
  const touchedTokenIds = [...new Set([...tokenIdByAddress.values()])];
  if (touchedTokenIds.length) {
    await admin()
      .from("tokens")
      .update({ last_smart_money_update: new Date().toISOString() })
      .in("id", touchedTokenIds);
  }

  return signalsFromWalletEvents(events);
}

// --------------------------------------------------------------- per account

type ActiveAccount = {
  userId: string;
  strategyId: string;
  sessionId: string | null;
  state: string;
};

const TRADING_STATES = ["SCANNING", "ANALYZING", "READY", "TRADING"] as const;

async function loadActiveAccounts(): Promise<ActiveAccount[]> {
  const { data } = await admin()
    .from("bot_status")
    .select("user_id, state, strategy_id, session_id")
    .in("state", TRADING_STATES);
  return (data ?? [])
    .filter((row) => row.strategy_id)
    .map((row) => ({
      userId: row.user_id,
      strategyId: row.strategy_id as string,
      sessionId: row.session_id,
      state: row.state,
    }));
}

/** Best-effort bot state transition; invalid transitions are rejected by the database. */
async function setBotState(userId: string, state: string) {
  const { error } = await admin()
    .from("bot_status")
    .update({ state: state as never })
    .eq("user_id", userId);
  if (error) console.log("[scanner] state_transition_skipped", JSON.stringify({ userId, state, error: error.message }));
}

async function persistSignals(
  account: ActiveAccount,
  derived: ReturnType<typeof signalsFromWalletEvents>,
  report: ScanReport,
) {
  if (derived.length === 0) return;
  const addresses = [...new Set(derived.map((s) => s.tokenAddress))];
  const { data: tokens } = await admin().from("tokens").select("id, address").in("address", addresses);
  const tokenIdByAddress = new Map((tokens ?? []).map((t) => [t.address, t.id]));

  const candidates = derived
    .filter((s) => tokenIdByAddress.has(s.tokenAddress))
    .slice(0, 40)
    // Per-user provider id keeps the global (source, provider_signal_id) dedupe intact.
    .map((s) => ({ signal: s, providerSignalId: `${s.providerSignalId}:${account.userId}` }));
  if (candidates.length === 0) return;

  // Explicit de-duplication: the same provider event must never be stored twice.
  const { data: known } = await admin()
    .from("signals")
    .select("provider_signal_id")
    .eq("source", "GMGN")
    .in("provider_signal_id", candidates.map((c) => c.providerSignalId));
  const knownIds = new Set((known ?? []).map((row) => row.provider_signal_id));

  const rows = candidates
    .filter((c) => !knownIds.has(c.providerSignalId))
    .map(({ signal: s, providerSignalId }) => ({
      user_id: account.userId,
      token_id: tokenIdByAddress.get(s.tokenAddress) as string,
      signal_type: s.signalType,
      direction: s.direction,
      confidence: s.confidence,
      hunter_score: null,
      reason_codes: s.reasonCodes,
      source: "GMGN" as const,
      status: "NEW" as const,
      metadata: s.metadata,
      provider_signal_id: providerSignalId,
    }));
  if (rows.length === 0) return;

  const { error } = await admin().from("signals").insert(rows as never[]);
  if (error) report.errors.push(`SIGNALS: ${error.message}`);
  else report.signals_created += rows.length;
}

async function manageOpenPositions(account: ActiveAccount, params: StrategyParametersRow, report: ScanReport) {
  const { data: positions } = await admin()
    .from("positions")
    .select("*, token:tokens(price, last_market_update)")
    .eq("user_id", account.userId)
    .eq("status", "OPEN");

  for (const raw of positions ?? []) {
    const position = raw as unknown as PositionRow & { token: { price: number | null; last_market_update: string | null } | null };
    const price = Number(position.token?.price ?? 0);
    const updatedAt = position.token?.last_market_update;
    const stale = !updatedAt || Date.now() - new Date(updatedAt).getTime() > FRESHNESS.MARKET_DATA_MAX_AGE * 1000;
    if (!(price > 0) || stale) continue;

    const quantity = Number(position.quantity ?? 0);
    const invested = Number(position.invested_amount ?? 0);
    const value = price * quantity;
    const pnl = value - invested;

    const takeProfit = position.take_profit_price === null ? null : Number(position.take_profit_price);
    const stopLoss = position.stop_loss_price === null ? null : Number(position.stop_loss_price);
    let trailing = position.trailing_stop_price === null ? null : Number(position.trailing_stop_price);

    if (params.trailing_stop_enabled) {
      const candidate = price * (1 - Number(params.trailing_stop_percent) / 100);
      if (trailing === null || candidate > trailing) trailing = candidate;
    }

    await admin()
      .from("positions")
      .update({
        current_price: price,
        current_value: value,
        unrealized_pnl: pnl,
        unrealized_pnl_percent: invested > 0 ? (pnl / invested) * 100 : null,
        trailing_stop_price: trailing,
      })
      .eq("id", position.id);

    let exitReason: string | null = null;
    if (takeProfit !== null && price >= takeProfit) exitReason = "TAKE_PROFIT";
    else if (stopLoss !== null && price <= stopLoss) exitReason = "STOP_LOSS";
    else if (params.trailing_stop_enabled && trailing !== null && price <= trailing) exitReason = "TRAILING_STOP";

    if (!exitReason) continue;

    const result = await closePositionInternal(admin(), {
      position,
      exitPrice: price,
      reason: exitReason,
      idempotencyKey: `auto-exit:${position.id}:${exitReason}`,
    });
    if (result.closed) report.positions_closed += 1;
    else if (result.reason !== "DUPLICATE_REQUEST_IGNORED") report.errors.push(`EXIT_${position.id.slice(0, 8)}: ${result.reason}`);
  }
}

async function processAccount(
  account: ActiveAccount,
  derived: ReturnType<typeof signalsFromWalletEvents>,
  report: ScanReport,
) {
  const [{ data: strategy }, { data: risk }] = await Promise.all([
    admin().from("strategies").select("*").eq("id", account.strategyId).maybeSingle(),
    admin().from("risk_settings").select("*").eq("user_id", account.userId).maybeSingle(),
  ]);
  if (!strategy || !risk) {
    report.errors.push(`ACCOUNT_${account.userId.slice(0, 8)}: strategy or risk settings missing`);
    return;
  }
  const { data: params } = await admin()
    .from("strategy_parameters")
    .select("*")
    .eq("strategy_id", strategy.id)
    .maybeSingle();
  if (!params) {
    report.errors.push(`ACCOUNT_${account.userId.slice(0, 8)}: strategy parameters missing`);
    return;
  }

  await persistSignals(account, derived, report);
  await setBotState(account.userId, "ANALYZING");

  // Freshness gate: only tokens with live market data may be considered.
  const freshAfter = new Date(Date.now() - FRESHNESS.MARKET_DATA_MAX_AGE * 1000).toISOString();
  const { data: candidates } = await admin()
    .from("tokens")
    .select("*")
    .eq("is_blacklisted", false)
    .gte("last_market_update", freshAfter)
    .not("price", "is", null)
    .gte("hunter_score", Number(params.hunter_score_min))
    .order("hunter_score", { ascending: false, nullsFirst: false })
    .limit(LIMITS.CANDIDATES_PER_USER * 4);

  await setBotState(account.userId, "READY");

  let attempts = 0;
  for (const token of (candidates ?? []) as TokenRow[]) {
    if (attempts >= LIMITS.CANDIDATES_PER_USER) break;
    attempts += 1;
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    const result = await openPositionInternal(admin(), {
      userId: account.userId,
      strategy,
      params,
      risk,
      token,
      source: "SCANNER",
      idempotencyKey: `auto:${account.userId}:${token.id}:${bucket}`,
    });
    if (result.opened) {
      report.positions_opened += 1;
      await setBotState(account.userId, "TRADING");
    }
  }

  await manageOpenPositions(account, params, report);
  await setBotState(account.userId, "SCANNING");

  if (account.sessionId) {
    await admin()
      .from("bot_sessions")
      .update({ trades_count: report.positions_closed })
      .eq("id", account.sessionId)
      .eq("user_id", account.userId);
  }
  report.users_processed += 1;
}

// -------------------------------------------------------------------- cycle

export async function runScannerCycle(trigger: string): Promise<ScanReport> {
  const startedAt = Date.now();
  const report: ScanReport = {
    status: "OK",
    trigger,
    started_at: new Date(startedAt).toISOString(),
    duration_ms: 0,
    tokens_discovered: 0,
    tokens_refreshed: 0,
    smart_money_events: 0,
    signals_created: 0,
    users_processed: 0,
    positions_opened: 0,
    positions_closed: 0,
    errors: [],
  };

  if (!isGmgnConfigured()) {
    await markNotConfigured();
    report.status = "NOT_CONFIGURED";
    report.duration_ms = Date.now() - startedAt;
    await logSystem("WARNING", "SCAN_SKIPPED", "DATA SOURCE NOT CONNECTED", { trigger });
    return report;
  }

  // Circuit breaker: a paused provider is never hammered.
  const paused = await isGmgnPaused();
  if (paused.paused) {
    report.status = "PROVIDER_PAUSED";
    report.duration_ms = Date.now() - startedAt;
    await logSystem("WARNING", "SCAN_SKIPPED", "Provider circuit breaker open", { trigger, until: paused.until });
    return report;
  }

  // Single flight: overlapping schedules never process in parallel.
  const holder = crypto.randomUUID();
  const { data: acquired, error: leaseError } = await admin().rpc("acquire_job_lease", {
    _job_name: JOB,
    _ttl_seconds: LEASE_TTL_SECONDS,
    _holder: holder,
  });
  if (leaseError) {
    report.status = "ERROR";
    report.errors.push(`LEASE: ${leaseError.message}`);
    report.duration_ms = Date.now() - startedAt;
    return report;
  }
  if (acquired !== true) {
    report.status = "LOCKED";
    report.duration_ms = Date.now() - startedAt;
    return report;
  }

  try {
    await ingestDiscovery(report);
    await refreshTopTokens(report);
    const derived = await ingestSmartMoney(report);

    const accounts = await loadActiveAccounts();
    for (const account of accounts) {
      try {
        await processAccount(account, derived, report);
      } catch (error) {
        report.errors.push(`ACCOUNT_${account.userId.slice(0, 8)}: ${(error as Error).message}`);
        await logSystem("ERROR", "ACCOUNT_FAILED", (error as Error).message, { trigger }, account.userId);
      }
    }
  } catch (error) {
    report.status = "ERROR";
    report.errors.push((error as Error).message);
  } finally {
    report.duration_ms = Date.now() - startedAt;
    await admin().rpc("release_job_lease", { _job_name: JOB, _result: report as never });
    await logSystem(
      report.errors.length ? "WARNING" : "INFO",
      "SCAN_COMPLETED",
      `Scan ${report.status}: ${report.tokens_discovered} tokens, ${report.smart_money_events} smart money events, ${report.positions_opened} opened, ${report.positions_closed} closed`,
      report as unknown as Record<string, unknown>,
    );
  }

  return report;
}
