-- MPLADS Insight & Integrity Platform
-- Initial Schema — 19 tables
-- PostgreSQL (Supabase)

-- ─── Enable extensions ──────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Drop existing tables in reverse dependency order ───────

DROP TABLE IF EXISTS field_sync_queue CASCADE;
DROP TABLE IF EXISTS calibration_snapshots CASCADE;
DROP TABLE IF EXISTS digest_history CASCADE;
DROP TABLE IF EXISTS rule_probation CASCADE;
DROP TABLE IF EXISTS review_actions CASCADE;
DROP TABLE IF EXISTS inspection_items CASCADE;
DROP TABLE IF EXISTS inspections CASCADE;
DROP TABLE IF EXISTS evaluation_runs CASCADE;
DROP TABLE IF EXISTS answer_key CASCADE;
DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS works CASCADE;
DROP TABLE IF EXISTS agencies CASCADE;
DROP TABLE IF EXISTS constituencies CASCADE;
DROP TABLE IF EXISTS districts CASCADE;
DROP TABLE IF EXISTS meta CASCADE;

-- ─── Districts ──────────────────────────────────────────────

CREATE TABLE districts (
  id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  name        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'National',
  code        TEXT NOT NULL UNIQUE,
  lgd_code    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Constituencies ─────────────────────────────────────────

CREATE TABLE constituencies (
  id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  district_id   TEXT NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  lgd_code      TEXT,
  mp_name       TEXT NOT NULL DEFAULT 'Hon. Member of Parliament',
  mp_party      TEXT NOT NULL DEFAULT 'Independent',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_constituencies_district ON constituencies(district_id);

-- ─── Agencies ───────────────────────────────────────────────

CREATE TABLE agencies (
  id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  district_id   TEXT REFERENCES districts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'Govt Dept',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agencies_district ON agencies(district_id);

-- ─── Works (~40 columns) ────────────────────────────────────

CREATE TABLE works (
  id                      TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  district_id             TEXT NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  constituency_id         TEXT REFERENCES constituencies(id) ON DELETE CASCADE,
  agency_id               TEXT REFERENCES agencies(id) ON DELETE SET NULL,
  mp_name                 TEXT NOT NULL DEFAULT 'Hon. Member of Parliament',
  esakshi_work_id         TEXT,

  -- Description
  title                   TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  category                TEXT NOT NULL,
  sub_category            TEXT,

  -- Location
  location_name           TEXT NOT NULL DEFAULT 'District HQ',
  latitude                DOUBLE PRECISION,
  longitude               DOUBLE PRECISION,
  ward                    TEXT,

  -- Financials (rupees as number)
  sanctioned_amount       DOUBLE PRECISION NOT NULL,
  released_amount         DOUBLE PRECISION NOT NULL DEFAULT 0,
  expenditure             DOUBLE PRECISION NOT NULL DEFAULT 0,
  first_installment       DOUBLE PRECISION,
  second_installment      DOUBLE PRECISION,

  -- Dates
  sanction_date           DATE,
  recommended_date        DATE,
  completion_target_date  DATE,
  actual_completion_date  DATE,
  last_payment_date       DATE,

  -- Status
  status                  TEXT NOT NULL DEFAULT 'NOT_STARTED',
  physical_progress_pct   DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Metadata
  has_uc                  BOOLEAN NOT NULL DEFAULT FALSE,
  uc_date                 DATE,
  phase                   INTEGER NOT NULL DEFAULT 1,
  is_scsp                 BOOLEAN NOT NULL DEFAULT FALSE,
  is_tsp                  BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_image_key      TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_works_district ON works(district_id);
CREATE INDEX idx_works_constituency ON works(constituency_id);
CREATE INDEX idx_works_status ON works(status);
CREATE INDEX idx_works_category ON works(category);

-- ─── Payments ───────────────────────────────────────────────

CREATE TABLE payments (
  id                  TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id             TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  amount              DOUBLE PRECISION NOT NULL,
  payment_date        DATE NOT NULL,
  installment_number  INTEGER NOT NULL DEFAULT 1,
  purpose             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_work ON payments(work_id);

-- ─── Documents ──────────────────────────────────────────────

CREATE TABLE documents (
  id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id       TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  filename      TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_work ON documents(work_id);

-- ─── Alerts ─────────────────────────────────────────────────

CREATE TABLE alerts (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id         TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  rule_id         TEXT NOT NULL,
  origin_id       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  severity_rank   INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN',
  reason_code     TEXT NOT NULL,
  evidence_text   TEXT NOT NULL DEFAULT '',
  confidence      DOUBLE PRECISION,
  in_budget       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Officer decisions (preserved across re-analysis)
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  dismiss_reason  TEXT,
  dismiss_note    TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(work_id, origin_id)
);

CREATE INDEX idx_alerts_work ON alerts(work_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_severity ON alerts(severity_rank ASC, created_at ASC);
CREATE INDEX idx_alerts_in_budget ON alerts(in_budget) WHERE status = 'OPEN';

-- ─── Audit Events (tamper-evident hash chain) ───────────────

CREATE TABLE audit_events (
  seq             BIGSERIAL PRIMARY KEY,
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  payload_hash    TEXT NOT NULL,
  prev_hash       TEXT NOT NULL,
  this_hash       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);

-- ─── Answer Key (demo/evaluation only) ──────────────────────

CREATE TABLE answer_key (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  anomaly_type      TEXT NOT NULL,
  description       TEXT NOT NULL,
  expected_rule_id  TEXT
);

CREATE INDEX idx_answer_key_work ON answer_key(work_id);

-- ─── Evaluation Runs ────────────────────────────────────────

CREATE TABLE evaluation_runs (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seed            INTEGER NOT NULL,
  total_works     INTEGER NOT NULL,
  total_planted   INTEGER NOT NULL,
  total_alerts    INTEGER NOT NULL,
  precision_val   DOUBLE PRECISION NOT NULL,
  recall_val      DOUBLE PRECISION NOT NULL,
  f1_val          DOUBLE PRECISION NOT NULL,
  per_type        JSONB NOT NULL DEFAULT '{}'
);

-- ─── Inspections ────────────────────────────────────────────

CREATE TABLE inspections (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  inspector_id      TEXT NOT NULL,
  inspector_name    TEXT NOT NULL,
  inspection_date   DATE NOT NULL,
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  overall_status    TEXT NOT NULL,
  notes             TEXT,
  photo_keys        JSONB NOT NULL DEFAULT '[]',
  synced            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspections_work ON inspections(work_id);

-- ─── Inspection Items ───────────────────────────────────────

CREATE TABLE inspection_items (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  inspection_id   TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_id    TEXT NOT NULL,
  checked         BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT
);

CREATE INDEX idx_inspection_items_inspection ON inspection_items(inspection_id);

-- ─── Review Actions ─────────────────────────────────────────

CREATE TABLE review_actions (
  id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  alert_id      TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  actor         TEXT NOT NULL,
  reason_code   TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_review_actions_alert ON review_actions(alert_id);

-- ─── Rule Probation ─────────────────────────────────────────

CREATE TABLE rule_probation (
  rule_id         TEXT PRIMARY KEY,
  total_reviews   INTEGER NOT NULL DEFAULT 0,
  dismissals      INTEGER NOT NULL DEFAULT 0,
  actionable_rate DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  suspended       BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_at    TIMESTAMPTZ,
  reinstated_at   TIMESTAMPTZ
);

-- ─── Digest History ─────────────────────────────────────────

CREATE TABLE digest_history (
  id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  district_id   TEXT NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  html          TEXT NOT NULL
);

CREATE INDEX idx_digest_district ON digest_history(district_id);

-- ─── Calibration Snapshots ──────────────────────────────────

CREATE TABLE calibration_snapshots (
  id                      TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  run_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  corpus_completion_rate  DOUBLE PRECISION NOT NULL,
  target_completion_rate  DOUBLE PRECISION NOT NULL DEFAULT 0.1924,
  deviation_pct           DOUBLE PRECISION NOT NULL,
  by_category             JSONB NOT NULL DEFAULT '{}',
  by_state                JSONB NOT NULL DEFAULT '{}'
);

-- ─── Field Sync Queue ───────────────────────────────────────

CREATE TABLE field_sync_queue (
  id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  payload       JSONB NOT NULL,
  synced        BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Meta table (singleton row) ─────────────────────────────

CREATE TABLE meta (
  id              TEXT PRIMARY KEY DEFAULT 'singleton',
  schema_version  TEXT NOT NULL DEFAULT '1.0.0',
  demo_mode       BOOLEAN NOT NULL DEFAULT TRUE,
  is_synthetic    BOOLEAN NOT NULL DEFAULT TRUE,
  last_ingest     TIMESTAMPTZ,
  seed            INTEGER DEFAULT 42
);

INSERT INTO meta (id, schema_version, demo_mode, is_synthetic, seed)
VALUES ('singleton', '1.0.0', TRUE, TRUE, 42)
ON CONFLICT (id) DO UPDATE SET
  schema_version = EXCLUDED.schema_version,
  demo_mode = EXCLUDED.demo_mode,
  is_synthetic = EXCLUDED.is_synthetic,
  seed = EXCLUDED.seed;

-- ─── raw_sql helper function (for complex queries) ──────────

CREATE OR REPLACE FUNCTION raw_sql(query TEXT, params TEXT DEFAULT '{}')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query)
  INTO result;
  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;
