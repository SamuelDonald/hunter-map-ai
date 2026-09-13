# HUNTER 2X Frontend Plan

## Goal
Build a polished, responsive crypto intelligence terminal using centralized mock data only. No wallet, trading, authentication, GMGN, blockchain, AI, market-data, or backend connections will be created.

## Application shell
- Create a persistent desktop shell with compact top bar, collapsible left navigation, central workspace, right AI intelligence feed, and bottom status bar.
- Use a restrained dark aurora palette with thin borders, selective glass effects, compact typography, and semantic green/red/yellow/blue-gray indicators.
- Add explicit `DEMO DATA`, `PAPER MODE`, and `NOT CONNECTED` labels anywhere data or future integrations appear.
- On tablet/mobile, collapse navigation into a drawer, move intelligence into a bottom drawer, preserve the map as the main focus, and make dense tables horizontally scrollable.

## Routes and screens
- `/` — Overview with status header, six summary metrics, interactive bubble map, filters, and AI intelligence feed.
- `/hunter-map` — Expanded map workspace with relationship legend, sizing controls, filters, selection details, zoom, pan, and reset.
- `/token-scanner` — Searchable, sortable, filterable, paginated token table.
- `/smart-money` — Wallet bubbles, ranked wallet metrics, activity lists, and selectable wallet intelligence panel.
- `/positions` — Open positions table and visual P&L chart.
- `/trade-history` — Trade records plus win rate, winner/loser averages, profit factor, total P&L, and drawdown metrics.
- `/strategies` — Fully interactive local strategy controls for all requested thresholds and toggles.
- `/risk` — Editable local risk controls, daily-risk progress, and bot-health status.
- `/wallet` — Visually complete trading and vault wallet placeholders with non-connecting buttons.
- `/ai-agent` — Ready/waiting states and an animated mock activity stream, with all future integrations labeled disconnected.
- `/settings` — Appearance, notifications, trading, data, risk, bot, and about sections using local-only controls.

## Bubble-map experience
- Build an SVG-based network visualization with roughly 30–35 token, wallet, liquidity, and Smart Money nodes.
- Scale bubbles by Market Cap, Liquidity, Volume, or Smart Money using a working segmented selector.
- Render distinct subtle link styles for Smart Money overlap, wallet overlap, correlation, token cluster, and liquidity relationships.
- Support hover tooltips, click selection, selected-node emphasis, connected-node highlighting, zoom, pan, reset, and working local filters.
- Open a detailed token panel with price and market metrics, score gauge, signal, miniature 5M/15M/1H charts, holder and wallet lists, activity, and mock AI analysis.
- Use gentle node breathing, slow connection movement, and reduced-motion support; keep the visualization performant by using one SVG scene rather than many animated DOM layers.

## Components and data
- Create reusable shell and visualization components matching the requested component list: `BubbleMap`, `TokenBubble`, `TokenTooltip`, `TokenDetailPanel`, `SmartMoneyBubble`, `SignalFeed`, `HunterScore`, `MetricCard`, `TokenTable`, `PositionTable`, `StrategyPanel`, `RiskPanel`, `WalletPanel`, `AIActivityFeed`, `StatusBar`, `Sidebar`, and `TopBar`.
- Centralize typed mock datasets for tokens, relationships, wallets, signals, positions, trades, portfolio, risk, charts, and AI events.
- Keep all controls in temporary React state so sorting, filters, pagination, selectors, drawers, toggles, and panels behave convincingly without persistence.

## Visual system and quality
- Define semantic color, surface, glow, chart, spacing, and typography tokens in the global design system; use existing accessible interface primitives and icon set.
- Use one readable condensed display face and one compact technical body face, loaded in the document head.
- Give every route unique HUNTER 2X metadata and preserve a single clear page heading per screen.
- Verify desktop and mobile layouts, map interactions, navigation, tables, drawers, controls, contrast, overflow, and browser console health.

## Out of scope
- No Lovable Cloud, database, authentication, API calls, GMGN tools, Solana wallet adapter, wallet signing, private keys, transactions, order execution, live pricing, or server-side trading logic.
