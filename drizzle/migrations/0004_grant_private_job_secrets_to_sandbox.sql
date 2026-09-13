-- Allow the maintenance role used for operational scripts to manage job secrets.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA private TO sandbox_exec';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON private.job_secrets TO sandbox_exec';
  END IF;
END $$;
