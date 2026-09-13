import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode, type WheelEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity, Ban, Bot, BrainCircuit, CandlestickChart, Crosshair, DatabaseZap, Gauge, History, LogOut, Menu, Minus,
  Network, Pause, Play, Plus, Radar, RotateCcw, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Square,
  Target, UserRound, WalletCards, X,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { controlBot } from "@/lib/hunter/bot.functions";
import { bootstrapAccount } from "@/lib/hunter/strategies.functions";
import type { MapEdge, MapNode } from "@/lib/hunter/market.functions";
import {
  useBotStatus, useHunterMapData, useHunterRealtime, usePortfolio, useProviderStates, useSignals, useStrategies,
} from "./hooks";

const nav = [
  ["/", "Overview", Radar],
  ["/hunter-map", "Hunter Map", Network],
  ["/token-scanner", "Token Scanner", Search],
  ["/smart-money", "Smart Money", BrainCircuit],
  ["/positions", "Positions", CandlestickChart],
  ["/trade-history", "Trade History", History],
  ["/strategies", "Strategies", SlidersHorizontal],
  ["/risk", "Risk", ShieldCheck],
  ["/wallet", "Wallet", WalletCards],
  ["/ai-agent", "AI Agent", Bot],
  ["/settings", "Settings", Settings],
] as const;

export const money = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};
export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n).toFixed(2)}%`;
export const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n) < 0 ? "-" : "+"}$${Math.abs(Number(n)).toFixed(2)}`;

export function Dot({ tone = "positive" }: { tone?: string }) {
  return <span className={cn("status-dot", `status-${tone}`)} />;
}

export function LiveNotConfigured() {
  return <span className="badge-demo">LIVE EXECUTION — NOT CONFIGURED</span>;
}

export function NotConnected({ title = "DATA SOURCE NOT CONNECTED", detail }: { title?: string; detail?: string }) {
  return (
    <div className="not-connected">
      <DatabaseZap />
      <strong>{title}</strong>
      <p>{detail ?? "No market-data provider is connected yet, so there is nothing to display. Real token intelligence will appear here once a provider is configured."}</p>
    </div>
  );
}

const stateTone = (state?: string) =>
  state === "TRADING" || state === "READY" ? "positive"
    : state === "RISK_PAUSED" || state === "PAUSED" ? "warning"
      : state === "KILLED" || state === "ERROR" ? "negative"
        : state === "SCANNING" || state === "ANALYZING" ? "ai" : "muted";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { data: bot } = useBotStatus();
  const [email, setEmail] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  const state = bot?.status?.state ?? "OFFLINE";
  return (
    <header className="topbar">
      <div className="flex min-w-0 items-center gap-3">
        <Button size="icon" variant="ghost" className="lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu /></Button>
        <div className="brand-mark"><Crosshair /></div>
        <strong className="font-display text-lg tracking-normal">HUNTER <span className="text-primary">2X</span></strong>
      </div>
      <div className="hidden items-center gap-5 md:flex">
        <span className="top-status"><Dot tone={stateTone(state)} /> {state}</span>
        <span className="top-status text-muted-foreground">{bot?.status?.mode ?? "PAPER"} MODE</span>
        <span className="top-status text-muted-foreground"><WalletCards /> WALLET NOT CONNECTED</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:block">{email ?? ""}</span>
        <Button size="icon" variant="ghost" aria-label="Account" onClick={() => void navigate({ to: "/settings" })}><UserRound /></Button>
        <Button size="icon" variant="ghost" aria-label="Sign out" onClick={() => void signOut()}><LogOut /></Button>
      </div>
    </header>
  );
}

export function BotControls({ compact = false }: { compact?: boolean }) {
  const { data: bot } = useBotStatus();
  const { data: strategies } = useStrategies();
  const control = useServerFn(controlBot);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const state = bot?.status?.state ?? "OFFLINE";
  const strategyId = bot?.status?.strategy_id ?? strategies?.[0]?.strategy.id;

  async function run(action: "START" | "PAUSE" | "RESUME" | "STOP" | "KILL" | "RESET_KILL") {
    setBusy(true);
    try {
      const result = await control({ data: { action, strategyId } });
      toast.success(`Bot state: ${result.state}`);
      await queryClient.invalidateQueries({ queryKey: ["bot-status"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bot control failed");
    } finally {
      setBusy(false);
    }
  }

  const running = ["SCANNING", "ANALYZING", "READY", "TRADING"].includes(state);
  return (
    <div className={cn("space-y-2", compact && "flex gap-2 space-y-0")}>
      {state === "KILLED" ? (
        <Button className="w-full" variant="outline" disabled={busy} onClick={() => void run("RESET_KILL")}>
          <RotateCcw /> Clear kill switch
        </Button>
      ) : running ? (
        <>
          <Button className="w-full" variant="outline" disabled={busy} onClick={() => void run("PAUSE")}><Pause /> Pause</Button>
          <Button className="w-full" variant="outline" disabled={busy} onClick={() => void run("STOP")}><Square /> Stop</Button>
        </>
      ) : state === "PAUSED" || state === "RISK_PAUSED" ? (
        <Button className="w-full" disabled={busy} onClick={() => void run("RESUME")}><Play /> Resume</Button>
      ) : (
        <Button className="w-full" disabled={busy} onClick={() => void run("START")}><Target /> START HUNTER</Button>
      )}
      {state !== "KILLED" && (
        <Button className="w-full" variant="ghost" disabled={busy} onClick={() => void run("KILL")}>
          <Ban /> Kill
        </Button>
      )}
    </div>
  );
}

export function Sidebar({ mobile = false, close }: { mobile?: boolean; close?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: bot } = useBotStatus();
  const state = bot?.status?.state ?? "OFFLINE";
  return (
    <aside className={cn("sidebar", mobile && "h-full w-full border-r-0")}>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {nav.map(([to, label, Icon]) => (
          <Link key={to} to={to} onClick={close} className={cn("nav-item", path === to && "nav-active")}>
            <Icon /><span>{label}</span>
            {path === to && <span className="ml-auto h-1 w-1 rounded-full bg-primary" />}
          </Link>
        ))}
      </nav>
      <div className="border-t border-border p-4">
        <p className="eyebrow">BOT STATUS</p>
        <div className="my-3 flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 font-semibold"><Dot tone={stateTone(state)} />{state}</span>
          <span className="text-muted-foreground">{bot?.status?.mode ?? "PAPER"}</span>
        </div>
        <BotControls />
      </div>
    </aside>
  );
}

export function SignalFeed({ compact = false }: { compact?: boolean }) {
  const { data: signals, isLoading } = useSignals();
  if (isLoading) return <p className="p-3 text-xs text-muted-foreground">Loading intelligence…</p>;
  if (!signals || signals.length === 0)
    return (
      <div className="p-3">
        <NotConnected title="NO SIGNALS YET" detail="Signals are generated by the strategy engine once real token intelligence is flowing." />
      </div>
    );
  return (
    <div className="space-y-2">
      {signals.slice(0, compact ? 3 : 10).map((s, i) => (
        <article className="signal-item animate-fade-in" style={{ animationDelay: `${i * 80}ms` }} key={s.id}>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
              <Dot tone={s.direction === "BULLISH" ? "positive" : s.direction === "BEARISH" ? "negative" : "ai"} />
              {s.signal_type}
            </span>
            <span className="text-[10px] text-muted-foreground">{new Date(s.created_at).toLocaleTimeString()}</span>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-3">
            <div>
              <strong>{s.token?.symbol ? `$${s.token.symbol}` : "—"}</strong>
              <p className="mt-1 text-xs text-muted-foreground">{s.reason_codes.slice(0, 3).join(" · ") || s.source}</p>
            </div>
            {s.hunter_score !== null && <HunterScore score={Number(s.hunter_score)} small />}
          </div>
        </article>
      ))}
    </div>
  );
}

export function StatusBar() {
  const { data: providers } = useProviderStates();
  const { data: bot } = useBotStatus();
  const marketData = providers?.find((p) => p.name === "MARKET_DATA")?.status ?? "NOT_CONFIGURED";
  const items: [string, string, string][] = [
    ["NETWORK", "SOLANA", "ai"],
    ["DATA", marketData === "READY" ? "CONNECTED" : "NOT CONNECTED", marketData === "READY" ? "positive" : "muted"],
    ["BOT", bot?.status?.state ?? "OFFLINE", stateTone(bot?.status?.state)],
    ["MODE", bot?.status?.mode ?? "PAPER", "warning"],
    ["LIVE", "NOT CONFIGURED", "muted"],
    ["WALLET", "NOT CONNECTED", "muted"],
  ];
  return (
    <footer className="statusbar">
      {items.map(([a, b, t]) => (
        <span key={a}><Dot tone={t} /><small>{a}</small><b>{b}</b></span>
      ))}
    </footer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const [intel, setIntel] = useState(false);
  const bootstrap = useServerFn(bootstrapAccount);
  const queryClient = useQueryClient();
  useHunterRealtime();

  useEffect(() => {
    void bootstrap().then(() => queryClient.invalidateQueries());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar onMenu={() => setMenu(true)} />
      <div className="app-grid">
        <div className="hidden lg:block"><Sidebar /></div>
        <main className="min-w-0 overflow-x-hidden pb-12">{children}</main>
        <aside className="intel-panel hidden xl:block">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <p className="eyebrow">AI INTELLIGENCE</p>
              <p className="mt-1 text-xs text-muted-foreground">Signals from your strategy engine</p>
            </div>
            <Sparkles className="text-primary" />
          </div>
          <div className="p-3"><SignalFeed /></div>
        </aside>
      </div>
      <StatusBar />
      <Drawer open={menu} onOpenChange={setMenu}>
        <DrawerContent className="h-[86vh]">
          <DrawerHeader><DrawerTitle>Navigation</DrawerTitle></DrawerHeader>
          <Sidebar mobile close={() => setMenu(false)} />
        </DrawerContent>
      </Drawer>
      <Button size="sm" className="fixed bottom-10 right-3 z-40 xl:hidden" onClick={() => setIntel(true)}>
        <BrainCircuit /> Intelligence
      </Button>
      <Drawer open={intel} onOpenChange={setIntel}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>AI Intelligence</DrawerTitle></DrawerHeader>
          <div className="max-h-[65vh] overflow-y-auto p-4"><SignalFeed /></div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  const { data: bot } = useBotStatus();
  const state = bot?.status?.state ?? "OFFLINE";
  return (
    <div className="page-header">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="top-status"><Dot tone={stateTone(state)} /> {state}</span>
          <LiveNotConfigured />
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function Panel({ children, className, title, aside }: { children: ReactNode; className?: string; title?: string; aside?: ReactNode }) {
  return (
    <section className={cn("panel", className)}>
      {title && <div className="panel-title"><h2>{title}</h2>{aside}</div>}
      {children}
    </section>
  );
}

export function MetricCard({ label, value, trend, tone = "neutral", icon: Icon = Activity }: {
  label: string; value: string; trend?: string; tone?: string; icon?: typeof Activity;
}) {
  return (
    <article className="metric-card">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <strong className={cn("mt-4 block text-2xl font-semibold", tone === "positive" && "text-positive", tone === "negative" && "text-negative", tone === "ai" && "text-primary")}>
        {value}
      </strong>
      {trend && <span className="mt-1 block text-xs text-muted-foreground">{trend}</span>}
    </article>
  );
}

export function HunterScore({ score, small = false }: { score: number; small?: boolean }) {
  const color = score >= 85 ? "text-positive" : score >= 70 ? "text-warning" : "text-negative";
  return (
    <div className={cn("score-ring", small ? "h-11 w-11" : "h-32 w-32")} style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
      <div className="score-inner">
        <strong className={cn(color, small ? "text-xs" : "text-3xl")}>{Math.round(score)}</strong>
        {!small && <small>/100</small>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- HUNTER MAP
type SizeMetric = "market_cap" | "liquidity" | "volume_24h" | "smart_money_score";
const metricLabels: Record<SizeMetric, string> = {
  market_cap: "Market Cap", liquidity: "Liquidity", volume_24h: "Volume", smart_money_score: "Smart Money",
};

/** Deterministic layout so the same graph always renders identically. */
function layout(nodes: MapNode[]) {
  const cx = 465;
  const cy = 270;
  return nodes.map((node, i) => {
    const angle = i * 2.399963;
    const radius = 30 + Math.sqrt(i + 1) * 62;
    return { node, x: cx + Math.cos(angle) * radius * 0.92, y: cy + Math.sin(angle) * radius * 0.55 };
  });
}

export function BubbleMap({ expanded = false }: { expanded?: boolean }) {
  const [sizeBy, setSizeBy] = useState<SizeMetric>("market_cap");
  const [filter, setFilter] = useState("ALL");
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [hovered, setHovered] = useState<MapNode | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const { data, isLoading } = useHunterMapData({ minHunterScore: minScore });

  const nodes = useMemo(() => {
    const all = data?.nodes ?? [];
    return all.filter((n) => {
      if (filter === "ALL") return true;
      if (filter === "SMART MONEY") return Number(n.smart_money_score ?? 0) >= 75;
      if (filter === "NEW LAUNCHES") return n.is_new;
      if (filter === "MOMENTUM") return Number(n.price_change_5m ?? 0) > 0;
      if (filter === "HIGH LIQUIDITY") return Number(n.liquidity ?? 0) > 0;
      if (filter === "AI SIGNAL") return Number(n.hunter_score ?? 0) >= 80;
      if (filter === "WALLETS") return n.kind === "WALLET";
      return true;
    });
  }, [data, filter]);

  const placed = useMemo(() => layout(nodes), [nodes]);
  const edges: MapEdge[] = data?.edges ?? [];
  const visibleIds = new Set(nodes.map((n) => n.id));
  const shownEdges = selected
    ? edges.filter((e) => e.source === selected.id || e.target === selected.id)
    : edges;

  const maxSize = Math.max(...nodes.map((n) => Number(n[sizeBy] ?? 0)), 1);
  const radiusOf = (n: MapNode) => 18 + Math.sqrt(Number(n[sizeBy] ?? 0) / maxSize) * (expanded ? 35 : 28);
  const positionOf = (id: string) => placed.find((p) => p.node.id === id);

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setScale((v) => Math.max(0.65, Math.min(2.2, v + (e.deltaY < 0 ? 0.1 : -0.1))));
  };

  return (
    <div className={cn("map-shell", expanded ? "h-[calc(100vh-260px)] min-h-[620px]" : "h-[580px]")}>
      <div className="map-toolbar">
        <div className="segmented">
          <span>SIZE BY</span>
          {(Object.keys(metricLabels) as SizeMetric[]).map((k) => (
            <button key={k} className={sizeBy === k ? "active" : ""} onClick={() => setSizeBy(k)}>{metricLabels[k]}</button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="outline" onClick={() => setScale((v) => Math.min(2.2, v + 0.15))} aria-label="Zoom in"><Plus /></Button>
          <Button size="icon" variant="outline" onClick={() => setScale((v) => Math.max(0.65, v - 0.15))} aria-label="Zoom out"><Minus /></Button>
          <Button size="sm" variant="outline" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); setSelected(null); }}><RotateCcw /> Reset</Button>
        </div>
      </div>
      <div className="filter-strip">
        {["ALL", "NEW LAUNCHES", "SMART MONEY", "MOMENTUM", "HIGH LIQUIDITY", "AI SIGNAL", "WALLETS"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={filter === f ? "active" : ""}>{f}</button>
        ))}
        <button className={minScore ? "active" : ""} onClick={() => setMinScore(minScore ? undefined : 80)}>
          SCORE ≥ 80
        </button>
      </div>

      {isLoading ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">Loading graph…</div>
      ) : nodes.length === 0 ? (
        <div className="grid h-full place-items-center p-6"><NotConnected /></div>
      ) : (
        <svg
          viewBox="0 0 930 540"
          className="h-full w-full cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onMouseDown={(e) => setDrag({ x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y })}
          onMouseMove={(e: ReactMouseEvent<SVGSVGElement>) =>
            drag && setOffset({ x: drag.ox + (e.clientX - drag.x) / scale, y: drag.oy + (e.clientY - drag.y) / scale })
          }
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => { setDrag(null); setHovered(null); }}
        >
          <defs>
            <radialGradient id="bubble"><stop offset="0" stopColor="var(--primary-soft)" /><stop offset="1" stopColor="var(--surface-deep)" /></radialGradient>
          </defs>
          <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`} className="origin-center transition-transform duration-100">
            {shownEdges.map((edge) => {
              if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return null;
              const a = positionOf(edge.source);
              const b = positionOf(edge.target);
              if (!a || !b) return null;
              return (
                <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className={`link link-${edge.type.toLowerCase().replace(/_/g, "-")}`} />
              );
            })}
            {placed.map(({ node, x, y }) => (
              <TokenBubble
                key={node.id} node={node} x={x} y={y} radius={radiusOf(node)}
                selected={selected?.id === node.id}
                related={!!selected && shownEdges.some((e) => e.source === node.id || e.target === node.id)}
                onHover={setHovered} onSelect={setSelected}
              />
            ))}
          </g>
        </svg>
      )}

      {hovered && <TokenTooltip node={hovered} />}
      <div className="map-legend">
        <span><i className="bg-positive" />Bullish</span>
        <span><i className="bg-negative" />Bearish</span>
        <span><i className="bg-primary" />Smart Money / wallet</span>
      </div>
      {selected && <TokenDetailPanel node={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

export function TokenBubble({ node, x, y, radius, selected, related, onHover, onSelect }: {
  node: MapNode; x: number; y: number; radius: number; selected: boolean; related: boolean;
  onHover: (n: MapNode | null) => void; onSelect: (n: MapNode) => void;
}) {
  const change = Number(node.price_change_5m ?? 0);
  const tone = node.kind === "WALLET" ? "ai" : change >= 0 ? "positive" : "negative";
  return (
    <g className={cn("token-node", selected && "selected", related && "related")} transform={`translate(${x} ${y})`}
      onMouseEnter={() => onHover(node)} onMouseLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onSelect(node); }} role="button" tabIndex={0}>
      <circle r={radius} fill="url(#bubble)" className={`bubble-stroke-${tone}`} />
      <circle r={radius - 4} className="bubble-core" />
      <text textAnchor="middle" y="-2" className="bubble-label">
        {node.kind === "TOKEN" ? `$${node.symbol ?? "?"}` : node.symbol}
      </text>
      <text textAnchor="middle" y="13" className={`bubble-change ${tone}`}>
        {node.kind === "TOKEN" ? (node.price_change_5m === null ? "—" : pct(node.price_change_5m)) : "WALLET"}
      </text>
      {Number(node.smart_money_score ?? 0) >= 85 && <circle cx={radius * 0.7} cy={-radius * 0.7} r="5" className="fill-warning node-beacon" />}
    </g>
  );
}

export function TokenTooltip({ node }: { node: MapNode }) {
  return (
    <div className="token-tooltip">
      <div className="flex justify-between">
        <strong>{node.kind === "TOKEN" ? `$${node.symbol ?? "?"}` : node.symbol}</strong>
        <span className={Number(node.price_change_5m ?? 0) >= 0 ? "text-positive" : "text-negative"}>{pct(node.price_change_5m)}</span>
      </div>
      <dl>
        <dt>Market cap</dt><dd>{money(node.market_cap)}</dd>
        <dt>Liquidity</dt><dd>{money(node.liquidity)}</dd>
        <dt>Volume 24h</dt><dd>{money(node.volume_24h)}</dd>
        <dt>Smart Money</dt><dd>{node.smart_money_score ?? "—"}</dd>
        <dt>Hunter score</dt><dd>{node.hunter_score ?? "—"}</dd>
      </dl>
    </div>
  );
}

export function TokenDetailPanel({ node, onClose }: { node: MapNode; onClose: () => void }) {
  return (
    <aside className="token-detail">
      <div className="flex items-start justify-between">
        <div>
          <p className="eyebrow">{node.kind === "TOKEN" ? "TOKEN INTELLIGENCE" : "WALLET INTELLIGENCE"}</p>
          <h2 className="mt-1 text-xl font-semibold">{node.kind === "TOKEN" ? `$${node.symbol ?? "?"}` : node.symbol}</h2>
          <p className="font-mono text-[10px] text-muted-foreground">{node.address}</p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close details"><X /></Button>
      </div>
      <div className="my-5 flex items-center gap-5">
        {node.hunter_score === null ? (
          <div className="score-ring h-32 w-32"><div className="score-inner"><strong className="text-sm text-muted-foreground">NO SCORE</strong></div></div>
        ) : (
          <HunterScore score={Number(node.hunter_score)} />
        )}
        <div>
          <p className="eyebrow">SCORE SOURCE</p>
          <strong className="text-primary">STRATEGY ENGINE</strong>
          <p className="mt-2 text-xs text-muted-foreground">
            {node.hunter_score === null ? "Awaiting market data" : "Computed from stored token intelligence"}
          </p>
        </div>
      </div>
      <div className="data-grid">
        <span>Market Cap<b>{money(node.market_cap)}</b></span>
        <span>Liquidity<b>{money(node.liquidity)}</b></span>
        <span>Volume 24h<b>{money(node.volume_24h)}</b></span>
        <span>Smart Money<b>{node.smart_money_score ?? "—"}</b></span>
        <span>5M change<b>{pct(node.price_change_5m)}</b></span>
        <span>New<b>{node.is_new ? "YES" : "NO"}</b></span>
      </div>
    </aside>
  );
}

export function PnlChart() {
  const { data: portfolio } = usePortfolio();
  const [series, setSeries] = useState<{ time: string; value: number }[]>([]);
  const realized = Number(portfolio?.realized_pnl ?? 0);

  useEffect(() => {
    setSeries((prev) => [...prev.slice(-40), { time: new Date().toLocaleTimeString(), value: realized }]);
  }, [realized]);

  if (series.length < 2) {
    return (
      <Panel title="CUMULATIVE P&L">
        <NotConnected title="NOT ENOUGH TRADE HISTORY" detail="The P&L curve is drawn from your recorded trades. Once paper trades close, it fills in here." />
      </Panel>
    );
  }
  return (
    <Panel title="CUMULATIVE P&L" aside={<span className={cn("text-sm font-semibold", realized >= 0 ? "text-positive" : "text-negative")}>{usd(realized)}</span>}>
      <div className="h-64 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series}>
            <defs>
              <linearGradient id="pnl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--positive)" stopOpacity={0.3} />
                <stop offset="1" stopColor="var(--positive)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} />
            <ChartTooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }} />
            <Area type="monotone" dataKey="value" stroke="var(--positive)" fill="url(#pnl)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function WalletPanel({ vault = false }: { vault?: boolean }) {
  return (
    <Panel title={vault ? "VAULT WALLET" : "TRADING WALLET"} aside={<span className="top-status text-muted-foreground"><Dot tone="muted" /> NOT CONNECTED</span>}>
      <div className="grid min-h-64 place-items-center text-center">
        <div>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-border bg-secondary">
            <WalletCards className="text-muted-foreground" />
          </div>
          <h3 className="mt-4 font-semibold">No wallet connected</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Wallet connectivity and on-chain transactions arrive in a later phase. No keys or seed phrases are ever stored.
          </p>
          <Button className="mt-5" disabled>Connect{vault ? "" : " Wallet"}</Button>
        </div>
      </div>
      {!vault && (
        <div className="data-grid">
          <span>Balance<b>—</b></span><span>Available<b>—</b></span><span>In Positions<b>—</b></span><span>P&L<b>—</b></span>
        </div>
      )}
    </Panel>
  );
}

export { Gauge };
