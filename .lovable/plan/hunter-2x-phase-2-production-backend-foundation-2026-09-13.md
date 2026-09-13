# HUNTER 2X — Phase 2: Production Backend Foundation

## Goal
Turn the Phase 1 interface into a real product with accounts, a production database, a server-side strategy engine, a risk engine, a bot state machine, and a paper-only execution pipeline. No market-data provider, no wallet, no blockchain transactions, no live money.

## What you will see when this is done
- Real signup, login, logout, and password reset; the terminal is only reachable when signed in.
- Strategies and their full parameter set, risk settings, and bot state are saved to your account and persist across devices.
- Start / pause / resume / stop / kill actually change a stored bot state, with a kill that stays locked until you clear it.
- Positions, orders, trades, signals, risk events, and portfolio figures come from the database and update live without refreshing.
- Because no market-data source is connected yet, market screens (Hunter Map, Token Scanner, Smart Money) show a clear "DATA SOURCE NOT CONNECTED" state instead of invented numbers.
- Live execution is shown everywhere as "LIVE EXECUTION — NOT CONFIGURED" and cannot run.

## Approach

### 1. Backend enablement
Enable Lovable Cloud (Postgres, auth, realtime, secrets) and wire the generated client. Email/password sign-in enabled; leaked-password protection on.

### 2. Schema (one clean migration set)
Tables exactly as specified: `profiles`, `strategies`, `strategy_parameters`, `tokens` (unique `chain + address`), `token_relationships`, `wallets`, `wallet_watchlist`, `wallet_activity`, `signals`, `positions`, `orders` (unique `idempotency_key`), `trades`, `risk_events`, `bot_sessions`, `bot_state`, `portfolio_snapshots`, `system_logs`.
- Postgres enums for every listed status/type set (mode, order type/status, position status, execution provider, signal type/source, wallet type, activity type, risk event type, log level, bot state).
- Profile row auto-created on signup via trigger.
- Zero seed rows in market tables. A single default PAPER strategy plus default parameters is created per user on signup — configuration, not fake market data.
- Grants for every public table, RLS enabled, owner-scoped policies (`auth.uid()`) on all user tables; `tokens`, `token_relationships`, `wallets`, `wallet_activity` readable by authenticated users, writable only server-side.
- Indexes and composites per the spec list.

### 3. Server-side engines (TanStack server functions, not edge functions)
- **Strategy engine** `evaluateToken(token, strategy)` — deterministic weighted Hunter Score (smart money 25, momentum 20, volume accel 15, liquidity 15, holders 10, buy/sell 10, age 5) read from a weights config, returning score, component scores, signal, reason codes, risk flags.
- **Risk engine** `evaluateTradeRisk()` — every one of the listed checks (daily loss, per-trade loss, open positions, exposure, position size, slippage, liquidity, hunter/smart-money minimums, consecutive losses, blacklist, token age, duplicate position, bot/strategy/account status), returning `{ approved, risk_score, reasons[], warnings[] }` and writing a `risk_events` row on rejection. Rejections never reach execution.
- **Bot state machine** — `startBot`, `pauseBot`, `resumeBot`, `stopBot`, `killBot` with validated transitions, session rows, and a kill that requires an explicit reset action.
- **Order pipeline** — propose → strategy gate → risk gate → order row (`CREATED`→`VALIDATING`→`APPROVED`/`REJECTED`→`SUBMITTED`→`FILLED`/`FAILED`) → position → trade, with idempotency keys, no blind retries, and explicit failure states.

### 4. Provider abstraction
Interfaces for `MarketDataProvider`, `TokenIntelligenceProvider`, `WalletIntelligenceProvider`, `SignalProvider`, `ExecutionProvider`. `PaperExecutionProvider` implemented end to end; `GMGNExecutionProvider` and all intelligence providers exist as stubs returning `NOT_CONFIGURED` — never fabricated data. Provider choice is config-driven; LIVE is refused at the execution boundary.

### 5. Frontend integration
- `/auth` page (sign in, sign up, reset) and the terminal moved under the protected layout; session-aware top bar with sign out.
- Delete `src/lib/mock-data.ts` and replace every consumer with database reads via server functions + TanStack Query.
- Strategies, strategy parameters, risk settings, bot controls, positions, orders, trades, signals, portfolio, system logs become live database-backed views with Realtime subscriptions.
- Hunter Map builds its graph from `tokens` + `token_relationships` with score/liquidity/type filters; empty database renders the not-connected state, not a hardcoded graph.

### 6. Security
No secrets in client code; all privileged work in server functions with owner verification; no key/seed storage anywhere; no client-side trade execution path; no secret logging.

## Validation before finishing
Signup→profile→default strategy chain; RLS cross-user read attempt fails; parameter and bot-state persistence; risk engine rejects an over-limit trade and logs the event; strategy score explainability; duplicate idempotency key rejected; realtime push observed; empty-state screens; LIVE mode refused; typecheck and build clean.

## Out of scope (Phase 3)
GMGN API/Skills/execution, Solana wallet connection, blockchain transactions, key or seed handling, live trading, deposits, withdrawals.
