-- =========================================================
-- HUNTER 2X — Phase 2 production schema
-- =========================================================

-- ---------- ENUMS ----------
CREATE TYPE public.strategy_mode AS ENUM ('PAPER','LIVE');
CREATE TYPE public.execution_provider AS ENUM ('PAPER','GMGN');
CREATE TYPE public.position_side AS ENUM ('LONG','SHORT');
CREATE TYPE public.position_status AS ENUM ('OPEN','CLOSING','CLOSED','FAILED');
CREATE TYPE public.order_type AS ENUM ('MARKET','LIMIT','TAKE_PROFIT','STOP_LOSS','TRAILING_STOP');
CREATE TYPE public.order_status AS ENUM ('CREATED','VALIDATING','APPROVED','REJECTED','SUBMITTED','PARTIALLY_FILLED','FILLED','CANCELLED','FAILED');
CREATE TYPE public.order_side AS ENUM ('BUY','SELL');
CREATE TYPE public.wallet_type AS ENUM ('SMART_MONEY','KOL','WHALE','INSIDER','BUNDLER','UNKNOWN');
CREATE TYPE public.wallet_activity_type AS ENUM ('BUY','SELL','TRANSFER','ADD_LIQUIDITY','REMOVE_LIQUIDITY');
CREATE TYPE public.relationship_type AS ENUM ('SMART_MONEY_OVERLAP','WALLET_OVERLAP','TRADING_CORRELATION','TOKEN_CLUSTER','LIQUIDITY_RELATIONSHIP','HOLDER_OVERLAP');
CREATE TYPE public.signal_type AS ENUM ('NEW_TOKEN','SMART_MONEY_BUY','MOMENTUM','VOLUME_ACCELERATION','LIQUIDITY_CHANGE','BUY_PRESSURE','BREAKOUT','REVERSAL','RISK_WARNING');
CREATE TYPE public.signal_source AS ENUM ('GMGN','STRATEGY_ENGINE','SYSTEM','USER');
CREATE TYPE public.signal_status AS ENUM ('NEW','ACKNOWLEDGED','ACTED','EXPIRED','DISMISSED');
CREATE TYPE public.signal_direction AS ENUM ('BULLISH','BEARISH','NEUTRAL');
CREATE TYPE public.risk_event_type AS ENUM ('DAILY_LOSS_LIMIT','TRADE_LOSS_LIMIT','MAX_POSITIONS','MAX_EXPOSURE','HIGH_SLIPPAGE','LOW_LIQUIDITY','LOW_SCORE','BLACKLISTED_TOKEN','CONSECUTIVE_LOSSES','SYSTEM_ERROR','MANUAL_KILL');
CREATE TYPE public.risk_severity AS ENUM ('INFO','WARNING','CRITICAL');
CREATE TYPE public.bot_state AS ENUM ('OFFLINE','STARTING','SCANNING','ANALYZING','READY','TRADING','PAUSED','RISK_PAUSED','ERROR','KILLED');
CREATE TYPE public.log_level AS ENUM ('DEBUG','INFO','WARNING','ERROR','CRITICAL');

-- ---------- shared updated_at trigger ----------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ---------- PROFILES ----------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- STRATEGIES ----------
CREATE TABLE public.strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  mode public.strategy_mode NOT NULL DEFAULT 'PAPER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategies TO authenticated;
GRANT ALL ON public.strategies TO service_role;
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own strategies" ON public.strategies FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER strategies_touch BEFORE UPDATE ON public.strategies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_strategies_user ON public.strategies (user_id, created_at DESC);

CREATE TABLE public.strategy_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL UNIQUE REFERENCES public.strategies(id) ON DELETE CASCADE,
  hunter_score_min NUMERIC NOT NULL DEFAULT 80,
  min_liquidity NUMERIC NOT NULL DEFAULT 50000,
  min_volume NUMERIC NOT NULL DEFAULT 25000,
  smart_money_score_min NUMERIC NOT NULL DEFAULT 75,
  position_size NUMERIC NOT NULL DEFAULT 10,
  max_positions INTEGER NOT NULL DEFAULT 5,
  max_exposure NUMERIC NOT NULL DEFAULT 50,
  take_profit_multiplier NUMERIC NOT NULL DEFAULT 2.0,
  stop_loss_percent NUMERIC NOT NULL DEFAULT 20,
  trailing_stop_enabled BOOLEAN NOT NULL DEFAULT true,
  trailing_stop_percent NUMERIC NOT NULL DEFAULT 12,
  partial_take_profit_enabled BOOLEAN NOT NULL DEFAULT true,
  partial_take_profit_percent NUMERIC NOT NULL DEFAULT 50,
  partial_take_profit_amount NUMERIC NOT NULL DEFAULT 50,
  allow_new_launches BOOLEAN NOT NULL DEFAULT false,
  allow_smart_money BOOLEAN NOT NULL DEFAULT true,
  allow_momentum BOOLEAN NOT NULL DEFAULT true,
  max_slippage NUMERIC NOT NULL DEFAULT 5,
  min_token_age INTEGER NOT NULL DEFAULT 300,
  max_token_age INTEGER NOT NULL DEFAULT 2592000,
  score_weights JSONB NOT NULL DEFAULT '{"smart_money":25,"momentum":20,"volume_acceleration":15,"liquidity_quality":15,"holder_distribution":10,"buy_sell_pressure":10,"token_age":5}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_parameters TO authenticated;
GRANT ALL ON public.strategy_parameters TO service_role;
ALTER TABLE public.strategy_parameters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own strategy parameters" ON public.strategy_parameters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.strategies s WHERE s.id = strategy_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.strategies s WHERE s.id = strategy_id AND s.user_id = auth.uid()));
CREATE TRIGGER strategy_parameters_touch BEFORE UPDATE ON public.strategy_parameters FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- RISK SETTINGS ----------
CREATE TABLE public.risk_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  max_daily_loss NUMERIC NOT NULL DEFAULT 50,
  max_trade_loss NUMERIC NOT NULL DEFAULT 10,
  max_positions INTEGER NOT NULL DEFAULT 5,
  max_exposure NUMERIC NOT NULL DEFAULT 50,
  max_slippage NUMERIC NOT NULL DEFAULT 5,
  consecutive_loss_limit INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_settings TO authenticated;
GRANT ALL ON public.risk_settings TO service_role;
ALTER TABLE public.risk_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own risk settings" ON public.risk_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER risk_settings_touch BEFORE UPDATE ON public.risk_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- TOKENS (shared market data) ----------
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain TEXT NOT NULL DEFAULT 'solana',
  address TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  logo_url TEXT,
  decimals INTEGER,
  market_cap NUMERIC,
  liquidity NUMERIC,
  volume_5m NUMERIC,
  volume_1h NUMERIC,
  volume_24h NUMERIC,
  price NUMERIC,
  price_change_5m NUMERIC,
  price_change_1h NUMERIC,
  price_change_24h NUMERIC,
  buys_5m INTEGER,
  sells_5m INTEGER,
  buy_sell_ratio NUMERIC,
  holders INTEGER,
  top_holder_percentage NUMERIC,
  token_age_seconds BIGINT,
  smart_money_score NUMERIC,
  social_score NUMERIC,
  momentum_score NUMERIC,
  hunter_score NUMERIC,
  is_new BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_blacklisted BOOLEAN NOT NULL DEFAULT false,
  last_market_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tokens_chain_address_key UNIQUE (chain, address)
);
GRANT SELECT ON public.tokens TO authenticated;
GRANT ALL ON public.tokens TO service_role;
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tokens readable by signed in users" ON public.tokens FOR SELECT TO authenticated USING (true);
CREATE TRIGGER tokens_touch BEFORE UPDATE ON public.tokens FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_tokens_chain ON public.tokens (chain);
CREATE INDEX idx_tokens_address ON public.tokens (address);
CREATE INDEX idx_tokens_symbol ON public.tokens (symbol);
CREATE INDEX idx_tokens_hunter_score ON public.tokens (hunter_score DESC);
CREATE INDEX idx_tokens_market_cap ON public.tokens (market_cap DESC);
CREATE INDEX idx_tokens_liquidity ON public.tokens (liquidity DESC);
CREATE INDEX idx_tokens_smart_money_score ON public.tokens (smart_money_score DESC);
CREATE INDEX idx_tokens_last_market_update ON public.tokens (last_market_update DESC);
CREATE INDEX idx_tokens_chain_score ON public.tokens (chain, hunter_score DESC);

-- ---------- TOKEN RELATIONSHIPS ----------
CREATE TABLE public.token_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  target_token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  relationship_type public.relationship_type NOT NULL,
  strength NUMERIC NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT token_relationships_unique UNIQUE (source_token_id, target_token_id, relationship_type)
);
GRANT SELECT ON public.token_relationships TO authenticated;
GRANT ALL ON public.token_relationships TO service_role;
ALTER TABLE public.token_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "relationships readable by signed in users" ON public.token_relationships FOR SELECT TO authenticated USING (true);
CREATE TRIGGER token_relationships_touch BEFORE UPDATE ON public.token_relationships FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_token_rel_source ON public.token_relationships (source_token_id);
CREATE INDEX idx_token_rel_target ON public.token_relationships (target_token_id);
CREATE INDEX idx_token_rel_type ON public.token_relationships (relationship_type);

-- ---------- WALLETS ----------
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain TEXT NOT NULL DEFAULT 'solana',
  address TEXT NOT NULL,
  label TEXT,
  wallet_type public.wallet_type NOT NULL DEFAULT 'UNKNOWN',
  smart_money_score NUMERIC,
  win_rate NUMERIC,
  realized_pnl NUMERIC,
  total_trades INTEGER,
  is_tracked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallets_chain_address_key UNIQUE (chain, address)
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets readable by signed in users" ON public.wallets FOR SELECT TO authenticated USING (true);
CREATE TRIGGER wallets_touch BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_wallets_score ON public.wallets (smart_money_score DESC);
CREATE INDEX idx_wallets_type ON public.wallets (wallet_type);

CREATE TABLE public.wallet_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  label TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_watchlist_unique UNIQUE (user_id, wallet_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_watchlist TO authenticated;
GRANT ALL ON public.wallet_watchlist TO service_role;
ALTER TABLE public.wallet_watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own watchlist" ON public.wallet_watchlist FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_watchlist_user ON public.wallet_watchlist (user_id);

CREATE TABLE public.wallet_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  activity_type public.wallet_activity_type NOT NULL,
  amount NUMERIC,
  price NUMERIC,
  transaction_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_activity TO authenticated;
GRANT ALL ON public.wallet_activity TO service_role;
ALTER TABLE public.wallet_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet activity readable by signed in users" ON public.wallet_activity FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_wallet_activity_wallet ON public.wallet_activity (wallet_id);
CREATE INDEX idx_wallet_activity_occurred ON public.wallet_activity (occurred_at DESC);
CREATE INDEX idx_wallet_activity_wallet_time ON public.wallet_activity (wallet_id, occurred_at DESC);

-- ---------- SIGNALS ----------
CREATE TABLE public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  signal_type public.signal_type NOT NULL,
  direction public.signal_direction NOT NULL DEFAULT 'NEUTRAL',
  confidence NUMERIC,
  hunter_score NUMERIC,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  source public.signal_source NOT NULL DEFAULT 'STRATEGY_ENGINE',
  status public.signal_status NOT NULL DEFAULT 'NEW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own signals" ON public.signals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_signals_token ON public.signals (token_id);
CREATE INDEX idx_signals_created ON public.signals (created_at DESC);
CREATE INDEX idx_signals_user_created ON public.signals (user_id, created_at DESC);

-- ---------- POSITIONS ----------
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES public.strategies(id) ON DELETE SET NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  side public.position_side NOT NULL DEFAULT 'LONG',
  status public.position_status NOT NULL DEFAULT 'OPEN',
  entry_price NUMERIC,
  current_price NUMERIC,
  quantity NUMERIC,
  invested_amount NUMERIC,
  current_value NUMERIC,
  unrealized_pnl NUMERIC,
  unrealized_pnl_percent NUMERIC,
  take_profit_price NUMERIC,
  stop_loss_price NUMERIC,
  trailing_stop_price NUMERIC,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  execution_provider public.execution_provider NOT NULL DEFAULT 'PAPER',
  external_position_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own positions" ON public.positions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER positions_touch BEFORE UPDATE ON public.positions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_positions_user ON public.positions (user_id);
CREATE INDEX idx_positions_status ON public.positions (status);
CREATE INDEX idx_positions_user_status ON public.positions (user_id, status);
CREATE UNIQUE INDEX idx_positions_unique_open ON public.positions (user_id, strategy_id, token_id) WHERE status IN ('OPEN','CLOSING');

-- ---------- ORDERS ----------
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES public.strategies(id) ON DELETE SET NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  side public.order_side NOT NULL,
  order_type public.order_type NOT NULL DEFAULT 'MARKET',
  quantity NUMERIC,
  requested_price NUMERIC,
  executed_price NUMERIC,
  slippage NUMERIC,
  status public.order_status NOT NULL DEFAULT 'CREATED',
  execution_provider public.execution_provider NOT NULL DEFAULT 'PAPER',
  external_order_id TEXT,
  idempotency_key TEXT NOT NULL,
  failure_reason TEXT,
  risk_snapshot JSONB,
  submitted_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_idempotency_key_unique UNIQUE (idempotency_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own orders" ON public.orders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_orders_user ON public.orders (user_id);
CREATE INDEX idx_orders_status ON public.orders (status);
CREATE INDEX idx_orders_user_created ON public.orders (user_id, created_at DESC);

-- ---------- TRADES ----------
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES public.strategies(id) ON DELETE SET NULL,
  position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  side public.order_side NOT NULL DEFAULT 'SELL',
  entry_price NUMERIC,
  exit_price NUMERIC,
  quantity NUMERIC,
  invested_amount NUMERIC,
  exit_value NUMERIC,
  realized_pnl NUMERIC,
  realized_pnl_percent NUMERIC,
  fees NUMERIC NOT NULL DEFAULT 0,
  slippage NUMERIC,
  execution_provider public.execution_provider NOT NULL DEFAULT 'PAPER',
  external_transaction_hash TEXT,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  close_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trades" ON public.trades FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_trades_user ON public.trades (user_id);
CREATE INDEX idx_trades_user_closed ON public.trades (user_id, closed_at DESC);

-- ---------- RISK EVENTS ----------
CREATE TABLE public.risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES public.strategies(id) ON DELETE SET NULL,
  event_type public.risk_event_type NOT NULL,
  severity public.risk_severity NOT NULL DEFAULT 'WARNING',
  message TEXT NOT NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_events TO authenticated;
GRANT ALL ON public.risk_events TO service_role;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own risk events" ON public.risk_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_risk_events_user ON public.risk_events (user_id, created_at DESC);

-- ---------- BOT SESSIONS + STATE ----------
CREATE TABLE public.bot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES public.strategies(id) ON DELETE SET NULL,
  mode public.strategy_mode NOT NULL DEFAULT 'PAPER',
  status public.bot_state NOT NULL DEFAULT 'STARTING',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  trades_count INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  losing_trades INTEGER NOT NULL DEFAULT 0,
  realized_pnl NUMERIC NOT NULL DEFAULT 0,
  max_drawdown NUMERIC NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_sessions TO authenticated;
GRANT ALL ON public.bot_sessions TO service_role;
ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bot sessions" ON public.bot_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER bot_sessions_touch BEFORE UPDATE ON public.bot_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_bot_sessions_user ON public.bot_sessions (user_id, started_at DESC);

CREATE TABLE public.bot_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  state public.bot_state NOT NULL DEFAULT 'OFFLINE',
  strategy_id UUID REFERENCES public.strategies(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.bot_sessions(id) ON DELETE SET NULL,
  mode public.strategy_mode NOT NULL DEFAULT 'PAPER',
  last_error TEXT,
  killed_at TIMESTAMPTZ,
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_status TO authenticated;
GRANT ALL ON public.bot_status TO service_role;
ALTER TABLE public.bot_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bot status" ON public.bot_status FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER bot_status_touch BEFORE UPDATE ON public.bot_status FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- PORTFOLIO SNAPSHOTS ----------
CREATE TABLE public.portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id UUID REFERENCES public.bot_sessions(id) ON DELETE SET NULL,
  total_balance NUMERIC,
  available_balance NUMERIC,
  invested_amount NUMERIC,
  unrealized_pnl NUMERIC,
  realized_pnl NUMERIC,
  total_exposure NUMERIC,
  open_positions INTEGER,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_snapshots TO authenticated;
GRANT ALL ON public.portfolio_snapshots TO service_role;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own snapshots" ON public.portfolio_snapshots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_snapshots_user_time ON public.portfolio_snapshots (user_id, timestamp DESC);

-- ---------- SYSTEM LOGS ----------
CREATE TABLE public.system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  level public.log_level NOT NULL DEFAULT 'INFO',
  component TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own logs select" ON public.system_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own logs insert" ON public.system_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_system_logs_user_time ON public.system_logs (user_id, created_at DESC);

-- ---------- SIGNUP BOOTSTRAP ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_strategy_id UUID;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(COALESCE(NEW.email,'hunter'), '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.strategies (user_id, name, description, enabled, mode)
  VALUES (NEW.id, 'HUNTER 2X', 'Default paper strategy', true, 'PAPER')
  RETURNING id INTO new_strategy_id;

  INSERT INTO public.strategy_parameters (strategy_id) VALUES (new_strategy_id);
  INSERT INTO public.risk_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.bot_status (user_id, state, strategy_id) VALUES (NEW.id, 'OFFLINE', new_strategy_id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- REALTIME ----------
ALTER TABLE public.signals REPLICA IDENTITY FULL;
ALTER TABLE public.positions REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.trades REPLICA IDENTITY FULL;
ALTER TABLE public.bot_status REPLICA IDENTITY FULL;
ALTER TABLE public.risk_events REPLICA IDENTITY FULL;
ALTER TABLE public.tokens REPLICA IDENTITY FULL;
ALTER TABLE public.wallet_activity REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals, public.positions, public.orders, public.trades, public.bot_status, public.risk_events, public.tokens, public.wallet_activity;
