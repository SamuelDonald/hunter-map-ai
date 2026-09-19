-- Continuous HUNTER RADAR infrastructure (additive only).

CREATE TABLE public.radar_state (
  id text PRIMARY KEY DEFAULT 'GLOBAL',
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'IDLE',
  last_scan_started_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  next_scan_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz,
  scan_count bigint NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  retry_backoff_seconds integer NOT NULL DEFAULT 0,
  interval_seconds integer NOT NULL DEFAULT 20,
  last_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_state_singleton CHECK (id = 'GLOBAL'),
  CONSTRAINT radar_state_status CHECK (status IN ('IDLE','SCANNING','PAUSED','ERROR')),
  CONSTRAINT radar_state_interval CHECK (interval_seconds >= 5 AND interval_seconds <= 3600),
  CONSTRAINT radar_state_backoff CHECK (retry_backoff_seconds >= 0)
);

GRANT SELECT ON public.radar_state TO authenticated;
GRANT ALL ON public.radar_state TO service_role;
ALTER TABLE public.radar_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read radar state"
  ON public.radar_state FOR SELECT TO authenticated USING (true);

CREATE TRIGGER radar_state_touch BEFORE UPDATE ON public.radar_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.radar_state (id) VALUES ('GLOBAL') ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid REFERENCES public.tokens(id) ON DELETE CASCADE,
  chain text NOT NULL DEFAULT 'sol',
  address text NOT NULL,
  symbol text,
  discovery_source text NOT NULL,
  status text NOT NULL DEFAULT 'DISCOVERED',
  analysis_state text NOT NULL DEFAULT 'PENDING',
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_refresh_at timestamptz,
  last_evaluated_at timestamptz,
  next_evaluation_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  hunter_score numeric(6,3),
  smart_money_score numeric(6,3),
  price numeric(38,18),
  liquidity numeric(38,18),
  volume_24h numeric(38,18),
  rejection_reason text,
  evaluation_count integer NOT NULL DEFAULT 0,
  refresh_count integer NOT NULL DEFAULT 0,
  data_fingerprint text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunities_unique_token UNIQUE (chain, address),
  CONSTRAINT opportunities_status_check CHECK (status IN (
    'DISCOVERED','FILTERING','QUALIFIED','ANALYZING','READY','REJECTED','STALE','EXPIRED','TRADED','COOLDOWN')),
  CONSTRAINT opportunities_analysis_state_check CHECK (analysis_state IN (
    'PENDING','IN_PROGRESS','COMPLETE','FAILED')),
  CONSTRAINT opportunities_counts CHECK (evaluation_count >= 0 AND refresh_count >= 0)
);

GRANT SELECT ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read opportunities"
  ON public.opportunities FOR SELECT TO authenticated USING (true);

CREATE TRIGGER opportunities_touch BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX opportunities_status_next_eval_idx ON public.opportunities (status, next_evaluation_at);
CREATE INDEX opportunities_score_idx ON public.opportunities (hunter_score DESC NULLS LAST);
CREATE INDEX opportunities_refresh_idx ON public.opportunities (last_refresh_at DESC NULLS LAST);