-- Phase 4: Solana wallet + transaction infrastructure metadata.
-- Additive only. No private key material is ever stored in Postgres.

-- ---------------------------------------------------------------- wallets
CREATE TABLE IF NOT EXISTS public.execution_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain text NOT NULL DEFAULT 'solana',
  cluster text NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  purpose text NOT NULL CHECK (purpose IN ('EXECUTION','USER_CONNECTED')),
  public_address text,
  status text NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (status IN ('NOT_CONFIGURED','CONFIGURED','READY','LOW_BALANCE','BLOCKED','ERROR')),
  sol_balance numeric(38,18),
  min_sol_reserve numeric(38,18) NOT NULL DEFAULT 0.05 CHECK (min_sol_reserve >= 0),
  transaction_count integer NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, purpose, cluster)
);

GRANT SELECT ON public.execution_wallets TO authenticated;
GRANT ALL ON public.execution_wallets TO service_role;
ALTER TABLE public.execution_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own execution wallet metadata"
  ON public.execution_wallets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER execution_wallets_touch BEFORE UPDATE ON public.execution_wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------ transactions
CREATE TABLE IF NOT EXISTS public.solana_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  position_id uuid REFERENCES public.positions(id) ON DELETE SET NULL,
  token_id uuid REFERENCES public.tokens(id) ON DELETE SET NULL,
  execution_provider text NOT NULL,
  cluster text NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  purpose text NOT NULL DEFAULT 'INFRASTRUCTURE_TEST',
  idempotency_key text NOT NULL UNIQUE,
  signature text,
  blockhash text,
  slot bigint,
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','VALIDATED','BUILT','SIMULATED','SIGNED','SUBMITTED','CONFIRMING','CONFIRMED','FINALIZED','FAILED','SUBMITTED_UNKNOWN','REJECTED')),
  confirmation_level text CHECK (confirmation_level IN ('processed','confirmed','finalized')),
  fee_lamports bigint,
  compute_units_consumed bigint,
  simulation jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_status text NOT NULL DEFAULT 'PENDING'
    CHECK (reconciliation_status IN ('PENDING','RECONCILED','MISMATCH','UNRECONCILABLE','NOT_APPLICABLE')),
  reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS solana_transactions_cluster_signature_unique
  ON public.solana_transactions (cluster, signature) WHERE signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_solana_transactions_user_created
  ON public.solana_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solana_transactions_order ON public.solana_transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_solana_transactions_open
  ON public.solana_transactions (status) WHERE status IN ('SUBMITTED','CONFIRMING','SUBMITTED_UNKNOWN');

-- Audit records: readable by their owner, never writable or deletable by users.
GRANT SELECT ON public.solana_transactions TO authenticated;
GRANT ALL ON public.solana_transactions TO service_role;
ALTER TABLE public.solana_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own solana transactions"
  ON public.solana_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER solana_transactions_touch BEFORE UPDATE ON public.solana_transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -------------------------------------------------------- execution controls
-- Server-side emergency block, separate from the strategy kill switch.
CREATE TABLE IF NOT EXISTS public.execution_controls (
  id text PRIMARY KEY DEFAULT 'GLOBAL',
  emergency_block text NOT NULL DEFAULT 'ENABLED' CHECK (emergency_block IN ('ENABLED','DISABLED')),
  live_execution_enabled boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.execution_controls (id, emergency_block, live_execution_enabled, note)
VALUES ('GLOBAL', 'ENABLED', false, 'Phase 4: emergency block engaged, live execution disabled')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.execution_controls TO authenticated;
GRANT ALL ON public.execution_controls TO service_role;
ALTER TABLE public.execution_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read execution controls"
  ON public.execution_controls FOR SELECT TO authenticated USING (true);

CREATE TRIGGER execution_controls_touch BEFORE UPDATE ON public.execution_controls
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- --------------------------------------------------------------- risk config
ALTER TABLE public.risk_settings
  ADD COLUMN IF NOT EXISTS min_sol_reserve numeric(38,18) NOT NULL DEFAULT 0.05;
ALTER TABLE public.risk_settings
  DROP CONSTRAINT IF EXISTS risk_settings_min_sol_reserve_check;
ALTER TABLE public.risk_settings
  ADD CONSTRAINT risk_settings_min_sol_reserve_check CHECK (min_sol_reserve >= 0);