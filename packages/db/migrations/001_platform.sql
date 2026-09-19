-- Proposed production schema. Review with consuming teammates before adoption.
-- The runnable demo uses SQLite; this migration is not automatically applied.
BEGIN;
CREATE TABLE workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_member (
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  auth_subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','member')),
  PRIMARY KEY (workspace_id, auth_subject)
);
CREATE TABLE store_profile (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK (version > 0),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  payload jsonb NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  UNIQUE (workspace_id, id, version)
);
CREATE TABLE report_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  profile_id uuid NOT NULL,
  profile_version integer NOT NULL,
  schema_version text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  provider_mode text NOT NULL CHECK (provider_mode IN ('demo','live')),
  status text NOT NULL CHECK (status IN ('queued','profiling','discovering','collecting','enriching','analyzing','synthesizing','completed','partial','failed','cancelled')),
  phase text NOT NULL,
  warning text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, profile_id, profile_version) REFERENCES store_profile(workspace_id, id, version)
);
CREATE TABLE report_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  lease_owner text,
  error_summary text,
  FOREIGN KEY (workspace_id, run_id) REFERENCES report_run(workspace_id, id),
  UNIQUE (run_id, kind, input_hash)
);
CREATE INDEX report_job_available ON report_job(available_at) WHERE status IN ('queued','leased');
CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  canonical_url text,
  title text NOT NULL,
  source_type text NOT NULL,
  exact_span text NOT NULL,
  content_hash text NOT NULL,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (workspace_id, run_id) REFERENCES report_run(workspace_id, id),
  UNIQUE (workspace_id, run_id, id),
  CHECK (synthetic OR canonical_url IS NOT NULL)
);
CREATE TABLE report_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('collaborator','competitor','discourse','swot','action')),
  payload jsonb NOT NULL,
  score numeric CHECK (score BETWEEN 0 AND 100),
  FOREIGN KEY (workspace_id, run_id) REFERENCES report_run(workspace_id, id),
  UNIQUE (workspace_id, run_id, id)
);
CREATE TABLE report_item_evidence (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  item_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  claim_key text NOT NULL,
  PRIMARY KEY (item_id, evidence_id, claim_key),
  FOREIGN KEY (workspace_id, run_id, item_id) REFERENCES report_item(workspace_id, run_id, id),
  FOREIGN KEY (workspace_id, run_id, evidence_id) REFERENCES evidence(workspace_id, run_id, id)
);
CREATE TABLE feedback (
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  item_id uuid NOT NULL,
  rating text NOT NULL CHECK (rating IN ('useful','not_useful')),
  reason_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, item_id),
  FOREIGN KEY (workspace_id, run_id, item_id) REFERENCES report_item(workspace_id, run_id, id)
);
CREATE TABLE saved_brand (
  workspace_id uuid NOT NULL,
  canonical_domain text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, canonical_domain),
  FOREIGN KEY (workspace_id) REFERENCES workspace(id)
);
-- API sets app.workspace_id with SET LOCAL inside an authenticated transaction.
-- Use a non-owner, non-superuser application role without BYPASSRLS.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['workspace_member','store_profile','report_run','report_job','evidence','report_item','report_item_evidence','feedback','saved_brand']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid) WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace USING (id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
COMMIT;
