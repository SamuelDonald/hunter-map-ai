import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot, BrainCircuit, CircleDollarSign, Crosshair, Gauge, Search, Sparkles, TrendingUp, WalletCards, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { updateRiskSettings, updateStrategyParameters, updateProfile } from "@/lib/hunter/strategies.functions";
import { closePosition } from "@/lib/hunter/trading.functions";
import type { TokenFilters } from "@/lib/hunter/market.functions";
import {
  BubbleMap, Dot, HunterScore, LiveNotConfigured, MetricCard, NotConnected, PageHeader, Panel, PnlChart, WalletPanel,
  money, pct, usd,
} from "./HunterUI";
import {
  usePortfolio, usePositions, useProviderStates, useRiskEvents, useRiskSettings, useSmartMoney, useStrategies,
  useSystemLogs, useTokens, useTrades,
} from "./hooks";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ------------------------------------------------------------------- TABLES
export function TokenTable() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<NonNullable<TokenFilters["sortBy"]>>("hunter_score");
  const [page, setPage] = useState(0);
  const limit = 20;
  const filters = useMemo<TokenFilters>(() => ({ search, sortBy, limit, offset: page * limit }), [search, sortBy, page]);
  const { data, isLoading } = useTokens(filters);
  const rows = data?.rows ?? [];

  return (
    <Panel title="TOKEN SCANNER" aside={<span className="text-xs text-muted-foreground">{data?.total ?? 0} tokens stored</span>}>
      <div className="mb-4 flex flex-wrap items-center gap-2 pt-3">
        <div className="relative flex-1 min-w-52">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search symbol or name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <div className="segmented">
          <span>SORT</span>
          {(["hunter_score", "market_cap", "liquidity", "volume_24h", "smart_money_score"] as const).map((s) => (
            <button key={s} className={sortBy === s ? "active" : ""} onClick={() => setSortBy(s)}>{s.replace(/_/g, " ")}</button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <p className="p-4 text-xs text-muted-foreground">Loading tokens…</p>
      ) : rows.length === 0 ? (
        <NotConnected />
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>{["Token", "Price", "Market Cap", "Liquidity", "5M", "1H", "Volume", "Smart Money", "Holders", "Hunter Score"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><strong>${t.symbol}</strong><small className="block text-muted-foreground">{t.name}</small></td>
                    <td>{t.price === null ? "—" : `$${Number(t.price)}`}</td>
                    <td>{money(num(t.market_cap))}</td>
                    <td>{money(num(t.liquidity))}</td>
                    <td className={Number(t.price_change_5m ?? 0) >= 0 ? "text-positive" : "text-negative"}>{pct(num(t.price_change_5m))}</td>
                    <td className={Number(t.price_change_1h ?? 0) >= 0 ? "text-positive" : "text-negative"}>{pct(num(t.price_change_1h))}</td>
                    <td>{money(num(t.volume_24h))}</td>
                    <td>{t.smart_money_score ?? "—"}</td>
                    <td>{t.holders ?? "—"}</td>
                    <td><b className="text-primary">{t.hunter_score ?? "—"}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
            <span>Page {page + 1}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * limit >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

export function PositionTable() {
  const { data: positions, isLoading } = usePositions();
  const close = useServerFn(closePosition);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function onClose(id: string) {
    setBusy(id);
    try {
      await close({ data: { positionId: id, idempotencyKey: crypto.randomUUID(), reason: "MANUAL_CLOSE" } });
      toast.success("Close order submitted");
      await queryClient.invalidateQueries({ queryKey: ["positions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not close position");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="OPEN POSITIONS" aside={<LiveNotConfigured />}>
      {isLoading ? (
        <p className="p-4 text-xs text-muted-foreground">Loading positions…</p>
      ) : !positions || positions.length === 0 ? (
        <NotConnected title="NO POSITIONS" detail="Positions appear here after the strategy and risk engines approve a paper trade." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>{["Token", "Entry", "Current", "Size", "P&L", "P&L %", "Score", "TP", "SL", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td><strong>${p.token?.symbol ?? "—"}</strong></td>
                  <td>{p.entry_price === null ? "—" : `$${Number(p.entry_price)}`}</td>
                  <td>{p.current_price === null ? "—" : `$${Number(p.current_price)}`}</td>
                  <td>{money(num(p.invested_amount))}</td>
                  <td className={Number(p.unrealized_pnl ?? 0) >= 0 ? "text-positive" : "text-negative"}>{usd(num(p.unrealized_pnl))}</td>
                  <td>{pct(num(p.unrealized_pnl_percent))}</td>
                  <td>{p.token?.hunter_score ?? "—"}</td>
                  <td>{p.take_profit_price === null ? "—" : `$${Number(p.take_profit_price)}`}</td>
                  <td>{p.stop_loss_price === null ? "—" : `$${Number(p.stop_loss_price)}`}</td>
                  <td><span className="badge-demo">{p.status}</span></td>
                  <td>
                    {(p.status === "OPEN") && (
                      <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => void onClose(p.id)}>Close</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function TradeTable() {
  const { data: trades, isLoading } = useTrades();
  return (
    <Panel title="TRADE HISTORY">
      {isLoading ? (
        <p className="p-4 text-xs text-muted-foreground">Loading trades…</p>
      ) : !trades || trades.length === 0 ? (
        <NotConnected title="NO CLOSED TRADES" detail="Completed paper trades are recorded here with entry, exit and exit reason." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>{["Closed", "Token", "Side", "Entry", "Exit", "Size", "P&L", "P&L %", "Exit reason"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.closed_at).toLocaleString()}</td>
                  <td><strong>${t.token?.symbol ?? "—"}</strong></td>
                  <td>{t.side}</td>
                  <td>{t.entry_price === null ? "—" : `$${Number(t.entry_price)}`}</td>
                  <td>{t.exit_price === null ? "—" : `$${Number(t.exit_price)}`}</td>
                  <td>{money(num(t.invested_amount))}</td>
                  <td className={Number(t.realized_pnl ?? 0) >= 0 ? "text-positive" : "text-negative"}>{usd(num(t.realized_pnl))}</td>
                  <td>{pct(num(t.realized_pnl_percent))}</td>
                  <td>{t.close_reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------- PANELS
const strategyFields: [string, string, number][] = [
  ["hunter_score_min", "Minimum Hunter Score", 1],
  ["min_liquidity", "Minimum liquidity ($)", 1000],
  ["smart_money_score_min", "Smart Money score", 1],
  ["min_volume", "Minimum volume ($)", 1000],
  ["position_size", "Position size ($)", 1],
  ["max_positions", "Maximum positions", 1],
  ["take_profit_multiplier", "Take profit (x)", 0.1],
  ["stop_loss_percent", "Stop loss (%)", 1],
  ["trailing_stop_percent", "Trailing stop (%)", 1],
  ["max_exposure", "Maximum exposure ($)", 1],
  ["max_slippage", "Maximum slippage (%)", 0.5],
];
const strategyToggles: [string, string][] = [
  ["trailing_stop_enabled", "Trailing stop"],
  ["partial_take_profit_enabled", "Partial take profit"],
  ["allow_new_launches", "Allow new launches"],
  ["allow_smart_money", "Allow Smart Money signals"],
  ["allow_momentum", "Allow momentum signals"],
];

export function StrategyPanel() {
  const { data: strategies, isLoading } = useStrategies();
  const save = useServerFn(updateStrategyParameters);
  const queryClient = useQueryClient();
  const [patch, setPatch] = useState<Record<string, number | boolean>>({});
  const [busy, setBusy] = useState(false);
  const bundle = strategies?.[0];

  if (isLoading) return <Panel title="STRATEGY"><p className="p-4 text-xs text-muted-foreground">Loading strategy…</p></Panel>;
  if (!bundle?.parameters) return <Panel title="STRATEGY"><NotConnected title="NO STRATEGY YET" detail="Your default strategy is created automatically on first sign-in. Reload if this persists." /></Panel>;

  const params = bundle.parameters as unknown as Record<string, number | boolean>;
  const value = (k: string) => (patch[k] !== undefined ? patch[k] : params[k]);

  async function onSave() {
    setBusy(true);
    try {
      await save({ data: { strategy_id: bundle!.strategy.id, patch } });
      toast.success("Strategy parameters saved");
      setPatch({});
      await queryClient.invalidateQueries({ queryKey: ["strategies"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={`STRATEGY — ${bundle.strategy.name}`} aside={<span className="badge-demo">{bundle.strategy.mode} MODE</span>}>
      <div className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-3">
        {strategyFields.map(([key, label, step]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <Input id={key} type="number" step={step} value={String(value(key) ?? "")}
              onChange={(e) => setPatch((p) => ({ ...p, [key]: Number(e.target.value) }))} />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {strategyToggles.map(([key, label]) => (
          <label key={key} className="toggle-row">
            <span>{label}</span>
            <Switch checked={Boolean(value(key))} onCheckedChange={(v) => setPatch((p) => ({ ...p, [key]: v }))} />
          </label>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Button disabled={busy || Object.keys(patch).length === 0} onClick={() => void onSave()}>Save strategy</Button>
        <Button variant="ghost" disabled={Object.keys(patch).length === 0} onClick={() => setPatch({})}>Discard changes</Button>
      </div>
    </Panel>
  );
}

const riskFields: [string, string][] = [
  ["max_daily_loss", "Maximum daily loss ($)"],
  ["max_trade_loss", "Maximum loss per trade ($)"],
  ["max_positions", "Maximum open positions"],
  ["max_exposure", "Maximum exposure ($)"],
  ["max_slippage", "Maximum slippage (%)"],
  ["consecutive_loss_limit", "Consecutive loss limit"],
];

export function RiskPanel() {
  const { data: risk, isLoading } = useRiskSettings();
  const { data: portfolio } = usePortfolio();
  const { data: events } = useRiskEvents();
  const save = useServerFn(updateRiskSettings);
  const queryClient = useQueryClient();
  const [patch, setPatch] = useState<Record<string, number | boolean>>({});
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Panel title="RISK"><p className="p-4 text-xs text-muted-foreground">Loading risk settings…</p></Panel>;
  if (!risk) return <Panel title="RISK"><NotConnected title="NO RISK SETTINGS" detail="Risk settings are created automatically for your account." /></Panel>;

  const row = risk as unknown as Record<string, number | boolean>;
  const value = (k: string) => (patch[k] !== undefined ? patch[k] : row[k]);
  const killSwitch = Boolean(value("kill_switch"));
  const todayLoss = Math.max(0, -(portfolio?.today_pnl ?? 0));
  const limit = Number(value("max_daily_loss") ?? 0);
  const usedPct = limit > 0 ? Math.min(100, (todayLoss / limit) * 100) : 0;

  async function onSave() {
    setBusy(true);
    try {
      await save({ data: patch });
      toast.success("Risk limits saved");
      setPatch({});
      await queryClient.invalidateQueries({ queryKey: ["risk-settings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Panel title="RISK LIMITS">
        <div className="grid gap-4 pt-4 md:grid-cols-2">
          {riskFields.map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{label}</Label>
              <Input id={key} type="number" value={String(value(key) ?? "")}
                onChange={(e) => setPatch((p) => ({ ...p, [key]: Number(e.target.value) }))} />
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <Button disabled={busy || Object.keys(patch).length === 0} onClick={() => void onSave()}>Save limits</Button>
          <Button variant="ghost" disabled={Object.keys(patch).length === 0} onClick={() => setPatch({})}>Discard changes</Button>
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel title="DAILY RISK">
          <p className="mt-3 text-2xl font-semibold">{money(todayLoss)}<span className="text-sm text-muted-foreground"> / {money(limit)}</span></p>
          <Progress className="mt-4" value={usedPct} />
          <p className="mt-3 text-xs text-muted-foreground">Calculated from your recorded trades closed today (UTC).</p>
        </Panel>
        <Panel title="RISK EVENTS">
          {!events || events.length === 0 ? (
            <p className="pt-3 text-xs text-muted-foreground">No risk events recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-xs">
              {events.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <Dot tone={e.severity === "CRITICAL" ? "negative" : "warning"} />
                  <span><b>{e.event_type}</b><br /><span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function SmartMoneyBubble({ score, label, active }: { score: number | null; label: string; active?: boolean }) {
  const size = 60 + (score ?? 40) * 0.5;
  return (
    <div className={cn("sm-bubble", active && "sm-bubble-active")} style={{ width: size, height: size }}>
      <strong>{score ?? "—"}</strong>
      <small>{label}</small>
    </div>
  );
}

export function AIActivityFeed() {
  const { data: logs, isLoading } = useSystemLogs();
  return (
    <Panel title="AGENT ACTIVITY" aside={<span className="badge-demo">ENGINE LOG</span>}>
      {isLoading ? (
        <p className="p-4 text-xs text-muted-foreground">Loading activity…</p>
      ) : !logs || logs.length === 0 ? (
        <NotConnected title="NO ACTIVITY YET" detail="Start the hunter to record engine activity such as scans, evaluations and risk decisions." />
      ) : (
        <ul className="mt-3 space-y-2">
          {logs.slice(0, 20).map((log) => (
            <li key={log.id} className="signal-item animate-fade-in">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-2"><Dot tone={log.level === "ERROR" ? "negative" : log.level === "WARNING" ? "warning" : "ai"} />{log.component}</span>
                <span>{new Date(log.created_at).toLocaleTimeString()}</span>
              </div>
              <p className="mt-1 text-sm">{log.message ?? log.event}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SettingsSections() {
  const { data: providers } = useProviderStates();
  const { data: risk } = useRiskSettings();
  const { data: strategies } = useStrategies();
  const saveProfile = useServerFn(updateProfile);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    try {
      await saveProfile({ data: { display_name: displayName } });
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="PROFILE">
        <div className="space-y-3 pt-4">
          <Label htmlFor="display_name">Display name</Label>
          <Input id="display_name" value={displayName} placeholder="Your name" onChange={(e) => setDisplayName(e.target.value)} />
          <Button disabled={busy || !displayName} onClick={() => void onSave()}>Save profile</Button>
        </div>
      </Panel>
      <Panel title="INTEGRATIONS">
        <ul className="mt-3 space-y-3 text-sm">
          {(providers ?? []).map((p) => (
            <li key={p.name} className="flex items-center justify-between">
              <span>{p.name.replace(/_/g, " ")}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Dot tone={p.status === "READY" ? "positive" : "muted"} />{p.status.replace(/_/g, " ")}
              </span>
            </li>
          ))}
          {(providers ?? []).length === 0 && <li className="text-xs text-muted-foreground">No providers configured.</li>}
        </ul>
      </Panel>
      <Panel title="TRADING">
        <div className="data-grid">
          <span>Strategy<b>{strategies?.[0]?.strategy.name ?? "—"}</b></span>
          <span>Mode<b>{strategies?.[0]?.strategy.mode ?? "PAPER"}</b></span>
          <span>Position size<b>{money(num(strategies?.[0]?.parameters?.position_size))}</b></span>
          <span>Max positions<b>{strategies?.[0]?.parameters?.max_positions ?? "—"}</b></span>
        </div>
      </Panel>
      <Panel title="RISK">
        <div className="data-grid">
          <span>Daily loss limit<b>{money(num(risk?.max_daily_loss))}</b></span>
          <span>Trade loss limit<b>{money(num(risk?.max_trade_loss))}</b></span>
          <span>Max exposure<b>{money(num(risk?.max_exposure))}</b></span>
          <span>Consecutive losses<b>{risk?.consecutive_loss_limit ?? "—"}</b></span>
        </div>
      </Panel>
      <Panel title="ABOUT">
        <p className="pt-3 text-sm text-muted-foreground">
          HUNTER 2X runs strategy scoring, risk governance and paper execution on your own account. Live execution,
          wallet connectivity and on-chain data providers are not configured.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={() => void supabase.auth.signOut()}>Sign out</Button>
        </div>
      </Panel>
    </div>
  );
}

// -------------------------------------------------------------------- PAGES
export function OverviewPage() {
  const { data: p } = usePortfolio();
  return (
    <div className="page">
      <PageHeader title="HUNTER 2X" subtitle="Solana opportunity detection, risk-governed paper execution" />
      <div className="metrics-grid">
        <MetricCard label="Portfolio value" value={money(p?.total_exposure ?? 0)} trend={`${p?.open_positions ?? 0} open positions`} icon={CircleDollarSign} />
        <MetricCard label="Today's P&L" value={usd(p?.today_pnl ?? 0)} trend={`${p?.trades_today ?? 0} trades today`} tone={(p?.today_pnl ?? 0) >= 0 ? "positive" : "negative"} icon={TrendingUp} />
        <MetricCard label="Unrealized P&L" value={usd(p?.unrealized_pnl ?? 0)} trend="Open positions" tone={(p?.unrealized_pnl ?? 0) >= 0 ? "positive" : "negative"} icon={Crosshair} />
        <MetricCard label="Realized P&L" value={usd(p?.realized_pnl ?? 0)} trend={`${p?.total_trades ?? 0} closed trades`} icon={Gauge} />
        <MetricCard label="Win rate" value={p?.win_rate === null || p?.win_rate === undefined ? "—" : `${p.win_rate.toFixed(1)}%`} trend="All recorded trades" tone="ai" icon={BrainCircuit} />
        <MetricCard label="Profit factor" value={p?.profit_factor ? p.profit_factor.toFixed(2) : "—"} trend="Wins ÷ losses" tone="ai" icon={Sparkles} />
      </div>
      <div className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Opportunity Map</h2>
            <p className="text-xs text-muted-foreground">Token relationships from your stored intelligence</p>
          </div>
          <LiveNotConfigured />
        </div>
        <BubbleMap />
      </div>
    </div>
  );
}

export function MapPage() {
  return (
    <div className="page">
      <PageHeader title="HUNTER MAP" subtitle="Explore token clusters, wallets, liquidity and Smart Money overlap" />
      <BubbleMap expanded />
    </div>
  );
}

export function ScannerPage() {
  return (
    <div className="page">
      <PageHeader title="TOKEN SCANNER" subtitle="Ranked Solana tokens scored by your strategy engine" />
      <TokenTable />
    </div>
  );
}

export function SmartMoneyPage() {
  const { data, isLoading } = useSmartMoney();
  const [selected, setSelected] = useState(0);
  const wallets = data?.wallets ?? [];
  const wallet = wallets[selected];

  return (
    <div className="page">
      <PageHeader title="SMART MONEY" subtitle="Tracked wallet behaviour and capital flow intelligence" />
      {isLoading ? (
        <Panel><p className="p-4 text-xs text-muted-foreground">Loading wallets…</p></Panel>
      ) : wallets.length === 0 ? (
        <Panel><NotConnected title="NO TRACKED WALLETS" detail="Smart Money wallets appear here once wallet intelligence is connected." /></Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <Panel title="WALLET NETWORK">
            <div className="wallet-map">
              {wallets.map((w, i) => (
                <button key={w.id} onClick={() => setSelected(i)} aria-label={w.label ?? w.address}>
                  <SmartMoneyBubble score={num(w.smart_money_score)} label={w.label ?? w.address.slice(0, 6)} active={i === selected} />
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="WALLET INTELLIGENCE">
            {wallet && (
              <>
                <p className="font-mono text-xs break-all text-muted-foreground">{wallet.address}</p>
                <div className="mt-5 data-grid">
                  <span>Smart Money score<b className="text-primary">{wallet.smart_money_score ?? "—"}</b></span>
                  <span>Win rate<b>{wallet.win_rate === null ? "—" : `${Number(wallet.win_rate).toFixed(1)}%`}</b></span>
                  <span>Realized P&L<b>{usd(num(wallet.realized_pnl))}</b></span>
                  <span>Watchlisted<b>{wallet.watchlisted ? "YES" : "NO"}</b></span>
                </div>
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

export function PositionsPage() {
  const { data: p } = usePortfolio();
  return (
    <div className="page">
      <PageHeader title="OPEN POSITIONS" subtitle="Paper positions and live performance tracking" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MetricCard label="Position value" value={money(p?.total_exposure ?? 0)} trend={`${p?.open_positions ?? 0} positions`} />
        <MetricCard label="Invested" value={money(p?.invested_amount ?? 0)} trend="Capital deployed" />
        <MetricCard label="Unrealized P&L" value={usd(p?.unrealized_pnl ?? 0)} tone={(p?.unrealized_pnl ?? 0) >= 0 ? "positive" : "negative"} />
      </div>
      <PositionTable />
      <div className="mt-4"><PnlChart /></div>
    </div>
  );
}

export function HistoryPage() {
  const { data: p } = usePortfolio();
  return (
    <div className="page">
      <PageHeader title="TRADE HISTORY" subtitle="Completed paper trades and strategy outcomes" />
      <div className="metrics-grid mb-4">
        <MetricCard label="Win rate" value={p?.win_rate === null || p?.win_rate === undefined ? "—" : `${p.win_rate.toFixed(1)}%`} tone="positive" />
        <MetricCard label="Average winner" value={usd(p?.average_winner ?? null)} tone="positive" />
        <MetricCard label="Average loser" value={usd(p?.average_loser ?? null)} tone="negative" />
        <MetricCard label="Profit factor" value={p?.profit_factor ? p.profit_factor.toFixed(2) : "—"} tone="ai" />
        <MetricCard label="Total P&L" value={usd(p?.realized_pnl ?? 0)} tone={(p?.realized_pnl ?? 0) >= 0 ? "positive" : "negative"} />
        <MetricCard label="Closed trades" value={String(p?.total_trades ?? 0)} />
      </div>
      <TradeTable />
    </div>
  );
}

export function StrategiesPage() {
  return (
    <div className="page">
      <PageHeader title="STRATEGY BUILDER" subtitle="Configure how HUNTER 2X scores and sizes trades" />
      <StrategyPanel />
    </div>
  );
}

export function RiskPage() {
  return (
    <div className="page">
      <PageHeader title="RISK MANAGEMENT" subtitle="Set the limits the risk engine enforces before every trade" />
      <RiskPanel />
    </div>
  );
}

export function WalletPage() {
  return (
    <div className="page">
      <PageHeader title="WALLET" subtitle="Wallet connectivity arrives in a later phase — nothing is connected" />
      <div className="grid gap-4 2xl:grid-cols-2">
        <WalletPanel />
        <WalletPanel vault />
      </div>
    </div>
  );
}

export function AIAgentPage() {
  const { data: providers } = useProviderStates();
  const state = (name: string) => providers?.find((p) => p.name === name)?.status.replace(/_/g, " ") ?? "NOT CONFIGURED";
  return (
    <div className="page">
      <PageHeader title="HUNTER AI" subtitle="Engine activity, provider health and scoring transparency" />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="MARKET DATA" value={state("MARKET_DATA")} trend="Token prices and liquidity" icon={Sparkles} />
        <MetricCard label="TOKEN INTELLIGENCE" value={state("TOKEN_INTELLIGENCE")} trend="Holder and safety analysis" icon={BrainCircuit} />
        <MetricCard label="EXECUTION" value={state("GMGN")} trend="Live execution provider" icon={Bot} />
      </div>
      <div className="mt-4"><AIActivityFeed /></div>
    </div>
  );
}
