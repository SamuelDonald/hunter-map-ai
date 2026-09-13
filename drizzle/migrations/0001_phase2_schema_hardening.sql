-- HUNTER 2X Phase 2 schema hardening: constraints, dedup, audit protection, indexes.

-- 1. RISK SETTINGS: kill switch is a risk boundary, not a strategy preference.
ALTER TABLE public.risk_settings
  ADD COLUMN IF NOT EXISTS kill_switch boolean NOT NULL DEFAULT false;

ALTER TABLE public.risk_settings
  DROP CONSTRAINT IF EXISTS risk_settings_bounds,
  ADD CONSTRAINT risk_settings_bounds CHECK (
    max_daily_loss > 0 AND max_trade_loss > 0 AND max_positions > 0
    AND max_exposure > 0 AND max_slippage >= 0 AND max_slippage <= 100
    AND consecutive_loss_limit > 0
  );

-- 2. STRATEGY PARAMETERS: all tunables stay configurable, but bounded.
ALTER TABLE public.strategy_parameters
  DROP CONSTRAINT IF EXISTS strategy_parameters_bounds,
  ADD CONSTRAINT strategy_parameters_bounds CHECK (
    hunter_score_min >= 0 AND hunter_score_min <= 100
    AND smart_money_score_min >= 0 AND smart_money_score_min <= 100
    AND min_liquidity >= 0 AND min_volume >= 0
    AND position_size > 0 AND max_positions > 0 AND max_exposure > 0
    AND take_profit_multiplier > 0
    AND stop_loss_percent > 0 AND stop_loss_percent < 100
    AND trailing_stop_percent > 0 AND trailing_stop_percent < 100
    AND partial_take_profit_percent > 0 AND partial_take_profit_percent <= 100
    AND partial_take_profit_amount > 0 AND partial_take_profit_amount <= 100
    AND max_slippage >= 0 AND max_slippage <= 100
    AND min_token_age >= 0 AND max_token_age >= 0 AND max_token_age >= min_token_age
  );

-- 3. HUNTER SCORE WEIGHTS: configurable per strategy, must always total exactly 100.
ALTER TABLE public.strategy_parameters
  DROP CONSTRAINT IF EXISTS strategy_parameters_score_weights_total,
  ADD CONSTRAINT strategy_parameters_score_weights_total CHECK (
    (COALESCE((score_weights->>'smart_money')::numeric, -1)
     + COALESCE((score_weights->>'momentum')::numeric, -1)
     + COALESCE((score_weights->>'volume_acceleration')::numeric, -1)
     + COALESCE((score_weights->>'liquidity_quality')::numeric, -1)
     + COALESCE((score_weights->>'holder_distribution')::numeric, -1)
     + COALESCE((score_weights->>'buy_sell_pressure')::numeric, -1)
     + COALESCE((score_weights->>'token_age')::numeric, -1)) = 100
    AND (score_weights->>'smart_money')::numeric >= 0
    AND (score_weights->>'momentum')::numeric >= 0
    AND (score_weights->>'volume_acceleration')::numeric >= 0
    AND (score_weights->>'liquidity_quality')::numeric >= 0
    AND (score_weights->>'holder_distribution')::numeric >= 0
    AND (score_weights->>'buy_sell_pressure')::numeric >= 0
    AND (score_weights->>'token_age')::numeric >= 0
  );

-- 4. TOKENS: scores, percentages and amounts stay sane; (chain,address) already unique.
ALTER TABLE public.tokens
  DROP CONSTRAINT IF EXISTS tokens_score_bounds,
  ADD CONSTRAINT tokens_score_bounds CHECK (
    (smart_money_score IS NULL OR (smart_money_score >= 0 AND smart_money_score <= 100))
    AND (social_score IS NULL OR (social_score >= 0 AND social_score <= 100))
    AND (momentum_score IS NULL OR (momentum_score >= 0 AND momentum_score <= 100))
    AND (hunter_score IS NULL OR (hunter_score >= 0 AND hunter_score <= 100))
    AND (top_holder_percentage IS NULL OR (top_holder_percentage >= 0 AND top_holder_percentage <= 100))
  );

ALTER TABLE public.tokens
  DROP CONSTRAINT IF EXISTS tokens_amount_bounds,
  ADD CONSTRAINT tokens_amount_bounds CHECK (
    (price IS NULL OR price >= 0) AND (market_cap IS NULL OR market_cap >= 0)
    AND (liquidity IS NULL OR liquidity >= 0)
    AND (volume_5m IS NULL OR volume_5m >= 0) AND (volume_1h IS NULL OR volume_1h >= 0)
    AND (volume_24h IS NULL OR volume_24h >= 0)
    AND (holders IS NULL OR holders >= 0)
    AND (buys_5m IS NULL OR buys_5m >= 0) AND (sells_5m IS NULL OR sells_5m >= 0)
    AND (buy_sell_ratio IS NULL OR buy_sell_ratio >= 0)
    AND (token_age_seconds IS NULL OR token_age_seconds >= 0)
    AND (decimals IS NULL OR (decimals >= 0 AND decimals <= 32))
    AND length(address) > 0 AND length(chain) > 0
  );

-- 5. TOKEN RELATIONSHIPS: no self-edges, strength normalised 0..1, no duplicates (already unique).
ALTER TABLE public.token_relationships
  DROP CONSTRAINT IF EXISTS token_relationships_no_self,
  ADD CONSTRAINT token_relationships_no_self CHECK (source_token_id <> target_token_id);

ALTER TABLE public.token_relationships
  DROP CONSTRAINT IF EXISTS token_relationships_strength_bounds,
  ADD CONSTRAINT token_relationships_strength_bounds CHECK (strength >= 0 AND strength <= 1);

-- 6. WALLETS: external intelligence wallets only; scores bounded, no key material.
ALTER TABLE public.wallets
  DROP CONSTRAINT IF EXISTS wallets_score_bounds,
  ADD CONSTRAINT wallets_score_bounds CHECK (
    (smart_money_score IS NULL OR (smart_money_score >= 0 AND smart_money_score <= 100))
    AND (win_rate IS NULL OR (win_rate >= 0 AND win_rate <= 100))
    AND (total_trades IS NULL OR total_trades >= 0)
    AND length(address) > 0 AND length(chain) > 0
  );

-- 7. SIGNALS: provider-specific dedup so repeated external signals cannot fan out into trades.
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS provider_signal_id text;

CREATE UNIQUE INDEX IF NOT EXISTS signals_source_provider_id_unique
  ON public.signals (source, provider_signal_id)
  WHERE provider_signal_id IS NOT NULL;

ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_score_bounds,
  ADD CONSTRAINT signals_score_bounds CHECK (
    (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))
    AND (hunter_score IS NULL OR (hunter_score >= 0 AND hunter_score <= 100))
  );

CREATE INDEX IF NOT EXISTS idx_signals_token_created ON public.signals (token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status_created ON public.signals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_open ON public.signals (user_id, created_at DESC)
  WHERE status IN ('NEW', 'ACKNOWLEDGED');

-- 8. ORDERS: idempotency already unique; provider ids unique per provider only.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_amount_bounds,
  ADD CONSTRAINT orders_amount_bounds CHECK (
    (quantity IS NULL OR quantity > 0)
    AND (requested_price IS NULL OR requested_price > 0)
    AND (executed_price IS NULL OR executed_price > 0)
    AND (slippage IS NULL OR (slippage >= 0 AND slippage <= 100))
    AND length(idempotency_key) > 0
  );

CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_external_id_unique
  ON public.orders (execution_provider, external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_status ON public.orders (user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_active ON public.orders (user_id, created_at DESC)
  WHERE status IN ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'PARTIALLY_FILLED');

-- 9. POSITIONS: spot LONG exposure only, real quantities, unique per provider position id.
ALTER TABLE public.positions
  DROP CONSTRAINT IF EXISTS positions_long_only,
  ADD CONSTRAINT positions_long_only CHECK (side = 'LONG');

ALTER TABLE public.positions
  DROP CONSTRAINT IF EXISTS positions_amount_bounds,
  ADD CONSTRAINT positions_amount_bounds CHECK (
    (quantity IS NULL OR quantity > 0)
    AND (entry_price IS NULL OR entry_price > 0)
    AND (current_price IS NULL OR current_price > 0)
    AND (invested_amount IS NULL OR invested_amount > 0)
    AND (current_value IS NULL OR current_value >= 0)
    AND (take_profit_price IS NULL OR take_profit_price > 0)
    AND (stop_loss_price IS NULL OR stop_loss_price > 0)
    AND (trailing_stop_price IS NULL OR trailing_stop_price > 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS positions_provider_external_id_unique
  ON public.positions (execution_provider, external_position_id)
  WHERE external_position_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_positions_open ON public.positions (user_id, opened_at DESC)
  WHERE status IN ('OPEN', 'CLOSING');

-- 10. TRADES: permanent audit record.
ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_amount_bounds,
  ADD CONSTRAINT trades_amount_bounds CHECK (
    (quantity IS NULL OR quantity > 0)
    AND (entry_price IS NULL OR entry_price > 0)
    AND (exit_price IS NULL OR exit_price > 0)
    AND (invested_amount IS NULL OR invested_amount > 0)
    AND (exit_value IS NULL OR exit_value >= 0)
    AND fees >= 0
    AND (slippage IS NULL OR (slippage >= 0 AND slippage <= 100))
  );

CREATE INDEX IF NOT EXISTS idx_trades_user_created ON public.trades (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_user_closed ON public.trades (user_id, closed_at DESC);

-- 11. MARKET / INTELLIGENCE WORKLOAD INDEXES.
CREATE INDEX IF NOT EXISTS idx_tokens_hunter_score ON public.tokens (hunter_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_tokens_liquidity ON public.tokens (liquidity DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_tokens_smart_money ON public.tokens (smart_money_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_tokens_last_update ON public.tokens (last_market_update DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wallet_activity_wallet_time ON public.wallet_activity (wallet_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_user_status ON public.bot_sessions (user_id, status);

-- 12. BOT SESSIONS integrity.
ALTER TABLE public.bot_sessions
  DROP CONSTRAINT IF EXISTS bot_sessions_counters,
  ADD CONSTRAINT bot_sessions_counters CHECK (
    trades_count >= 0 AND winning_trades >= 0 AND losing_trades >= 0 AND error_count >= 0
    AND (stopped_at IS NULL OR stopped_at >= started_at)
  );

-- 13. HISTORICAL DATA PROTECTION: audit tables are insert/read/update only for users.
DROP POLICY IF EXISTS "own trades" ON public.trades;
CREATE POLICY "own trades select" ON public.trades FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own trades insert" ON public.trades FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own orders" ON public.orders;
CREATE POLICY "own orders select" ON public.orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own orders insert" ON public.orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own orders update" ON public.orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own positions" ON public.positions;
CREATE POLICY "own positions select" ON public.positions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own positions insert" ON public.positions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own positions update" ON public.positions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own risk events" ON public.risk_events;
CREATE POLICY "own risk events select" ON public.risk_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own risk events insert" ON public.risk_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own bot sessions" ON public.bot_sessions;
CREATE POLICY "own bot sessions select" ON public.bot_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own bot sessions insert" ON public.bot_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own bot sessions update" ON public.bot_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own snapshots" ON public.portfolio_snapshots;
CREATE POLICY "own snapshots select" ON public.portfolio_snapshots FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own snapshots insert" ON public.portfolio_snapshots FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

REVOKE DELETE ON public.trades, public.orders, public.positions, public.risk_events,
  public.bot_sessions, public.portfolio_snapshots, public.system_logs FROM authenticated;

-- 14. BOT STATE: privileged states can only be reached through validated server transitions.
CREATE OR REPLACE FUNCTION public.validate_bot_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;

  -- KILLED requires an explicit server-side reset back to OFFLINE.
  IF OLD.state = 'KILLED' AND NEW.state <> 'OFFLINE' THEN
    RAISE EXCEPTION 'bot is KILLED: explicit reset to OFFLINE required';
  END IF;

  IF NOT (
    (OLD.state = 'OFFLINE'    AND NEW.state IN ('STARTING','KILLED','ERROR')) OR
    (OLD.state = 'STARTING'   AND NEW.state IN ('SCANNING','ERROR','OFFLINE','KILLED','PAUSED')) OR
    (OLD.state = 'SCANNING'   AND NEW.state IN ('ANALYZING','READY','PAUSED','RISK_PAUSED','ERROR','OFFLINE','KILLED')) OR
    (OLD.state = 'ANALYZING'  AND NEW.state IN ('READY','SCANNING','PAUSED','RISK_PAUSED','ERROR','OFFLINE','KILLED')) OR
    (OLD.state = 'READY'      AND NEW.state IN ('TRADING','SCANNING','PAUSED','RISK_PAUSED','ERROR','OFFLINE','KILLED')) OR
    (OLD.state = 'TRADING'    AND NEW.state IN ('SCANNING','READY','PAUSED','RISK_PAUSED','ERROR','OFFLINE','KILLED')) OR
    (OLD.state = 'PAUSED'     AND NEW.state IN ('SCANNING','OFFLINE','ERROR','KILLED')) OR
    (OLD.state = 'RISK_PAUSED' AND NEW.state IN ('SCANNING','OFFLINE','ERROR','KILLED','PAUSED')) OR
    (OLD.state = 'ERROR'      AND NEW.state IN ('OFFLINE','STARTING','KILLED')) OR
    (OLD.state = 'KILLED'     AND NEW.state = 'OFFLINE')
  ) THEN
    RAISE EXCEPTION 'invalid bot state transition % -> %', OLD.state, NEW.state;
  END IF;

  NEW.state_changed_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bot_status_validate_transition ON public.bot_status;
CREATE TRIGGER bot_status_validate_transition
  BEFORE UPDATE ON public.bot_status
  FOR EACH ROW EXECUTE FUNCTION public.validate_bot_state_transition();
