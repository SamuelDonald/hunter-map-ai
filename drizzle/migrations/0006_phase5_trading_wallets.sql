-- Phase 5: production trading wallets, deposits and controlled withdrawals.
-- Additive only. No private key, seed phrase or signing secret is ever stored.

ALTER TABLE public.execution_wallets
  ADD COLUMN IF NOT EXISTS custody_provider text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS provider_wallet_id text,
  ADD COLUMN IF NOT EXISTS reserved_capital numeric(38,18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_execution_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_execution_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_live_trade_completed boolean NOT NULL DEFAULT false;

ALTER TABLE public.execution_wallets DROP CONSTRAINT IF EXISTS execution_wallets_custody_provider_check;
ALTER TABLE public.execution_wallets
  ADD CONSTRAINT execution_wallets_custody_provider_check
  CHECK (custody_provider IN ('NONE','PRIVY','ENV_SIGNER','EXTERNAL'));

ALTER TABLE public.execution_wallets DROP CONSTRAINT IF EXISTS execution_wallets_reserved_capital_check;
ALTER TABLE public.execution_wallets
  ADD CONSTRAINT execution_wallets_reserved_capital_check CHECK (reserved_capital >= 0);

ALTER TABLE public.execution_wallets DROP CONSTRAINT IF EXISTS execution_wallets_status_check;
ALTER TABLE public.execution_wallets
  ADD CONSTRAINT execution_wallets_status_check CHECK (status IN (
    'NOT_CONFIGURED','PROVISIONING','CONFIGURED','READY','LOW_BALANCE','BLOCKED','ERROR','DISABLED'
  ));

ALTER TABLE public.execution_wallets DROP CONSTRAINT IF EXISTS execution_wallets_provisioned_address_check;
ALTER TABLE public.execution_wallets
  ADD CONSTRAINT execution_wallets_provisioned_address_check CHECK (
    status IN ('NOT_CONFIGURED','PROVISIONING','ERROR') OR public_address IS NOT NULL
  );

CREATE TABLE IF NOT EXISTS public.wallet_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.execution_wallets(id) ON DELETE CASCADE,
  cluster text NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  signature text NOT NULL,
  sender text,
  recipient text NOT NULL,
  asset text NOT NULL CHECK (asset IN ('SOL','USDC')),
  mint text,
  amount numeric(38,18) NOT NULL CHECK (amount > 0),
  slot bigint,
  block_time timestamptz,
  confirmation_status text NOT NULL DEFAULT 'confirmed'
    CHECK (confirmation_status IN ('processed','confirmed','finalized')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster, signature, asset)
);

CREATE INDEX IF NOT EXISTS idx_wallet_deposits_user ON public.wallet_deposits (user_id, created_at DESC);

GRANT SELECT ON public.wallet_deposits TO authenticated;
GRANT ALL ON public.wallet_deposits TO service_role;
ALTER TABLE public.wallet_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own deposits" ON public.wallet_deposits;
CREATE POLICY "Users read own deposits" ON public.wallet_deposits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.withdrawal_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain text NOT NULL DEFAULT 'solana',
  address text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  usable_after timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chain, address)
);

GRANT SELECT, INSERT, UPDATE ON public.withdrawal_addresses TO authenticated;
GRANT ALL ON public.withdrawal_addresses TO service_role;
ALTER TABLE public.withdrawal_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own withdrawal addresses" ON public.withdrawal_addresses;
CREATE POLICY "Users read own withdrawal addresses" ON public.withdrawal_addresses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users add own withdrawal addresses" ON public.withdrawal_addresses;
CREATE POLICY "Users add own withdrawal addresses" ON public.withdrawal_addresses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users revoke own withdrawal addresses" ON public.withdrawal_addresses;
CREATE POLICY "Users revoke own withdrawal addresses" ON public.withdrawal_addresses
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS withdrawal_addresses_touch ON public.withdrawal_addresses;
CREATE TRIGGER withdrawal_addresses_touch BEFORE UPDATE ON public.withdrawal_addresses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.wallet_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.execution_wallets(id) ON DELETE CASCADE,
  cluster text NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  initiated_by text NOT NULL DEFAULT 'USER' CHECK (initiated_by IN ('USER','OPERATOR')),
  destination text NOT NULL,
  asset text NOT NULL CHECK (asset IN ('SOL','USDC')),
  mint text,
  amount numeric(38,18) NOT NULL CHECK (amount > 0),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'REQUESTED','VALIDATING','APPROVED','REJECTED','SIGNING','SUBMITTED','CONFIRMED','FAILED'
  )),
  signature text,
  fee_lamports bigint,
  rejection_reason text,
  error_message text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_user ON public.wallet_withdrawals (user_id, created_at DESC);

GRANT SELECT ON public.wallet_withdrawals TO authenticated;
GRANT ALL ON public.wallet_withdrawals TO service_role;
ALTER TABLE public.wallet_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own withdrawals" ON public.wallet_withdrawals;
CREATE POLICY "Users read own withdrawals" ON public.wallet_withdrawals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS wallet_withdrawals_touch ON public.wallet_withdrawals;
CREATE TRIGGER wallet_withdrawals_touch BEFORE UPDATE ON public.wallet_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.connected_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain text NOT NULL DEFAULT 'solana',
  address text NOT NULL,
  wallet_name text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chain, address)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.connected_wallets TO authenticated;
GRANT ALL ON public.connected_wallets TO service_role;
ALTER TABLE public.connected_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own connected wallets" ON public.connected_wallets;
CREATE POLICY "Users manage own connected wallets" ON public.connected_wallets
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS connected_wallets_touch ON public.connected_wallets;
CREATE TRIGGER connected_wallets_touch BEFORE UPDATE ON public.connected_wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
