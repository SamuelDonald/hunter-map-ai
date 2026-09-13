# Phase 3 — GMGN intelligence integration

Goal: real Solana token, market and Smart Money data flows into HUNTER 2X, gets scored, filtered by your strategy, checked by the risk engine, and executed in paper mode. No real money, no wallet, no live trading.

## What you will see when it's done

- The status bar and settings show a real GMGN connection state (not configured / connected / degraded / error), with last success, last error and response time — never "connected" unless a real request actually succeeded.
- Hunter Map, Token Scanner, token detail, Smart Money and the AI intelligence feed all fill with real Solana data instead of staying empty.
- A background hunter runs every minute: it discovers tokens, refreshes their metrics, records Smart Money activity, creates signals, computes Hunter Scores, applies your strategy limits, runs the risk checks and — when a candidate passes everything — opens a paper position automatically.
- Anything the provider doesn't return stays blank. Stale data blocks new trades rather than being treated as live.

## Your GMGN key

I'll ask you to paste your GMGN API key into a secure form. It is stored server-side only and never reaches the browser. Only the read-only intelligence endpoints are used this phase; the separate GMGN request-signing key needed for trading is not required and won't be added.

## Cadence note

A one-minute schedule means 1,440 background runs a day, which keeps the database and provider requests continuously active and costs more than a 5-minute cadence. Requests are throttled, cached and de-duplicated, and freshness windows stop us re-fetching the same token repeatedly. Say the word and I'll switch to 5 minutes.

## Technical detail

**GMGN access.** The `gmgn-skills` package is a Node CLI plus agent skill docs (`node:fs`, `node:module`, local `.env` files). It cannot run inside this app's edge server runtime, so I will not bundle it. Instead I'll implement a thin server-side client against the exact same documented OpenAPI it calls — `https://openapi.gmgn.ai`, `X-APIKEY` header plus `timestamp` + `client_id` query params — which is the real GMGN service, not a mock. Signed routes (swap, strategy orders, wallet holdings) are deliberately not implemented.

Capabilities to wire, subject to what the account plan actually returns:
- `/v1/market/rank`, `POST /v1/trenches`, `/v1/market/search` — discovery
- `/v1/token/info`, `/v1/token/security`, `/v1/token/pool_info` — token intelligence
- `/v1/market/token_top_holders`, `/v1/market/token_top_traders` — holder/trader analysis
- `/v1/user/smartmoney`, `/v1/user/kol`, `/v1/user/wallet_stats`, `/v1/user/wallet_activity` — wallet intelligence
- `/v1/market/token_signal`, `/v1/market/token_kline` — signals and momentum inputs
- `/v1/user/info` — health probe

Any endpoint the plan/version rejects is recorded as an unavailable capability; no substitute data is invented.

**New files** under `src/integrations/gmgn/`: `gmgnConfig.server.ts`, `gmgnClient.server.ts` (throttle, in-flight de-dup, timeout, bounded backoff, structured logging with no secrets), `gmgnTypes.ts`, `gmgnNormalizer.ts` (provider JSON → `NormalizedToken` / `NormalizedWallet` / `NormalizedSignal`, nullable stays null, never overwrite a good value with null), `gmgnHealth.server.ts`, and the market/token/wallet/signal adapters implementing the existing `MarketDataProvider`, `TokenIntelligenceProvider`, `WalletIntelligenceProvider`, `SignalProvider` interfaces in `src/lib/hunter/providers.server.ts`. `getExecutionProvider` stays untouched; `GMGNExecutionProvider` keeps refusing every call.

**Pipeline** in `src/lib/hunter/scanner.server.ts`: discovery → address validation → normalize → upsert `tokens` on `(chain, address)` → wallet + `wallet_activity` sync → deterministic component scores (Smart Money 25, momentum 20, volume acceleration 15, liquidity quality 15, holder distribution 10, buy/sell pressure 10, token age 5, each normalized 0–100) → persist `tokens.hunter_score` → signals de-duplicated on `source + provider_signal_id`, with a deterministic fingerprint when GMGN gives no event ID → existing `evaluateToken` strategy filter reading `strategy_parameters` → existing server-side risk engine → `PaperExecutionProvider` order + position + portfolio snapshot, keyed by an existing idempotency key. Rejections write a `risk_event` and no order. No path from signal or AI to execution.

**Scheduling**: `src/routes/api/public/hooks/hunter-scan.ts`, secret-header authenticated via the existing cron auth helper, called by pg_cron every minute. Bounded work per run (fixed token batch), a single-flight lease row so overlapping runs exit, per-item progress marking, and a circuit breaker that parks the scanner on repeated provider failures. Bot state moves through the existing machine; GMGN unhealthy or data stale → no `TRADING`, transition to `PAUSED`/`ERROR` by severity.

**Migration** (additive only): `provider_integrations` table (provider, status, last_success_at, last_error_at, last_error, latency_ms, capabilities, updated_at — no secrets), `scanner_leases` for single-flight, freshness/sync timestamp columns where missing, RLS + grants on both, and indexes for the scan workload.

**Frontend** (data wiring only, no redesign): status bar and AI Agent panel read real GMGN health; Hunter Map, scanner, token detail and Smart Money read the now-populated tables; provider freshness and source shown on token detail. Wallet stays NOT CONNECTED.

**AI agent** keeps analysis-only duties (explanations, ranking already-qualified candidates, anomaly notes) with structured output; it cannot alter scores, limits, kill switch, mode or orders.

**Verification**: live GMGN request executed and its real data followed through to a paper position; tests for provider unavailable/auth failure/timeout/rate limit, duplicate token and signal ingestion, stale data, malformed token, strategy rejection, risk rejection, scanner restart and concurrent-run protection, plus a test asserting GMGN execution refuses. Types regenerated from the database. Closing report lists files, migrations, connected vs unavailable capabilities, secrets, tests and the Phase 4 next step.

Integration is only reported successful if a real GMGN request returns real data into the pipeline.
