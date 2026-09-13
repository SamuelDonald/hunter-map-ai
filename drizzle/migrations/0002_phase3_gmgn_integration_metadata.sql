-- Phase 3: provider integration health + scanner single-flight leases.
-- Additive only. No secrets are stored here.

CREATE TABLE IF NOT EXISTS public.provider_integrations (
  provider text PRIMARY KEY,
  status text NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (status IN ('NOT_CONFIGURED','CONNECTING','CONNECTED','DEGRADED','ERROR')),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  paused_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_integrations TO authenticated;
GRANT ALL ON public.provider_integrations TO service_role;
ALTER TABLE public.provider_integrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read provider health"
    ON public.provider_integrations FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS provider_integrations_touch ON public.provider_integrations;
CREATE TRIGGER provider_integrations_touch BEFORE UPDATE ON public.provider_integrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.provider_integrations (provider, status)
VALUES ('GMGN', 'NOT_CONFIGURED')
ON CONFLICT (provider) DO NOTHING;

-- Single-flight lease so overlapping scheduled scans never process in parallel.
CREATE TABLE IF NOT EXISTS public.job_leases (
  job_name text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  holder text,
  last_run_at timestamptz,
  last_result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.job_leases TO service_role;
ALTER TABLE public.job_leases ENABLE ROW LEVEL SECURITY;
-- No policies: server-side (service role) only.

DROP TRIGGER IF EXISTS job_leases_touch ON public.job_leases;
CREATE TRIGGER job_leases_touch BEFORE UPDATE ON public.job_leases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Atomic lease acquisition: returns true only for the caller that holds the lease.
CREATE OR REPLACE FUNCTION public.acquire_job_lease(_job_name text, _ttl_seconds integer, _holder text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE acquired boolean;
BEGIN
  INSERT INTO public.job_leases (job_name, locked_until, holder, last_run_at)
  VALUES (_job_name, now() + make_interval(secs => _ttl_seconds), _holder, now())
  ON CONFLICT (job_name) DO UPDATE
    SET locked_until = now() + make_interval(secs => _ttl_seconds),
        holder = _holder,
        last_run_at = now()
    WHERE public.job_leases.locked_until < now()
  RETURNING true INTO acquired;
  RETURN COALESCE(acquired, false);
END; $$;

REVOKE ALL ON FUNCTION public.acquire_job_lease(text, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.acquire_job_lease(text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_job_lease(_job_name text, _result jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.job_leases
  SET locked_until = now() - interval '1 second', last_result = _result
  WHERE job_name = _job_name;
$$;

REVOKE ALL ON FUNCTION public.release_job_lease(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.release_job_lease(text, jsonb) TO service_role;

-- Provider freshness tracking on intelligence tables.
ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS data_source text;
ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS last_smart_money_update timestamptz;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS data_source text;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS last_provider_sync timestamptz;

-- Idempotent wallet activity ingestion (same on-chain event must not duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS wallet_activity_unique_tx
  ON public.wallet_activity (wallet_id, transaction_hash, activity_type)
  WHERE transaction_hash IS NOT NULL;

-- Scan workload indexes.
CREATE INDEX IF NOT EXISTS idx_tokens_scan_candidates
  ON public.tokens (hunter_score DESC, last_market_update DESC)
  WHERE is_blacklisted = false;
