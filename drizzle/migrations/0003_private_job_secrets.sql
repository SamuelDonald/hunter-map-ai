-- Storage for the scheduler's own callback credential.
-- Private schema: not exposed through the Data API, no client access.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private.job_secrets (
  name text PRIMARY KEY,
  secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON private.job_secrets FROM anon, authenticated;
GRANT ALL ON private.job_secrets TO service_role;
ALTER TABLE private.job_secrets ENABLE ROW LEVEL SECURITY;
