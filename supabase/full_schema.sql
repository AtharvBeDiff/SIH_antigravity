-- MPLADS Insight & Integrity Platform
-- Initial Schema — 27 tables
-- PostgreSQL (Supabase)

-- ─── Enable extensions ──────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Drop existing tables in reverse dependency order ───────

DROP TABLE IF EXISTS field_sync_queue CASCADE;
DROP TABLE IF EXISTS calibration_snapshots CASCADE;
DROP TABLE IF EXISTS digest_history CASCADE;
DROP TABLE IF EXISTS rule_probation CASCADE;
DROP TABLE IF EXISTS review_actions CASCADE;
DROP TABLE IF EXISTS health_reports CASCADE;
DROP TABLE IF EXISTS inspection_findings CASCADE;
DROP TABLE IF EXISTS inspection_comparisons CASCADE;
DROP TABLE IF EXISTS inspection_items CASCADE;
DROP TABLE IF EXISTS inspections CASCADE;
DROP TABLE IF EXISTS evaluation_runs CASCADE;
DROP TABLE IF EXISTS answer_key CASCADE;
DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS photo_findings CASCADE;
DROP TABLE IF EXISTS photo_analyses CASCADE;
DROP TABLE IF EXISTS work_photos CASCADE;
DROP TABLE IF EXISTS document_findings CASCADE;
DROP TABLE IF EXISTS document_extractions CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS work_embeddings CASCADE;
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
  -- Doctrine 3 — no MP-level risk aggregation. These two columns are inert: no
  -- writer populates them and no read path may display, group, filter or rank by
  -- them. They stay declared only because 001_initial_schema.sql created them and
  -- this file has to keep matching a database that already has them. Do not seed
  -- them, and do not join them into any risk or ranking query.
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
  -- Doctrine 3 — inert, as on constituencies above. Accountability here attaches
  -- to agency_id and district_id, never to a named Member of Parliament.
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
  -- RETIRED — superseded by stage-keyed rows in `payments`. Kept for restore
  -- compatibility only; no writer, no reader. See the COMMENTs below the
  -- payments table.
  first_installment       DOUBLE PRECISION,
  second_installment      DOUBLE PRECISION,

  -- Dates
  sanction_date           DATE,
  recommended_date        DATE,
  completion_target_date  DATE,
  actual_completion_date  DATE,
  -- Derived from payments; maintained by services/payments.ts, read by R-007.
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
--
-- Stage-wise, not two-tranche. MPLADS payment is a sequence of vendor bills
-- against measured work, each sanctioned and released separately, so the history
-- is N rows and every row has to say what the money was for. The `stage` key is
-- that; `sequence_number` is where the payment sits in the work's history.
--
-- This supersedes works.first_installment / works.second_installment, which are
-- retired below: two columns cannot hold an N-stage history, carry no dates, and
-- cannot be reconciled against PFMS, which settles per payment.

CREATE TABLE payments (
  id                  TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id             TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  amount              DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  payment_date        DATE NOT NULL,

  -- What the money was for. MOBILISATION_ADVANCE is paid against a bank
  -- guarantee before any measurement, so it is money ahead of progress by
  -- design and R-002 excludes it; the other three all require a measured bill.
  stage               TEXT NOT NULL CHECK (
                        stage IN ('MOBILISATION_ADVANCE', 'RUNNING_BILL',
                                  'FINAL_BILL', 'RETENTION_RELEASE')
                      ),

  -- Position in this work's payment history, 1-based.
  sequence_number     INTEGER NOT NULL,

  -- Reconciliation key, one per payment.
  pfms_reference      TEXT,

  purpose             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_work ON payments(work_id);
CREATE INDEX idx_payments_date ON payments(payment_date);

-- Re-ingesting a payment file must update stage 3, not append a second copy of
-- it. This is what makes the paid total survive a repeated import.
CREATE UNIQUE INDEX idx_payments_work_sequence ON payments(work_id, sequence_number);

COMMENT ON COLUMN works.first_installment IS
  'RETIRED. Superseded by stage-keyed rows in payments. No writer, no reader; a two-column model cannot hold an N-stage history or reconcile against PFMS. Do not add readers.';
COMMENT ON COLUMN works.second_installment IS
  'RETIRED. Superseded by stage-keyed rows in payments. See first_installment.';
COMMENT ON COLUMN works.last_payment_date IS
  'Derived from payments — the max(payment_date) for the work. Maintained by services/payments.ts on every payment write; do not set it independently. Read by R-007 (stall detection).';

-- ─── Documents ──────────────────────────────────────────────

CREATE TABLE documents (
  id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id       TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  filename      TEXT NOT NULL,
  storage_key   TEXT NOT NULL,

  -- Byte size and MIME type of the stored object. Needed to decide whether a document can
  -- be sent to a vision model at all, and to say why not, without a round trip to storage
  -- on every dossier render.
  content_type  TEXT,
  size_bytes    INTEGER,

  -- sha256 of the stored bytes. A re-upload of an identical file is recognisable rather
  -- than duplicated, and the same certificate submitted against two different works is
  -- detectable — the document analogue of photo reuse. Not unique: a re-upload correcting
  -- metadata legitimately repeats the hash, and a UNIQUE constraint would reject it.
  content_sha256 TEXT,

  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_work ON documents(work_id);
CREATE INDEX idx_documents_sha ON documents(content_sha256);

-- ─── Document extractions ───────────────────────────────────
--
-- P-04 Document AI. `document_extractions` is *what the model read* off one file;
-- `document_findings` (below) is *where the document and the portal disagree*. Separated
-- because they have different lifetimes and trust: an extraction is a fact about one model
-- call on one file at one moment (superseded, never edited, when the file is re-read), while
-- a finding is a claim about the corpus an officer will act on or dismiss. See migration 013
-- for the full rationale. A finding is NOT an alert: no alerts row, no answer_key scoring.

CREATE TABLE document_extractions (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- UTILISATION_CERTIFICATE | COMPLETION_CERTIFICATE | BILL | OTHER. Mirrors DOCUMENT_KINDS
  -- in backend/src/services/document_ai.ts. Not a Postgres enum: this codebase bans TS
  -- `enum` and the kind list will grow faster than migrations do.
  doc_kind          TEXT NOT NULL,

  -- The model that produced this reading, and how long it took. An extraction is only
  -- interpretable against the model that made it.
  model             TEXT NOT NULL,
  latency_ms        INTEGER,

  -- Fields read off the document. Every one nullable: a certificate that does not state an
  -- amount must be recorded as not stating one, never as zero (Doctrine 11). A zero here
  -- would read downstream as "certifies nil expenditure" — a different, graver claim than
  -- "the amount could not be read".
  certified_amount      DOUBLE PRECISION,
  certificate_date      DATE,
  sanction_reference    TEXT,
  work_reference        TEXT,
  agency_named          TEXT,
  signatory_name        TEXT,
  signatory_designation TEXT,
  period_from           DATE,
  period_to             DATE,

  -- Countable substitute for a confidence score. `fields_expected` is how many fields this
  -- doc_kind should carry; `fields_found` is how many were non-null. Their ratio is a
  -- measured completeness, not a model's opinion of itself.
  fields_found      INTEGER NOT NULL DEFAULT 0,
  fields_expected   INTEGER NOT NULL DEFAULT 0,

  -- The D-checks that could run against this reading. A different fact from fields_found:
  -- sanction_reference, work_reference and signatory_name count toward fields_found but no
  -- D-check reads any of them, so a UC can read three of six fields and compare nothing.
  -- [] = none could run (measured). NULL = not recorded. No DEFAULT, deliberately — see
  -- migration 016.
  checks_run        JSONB,

  -- Verbatim text the model transcribed, kept so a disputed field can be checked without a
  -- second model call. Bounded in application code (MAX_TRANSCRIPT_CHARS), not by column type.
  raw_transcript    TEXT,

  -- Set when a later extraction of the same document replaces this one. NULL = current.
  superseded_at     TIMESTAMPTZ,

  -- Who ran the extraction. Not authentication — `actorOf` reads a client-supplied header.
  extracted_by      TEXT NOT NULL DEFAULT 'system',
  extracted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_extractions_document ON document_extractions(document_id);
CREATE INDEX idx_doc_extractions_work ON document_extractions(work_id);

-- One current extraction per document. Partial unique index so history accumulates freely
-- while "which reading is live" stays unambiguous — without it, two concurrent extractions
-- of the same file both land as current and the dossier picks one arbitrarily.
CREATE UNIQUE INDEX idx_doc_extractions_current
  ON document_extractions(document_id)
  WHERE superseded_at IS NULL;

-- ─── Document findings ──────────────────────────────────────

CREATE TABLE document_findings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  extraction_id     TEXT NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Which comparison fired. Mirrors CHECK_IDS in services/document_reconcile.ts. Prefixed
  -- D- to stay distinct from the R-0xx rule catalogue: these are not catalogued rules, carry
  -- no verification_status, and must not be scored against answer_key.
  check_id          TEXT NOT NULL,

  -- LOW | MEDIUM | HIGH | CRITICAL, matching the alerts vocabulary so one severity scale
  -- reads across the product.
  severity          TEXT NOT NULL DEFAULT 'MEDIUM',

  -- The disagreement in words, with both numbers in it. Written by the check, not a model,
  -- so it cannot hedge or invent.
  detail            TEXT NOT NULL,

  -- The two sides as strings, so a date mismatch and an amount mismatch share the column.
  -- Rendered verbatim: the officer compares them, the platform does not summarise them away.
  document_value    TEXT,
  portal_value      TEXT,

  -- Only for checks with a genuine tolerance band — how far outside the band the value fell.
  -- NULL for exact checks (a reference either matches or does not), where a number would be
  -- decoration.
  deviation_pct     DOUBLE PRECISION,

  -- Officer disposition. OPEN | ACCEPTED | DISMISSED | SUPERSEDED. No CHECK constraint:
  -- SUPERSEDED is written by services/documents.ts when a re-read closes the prior reading's
  -- open findings, and a constraint here would have to be kept in lockstep with that code.
  status            TEXT NOT NULL DEFAULT 'OPEN',
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_findings_work ON document_findings(work_id);
CREATE INDEX idx_doc_findings_extraction ON document_findings(extraction_id);
CREATE INDEX idx_doc_findings_status ON document_findings(status);

-- ─── Work photos (P-06): the file and the facts in its bytes ─
--
-- P-06 Evidence Photo Verification, the photo analogue of the document tables above.
-- `work_photos` is the stored file plus the deterministic facts in its bytes (sha256, size,
-- and the EXIF GPS coordinate and capture time, parsed once at upload with no model).
-- `photo_analyses` is a blind vision reading; `photo_findings` is where the photo and the
-- portal disagree. Same separation, and same reasons, as documents. See migration 014.
--
-- EXIF coordinates are nullable and null is NEVER (0, 0): a photo with its location stripped
-- has no geotag, not a position in the Gulf of Guinea. Doctrine 11 with teeth. No confidence
-- column, exactly as document_extractions: per-dimension presence (fields_found /
-- fields_expected) is recorded instead of an uncalibrated self-score.

CREATE TABLE work_photos (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Optional human caption ("north elevation", "handpump, ward 4"). Nullable: most uploads
  -- carry none, and an absent caption is not an empty string.
  caption           TEXT,

  storage_key       TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,

  -- sha256 of the stored bytes. Byte-exact reuse of the same photograph against two different
  -- works is detectable here (the deterministic half of Doctrine 7's photo-reuse concern);
  -- perceptual near-duplicate reuse remains with R-010 and is still dormant. Not unique: a
  -- legitimate re-upload correcting a caption repeats the hash.
  content_sha256    TEXT NOT NULL,

  -- EXIF GPS, parsed at upload by a dependency-free reader (backend/src/services/exif.ts).
  -- NULL = the image carried no geotag. NEVER 0 for "absent" — see the header. The reader has
  -- already applied the N/S and E/W hemisphere refs to produce a decimal degree.
  exif_latitude     DOUBLE PRECISION,
  exif_longitude    DOUBLE PRECISION,

  -- EXIF DateTimeOriginal (when the shutter fired), NULL if the tag is absent. Distinct from
  -- uploaded_at (when the file reached us); the gap between them is itself a signal.
  exif_taken_at     TIMESTAMPTZ,

  -- Who uploaded. Not authentication — `actorOf` reads a client-supplied header.
  uploaded_by       TEXT NOT NULL DEFAULT 'system',
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_work_photos_work ON work_photos(work_id);
CREATE INDEX idx_work_photos_sha ON work_photos(content_sha256);

-- ─── Photo analyses (P-06): what the vision model saw ───────

CREATE TABLE photo_analyses (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  photo_id          TEXT NOT NULL REFERENCES work_photos(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- The model that produced this reading, and how long it took.
  model             TEXT NOT NULL,
  latency_ms        INTEGER,

  -- What the model saw, read blind (never told the work's claimed category/status). Every
  -- field nullable: an image the model cannot classify records null, never a guess.
  --   asset_category      — one of WORK_CATEGORIES (backend/src/types.ts), or null.
  --   construction_stage  — NOT_STARTED | FOUNDATION | IN_PROGRESS | COMPLETED, or null.
  --   integrity_concern   — NONE | POSSIBLE | LIKELY, or null. A prompt for human review,
  --                         explicitly not a determination that the image is fake. (NONE is
  --                         folded to null in application code — coerceObservations.)
  asset_category    TEXT,
  asset_description TEXT,
  construction_stage TEXT,
  integrity_concern TEXT,
  integrity_note    TEXT,

  -- Countable substitute for a confidence score. The ratio of fields_found to fields_expected
  -- is a measured completeness, not the model's opinion of itself.
  fields_found      INTEGER NOT NULL DEFAULT 0,
  fields_expected   INTEGER NOT NULL DEFAULT 0,

  -- The V-checks that could run against this reading. A different fact from fields_found:
  -- asset_description counts toward fields_found but no check reads it, and V-001 compares
  -- the EXIF geotag with no reading at all. [] = none could run (measured). NULL = not
  -- recorded. No DEFAULT, deliberately — see migration 016.
  checks_run        JSONB,

  -- Verbatim model text, bounded in application code (MAX_RESPONSE_CHARS), not by column type.
  raw_response      TEXT,

  -- Set when a later analysis of the same photo replaces this one. NULL = current.
  superseded_at     TIMESTAMPTZ,

  analyzed_by       TEXT NOT NULL DEFAULT 'system',
  analyzed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_photo_analyses_photo ON photo_analyses(photo_id);
CREATE INDEX idx_photo_analyses_work ON photo_analyses(work_id);

-- One current analysis per photo. Partial unique index so history accumulates freely while
-- "which reading is live" stays unambiguous — without it, two concurrent analyses of the same
-- image both land as current and the dossier picks one arbitrarily.
CREATE UNIQUE INDEX idx_photo_analyses_current
  ON photo_analyses(photo_id)
  WHERE superseded_at IS NULL;

-- ─── Photo findings (P-06): where photo and portal disagree ─

CREATE TABLE photo_findings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  analysis_id       TEXT NOT NULL REFERENCES photo_analyses(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Denormalised so a photo's findings can be pulled without joining through the analysis.
  photo_id          TEXT NOT NULL REFERENCES work_photos(id) ON DELETE CASCADE,

  -- Which comparison fired. Mirrors CHECK_IDS in services/photo_reconcile.ts. Prefixed V-
  -- (visual evidence) to stay distinct from both the R-0xx rule catalogue and the D-0xx
  -- document findings: not catalogued rules, no verification_status, not scored against
  -- answer_key.
  check_id          TEXT NOT NULL,

  -- LOW | MEDIUM | HIGH | CRITICAL, matching the alerts vocabulary. The integrity check
  -- (V-004) is capped at MEDIUM by code: a model's authenticity concern prompts a look, it
  -- does not indict.
  severity          TEXT NOT NULL DEFAULT 'MEDIUM',

  -- The disagreement in words. Written by the check, not a model, so it cannot hedge or invent.
  detail            TEXT NOT NULL,

  -- The two sides as strings, so a location mismatch and a category mismatch share the column.
  -- observed_value is what the photo/model shows; portal_value is what the record claims.
  observed_value    TEXT,
  portal_value      TEXT,

  -- Only for checks with a genuine magnitude — the geotag check (V-001) stores the
  -- photo-to-work distance in METRES here. NULL for the categorical checks. Named `deviation`
  -- (not `deviation_pct`): this is a distance, not a percentage, and calling it a percentage
  -- would misread in the UI.
  deviation         DOUBLE PRECISION,

  -- Officer disposition. OPEN | ACCEPTED | DISMISSED | SUPERSEDED. No CHECK constraint:
  -- SUPERSEDED is written by services/photos.ts when a re-analysis closes the prior reading's
  -- open findings. A finding is NOT an alert: no alerts row, no district alert budget, no
  -- answer_key scoring; it lives on the work's dossier.
  status            TEXT NOT NULL DEFAULT 'OPEN',
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_photo_findings_work ON photo_findings(work_id);
CREATE INDEX idx_photo_findings_analysis ON photo_findings(analysis_id);
CREATE INDEX idx_photo_findings_photo ON photo_findings(photo_id);
CREATE INDEX idx_photo_findings_status ON photo_findings(status);

-- ─── Work embeddings (P-03): semantic duplicate candidates ──

-- Cached text embeddings so same-district works can be ranked by cosine similarity of meaning,
-- catching paraphrased duplicates that R-009's token-overlap title test misses. The vector is
-- JSONB, not pgvector: at district scale the comparison is one linear pass in application code
-- (util.ts:cosineSimilarity), needing no extension. Raises no alert and is not scored — it
-- ranks candidates for a human, beside R-009, not on top of it. Full rationale in
-- migrations/015_work_embeddings.sql.
CREATE TABLE work_embeddings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- sha256 of source_text. Half the cache key: an edited title changes the text, changes this
  -- hash, forces a recompute. Not unique — identical text across two works is itself a signal.
  content_sha256    TEXT NOT NULL,

  -- The exact text embedded (title — category — location), kept verbatim so a surprising
  -- similarity can be inspected. Built in one place: embeddingText() in work_embeddings.ts.
  source_text       TEXT NOT NULL,

  -- The model and task type that produced the vector. The other half of the cache key: a
  -- vector is only comparable against others from the same model, embedded the same way.
  model             TEXT NOT NULL,
  task_type         TEXT NOT NULL,

  -- Actual stored length of `vector`, read from the response — pinning GEMINI_EMBED_DIMS
  -- truncates (Matryoshka), and a change invalidates the cache like a model change does.
  dims              INTEGER NOT NULL,

  -- The embedding as a JSONB array of doubles. Cosine similarity is computed in app code.
  vector            JSONB NOT NULL,

  latency_ms        INTEGER,

  created_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set when a recompute (changed text, model, or dims) replaces this row. NULL = current.
  superseded_at     TIMESTAMPTZ
);

CREATE INDEX idx_work_embeddings_work ON work_embeddings(work_id);

-- One current vector per work. Partial unique index so history accumulates while "which vector
-- is live" stays unambiguous, and so the supersede-then-insert is enforced by the database.
CREATE UNIQUE INDEX idx_work_embeddings_current
  ON work_embeddings(work_id)
  WHERE superseded_at IS NULL;

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
  -- NULL when the metric's denominator is zero (empty answer_key, or no alerts).
  -- An undefined ratio is stored as unmeasured, never as a placeholder constant.
  precision_val   DOUBLE PRECISION,
  recall_val      DOUBLE PRECISION,
  f1_val          DOUBLE PRECISION,
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

-- ─── Inspection comparisons (P-10): the inspector against the record ────────
--
-- The two tables above stored what an inspector found. Nothing compared it to what the work
-- record claims — an inspector could record WORK_NOT_STARTED at a site and the work would go
-- on reading COMPLETED everywhere in the product. These two tables are where that comparison
-- lives. See `supabase/migrations/017_inspection_evidence.sql` for the full reasoning.
--
-- No model and no credential: every I-check is a distance, a date subtraction or an equality
-- over values already on record. Hence no `model`, `latency_ms`, `raw_response` or
-- `fields_found` here — there is no reading to describe, and those columns would imply one.
--
-- **These findings are not alerts.** Like D-0xx and V-0xx, an I-finding mints no `alerts` row,
-- enters no district alert budget, carries no `verification_status`, and is never scored
-- against `answer_key`. Accepting one changes no `works` column: the correction to the record
-- belongs in e-SAKSHI.

CREATE TABLE inspection_comparisons (
  id                    TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  inspection_id         TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,

  -- Denormalised so a work's comparisons can be pulled without joining through inspections.
  work_id               TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- The photographic corpus this run had. Three counts rather than one: "no photos at all" and
  -- "photos, none geotagged" fail different checks, and an officer reading a clean result
  -- deserves to know which. Counted at comparison time, never inferred back out of checks_run.
  photos_on_record      INTEGER NOT NULL DEFAULT 0,
  photos_with_geotag    INTEGER NOT NULL DEFAULT 0,
  photos_with_timestamp INTEGER NOT NULL DEFAULT 0,

  -- The I-checks that were able to run. [] = none could run (a measured result). NULL = not
  -- recorded, which is not the same as nothing running. No DEFAULT, deliberately — see
  -- migration 016. This column is what separates "four checks ran and the inspection agrees
  -- with the record" from "nothing could be compared"; both render as zero findings.
  checks_run            JSONB,

  -- Set when a later comparison of the same inspection replaces this one. NULL = current.
  -- Superseded runs are kept: they are the evidence for what an officer saw when they decided.
  superseded_at         TIMESTAMPTZ,

  -- Not authentication — `actorOf` reads a client-supplied header. See API_CONTRACT §11.
  compared_by           TEXT NOT NULL DEFAULT 'system',
  compared_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspection_comparisons_inspection ON inspection_comparisons(inspection_id);
CREATE INDEX idx_inspection_comparisons_work ON inspection_comparisons(work_id);

-- One current comparison per inspection, matching photo_analyses. This is why
-- services/inspection_compare.ts stamps superseded_at on the previous row *before* inserting
-- the new one — inserting first violates this index.
CREATE UNIQUE INDEX idx_inspection_comparisons_current
  ON inspection_comparisons(inspection_id)
  WHERE superseded_at IS NULL;

COMMENT ON COLUMN inspection_comparisons.checks_run IS
  'I-check ids that were able to run against this inspection. [] = none could run, a measured result. NULL = nothing was recorded, which is not the same as nothing running; compareInspection always writes this column, so a NULL row came from a backfill or a data repair. Never inferred from the photo counts: I-002 compares the inspector''s verdict against the work status and runs with no photographs at all.';

-- ─── Inspection findings: where the inspector and the record disagree ───────

CREATE TABLE inspection_findings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  comparison_id     TEXT NOT NULL REFERENCES inspection_comparisons(id) ON DELETE CASCADE,

  -- Denormalised, as on the comparison, so a work's findings need no join.
  inspection_id     TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- The photograph a finding keyed on, so an officer can open the exact image the measurement was
  -- taken from. I-001 (distance to its geotag) and I-003 (gap to its capture time) set it; I-002
  -- and I-004 compare against columns on `works`. ON DELETE SET NULL, not CASCADE: deleting a
  -- photograph must not delete the record that a discrepancy was found and reviewed.
  photo_id          TEXT REFERENCES work_photos(id) ON DELETE SET NULL,

  -- Mirrors CHECK_IDS in services/inspection_reconcile.ts. Prefixed I- to stay distinct from
  -- the R-0xx rule catalogue: these are not catalogued rules and are never scored.
  check_id          TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'MEDIUM',

  -- The disagreement in words, written by the check rather than a model, so it cannot hedge.
  detail            TEXT NOT NULL,

  -- The two sides as strings, so a distance mismatch and a status mismatch share the columns.
  -- `record_source` names the column the record side was read from — never a person: no column
  -- anywhere records who entered a work's status, so naming an author would be a fabrication.
  observed_value    TEXT,
  record_value      TEXT,
  record_source     TEXT,

  -- Only for checks with a genuine magnitude; NULL for the categorical check (I-002).
  deviation         DOUBLE PRECISION,

  -- METRES or DAYS. Without this column a distance (I-001, I-004) and a lag in days (I-003)
  -- share one numeric column and a panel would have to guess from the check id — rendering
  -- "412 metres" as "412 days" the moment a check id moved.
  deviation_unit    TEXT,

  -- OPEN | ACCEPTED | DISMISSED | SUPERSEDED. No CHECK constraint, matching photo_findings:
  -- SUPERSEDED is written by services/inspection_compare.ts. There is no path back to OPEN.
  status            TEXT NOT NULL DEFAULT 'OPEN',
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,

  -- The note on an acceptance and the required reason on a dismissal. Dismissals are the only
  -- evidence a check produces noise — I-001 is expected to be dismissed on large or linear
  -- sites, and that record is how anyone would know to widen its tolerance.
  review_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspection_findings_comparison ON inspection_findings(comparison_id);
CREATE INDEX idx_inspection_findings_inspection ON inspection_findings(inspection_id);
CREATE INDEX idx_inspection_findings_work ON inspection_findings(work_id);
CREATE INDEX idx_inspection_findings_status ON inspection_findings(status);

-- ─── Health Reports ─────────────────────────────────────────
--
-- The mandatory 10-day progress check-in. This table was DROPped at the top of
-- this file and never created — 19 DROPs against 18 CREATEs — which is why
-- R-019 measured cadence from `works.updated_at` (a timestamp that means "this
-- row changed", reset by any write) and why `GET /api/health_reports` caught the
-- missing-table error and answered 200 with an empty list while the POST 500'd.
-- See `supabase/migrations/010_health_reports.sql`.

CREATE TABLE health_reports (
  id                 TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id            TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  reported_by        TEXT NOT NULL,
  report_date        DATE NOT NULL,
  progress_pct       DOUBLE PRECISION NOT NULL,
  evidence_image_key TEXT,
  remarks            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- R-019 reads the newest report per work.
CREATE INDEX idx_health_reports_work_date ON health_reports(work_id, report_date DESC);

-- One report per work per day: a retried submission updates that day's report
-- rather than appending a second copy, so the report count measures reporting
-- and not retry behaviour.
CREATE UNIQUE INDEX idx_health_reports_work_day ON health_reports(work_id, report_date);

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
  -- Nullable: an empty corpus has no completion rate, and 0/0 must be recorded as
  -- unmeasured rather than coerced to a number. Same reasoning as evaluation_runs.
  corpus_completion_rate           DOUBLE PRECISION,
  corpus_completion_rate_by_count  DOUBLE PRECISION,
  -- Two benchmarks, not one: 50.71% by value (₹3,387.38 Cr of ₹6,680.29 Cr) and
  -- 61.88% by count (69,061 of 1,11,600), per the Standing Committee figures for
  -- 1 Apr 2023 – 22 Jan 2026. They differ by over eleven points and are not
  -- interchangeable. Derivation lives in backend/src/services/calibration.ts.
  target_completion_rate           DOUBLE PRECISION NOT NULL DEFAULT 0.5071,
  target_completion_rate_by_count  DOUBLE PRECISION NOT NULL DEFAULT 0.6188,
  deviation_pct                    DOUBLE PRECISION,
  deviation_pct_by_count           DOUBLE PRECISION,
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

-- ─── raw_sql: removed, deliberately not replaced ────────────
--
-- This file used to define:
--
--   CREATE OR REPLACE FUNCTION raw_sql(query TEXT, params TEXT DEFAULT '{}')
--   RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$ ...
--     EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query)
--   $$;
--
-- `SECURITY DEFINER` plus `EXECUTE format('... (%s) ...', query)` is arbitrary SQL
-- as the function's owner. The `params` argument was never used — it was declared
-- and then ignored, so nothing about the shape was parameterised; the whole query
-- text was interpolated. Exposed through Supabase's RPC endpoint, it reaches
-- anything the owner can reach, RLS included, and one reachable caller is enough.
--
-- Nothing used it. `backend/src/db.ts` had an `exec()` wrapper that called it, and
-- no router, service or detector ever called `exec()`. So this was an unexercised
-- sink kept for a convenience that was never taken up — removed along with the
-- wrapper rather than left to be found later and used.
--
-- If a future query genuinely does not fit the Supabase query builder, add a named
-- function for that one query with its arguments as typed parameters. Do not
-- reintroduce a general SQL executor.
--
-- See migration 011 for the drop applied to existing databases.

-- MPLADS Platform — Row Level Security Policies
-- Service role bypasses RLS; these policies are for anon/user access.

-- Enable RLS on all tables
ALTER TABLE districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE constituencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_probation ENABLE ROW LEVEL SECURITY;
ALTER TABLE digest_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta ENABLE ROW LEVEL SECURITY;

-- Drop old policies to allow idempotent execution
DROP POLICY IF EXISTS "anon_read_districts" ON districts;
DROP POLICY IF EXISTS "anon_read_constituencies" ON constituencies;
DROP POLICY IF EXISTS "anon_read_works_public_fields" ON works;
DROP POLICY IF EXISTS "anon_read_meta" ON meta;
DROP POLICY IF EXISTS "anon_read_calibration" ON calibration_snapshots;

DROP POLICY IF EXISTS "auth_read_all_districts" ON districts;
DROP POLICY IF EXISTS "auth_read_all_constituencies" ON constituencies;
DROP POLICY IF EXISTS "auth_read_all_agencies" ON agencies;
DROP POLICY IF EXISTS "auth_read_all_works" ON works;
DROP POLICY IF EXISTS "auth_read_all_payments" ON payments;
DROP POLICY IF EXISTS "auth_read_all_documents" ON documents;
DROP POLICY IF EXISTS "auth_read_all_document_extractions" ON document_extractions;
DROP POLICY IF EXISTS "auth_read_all_document_findings" ON document_findings;
DROP POLICY IF EXISTS "auth_read_all_work_photos" ON work_photos;
DROP POLICY IF EXISTS "auth_read_all_photo_analyses" ON photo_analyses;
DROP POLICY IF EXISTS "auth_read_all_photo_findings" ON photo_findings;
DROP POLICY IF EXISTS "auth_read_all_work_embeddings" ON work_embeddings;
DROP POLICY IF EXISTS "auth_read_all_alerts" ON alerts;
DROP POLICY IF EXISTS "auth_read_all_audit" ON audit_events;
DROP POLICY IF EXISTS "auth_read_all_answer_key" ON answer_key;
DROP POLICY IF EXISTS "auth_read_all_evaluation" ON evaluation_runs;
DROP POLICY IF EXISTS "auth_read_all_inspections" ON inspections;
DROP POLICY IF EXISTS "auth_read_all_inspection_items" ON inspection_items;
DROP POLICY IF EXISTS "auth_read_all_inspection_comparisons" ON inspection_comparisons;
DROP POLICY IF EXISTS "auth_read_all_inspection_findings" ON inspection_findings;
DROP POLICY IF EXISTS "auth_read_all_health_reports" ON health_reports;
DROP POLICY IF EXISTS "auth_read_all_review_actions" ON review_actions;
DROP POLICY IF EXISTS "auth_read_all_rule_probation" ON rule_probation;
DROP POLICY IF EXISTS "auth_read_all_digests" ON digest_history;
DROP POLICY IF EXISTS "auth_read_all_calibration" ON calibration_snapshots;
DROP POLICY IF EXISTS "auth_read_all_meta" ON meta;
DROP POLICY IF EXISTS "auth_read_field_sync" ON field_sync_queue;
DROP POLICY IF EXISTS "auth_insert_inspections" ON inspections;
DROP POLICY IF EXISTS "auth_insert_inspection_items" ON inspection_items;

-- Public (anon) can only read safe tables
CREATE POLICY "anon_read_districts" ON districts
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_constituencies" ON constituencies
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_works_public_fields" ON works
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_meta" ON meta
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_calibration" ON calibration_snapshots
  FOR SELECT TO anon USING (true);

-- Authenticated users can read everything
CREATE POLICY "auth_read_all_districts" ON districts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_constituencies" ON constituencies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_agencies" ON agencies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_works" ON works
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_payments" ON payments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_documents" ON documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_document_extractions" ON document_extractions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_document_findings" ON document_findings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_work_photos" ON work_photos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_photo_analyses" ON photo_analyses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_photo_findings" ON photo_findings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_work_embeddings" ON work_embeddings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_alerts" ON alerts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_audit" ON audit_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_answer_key" ON answer_key
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_evaluation" ON evaluation_runs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_inspections" ON inspections
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_inspection_items" ON inspection_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_inspection_comparisons" ON inspection_comparisons
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_inspection_findings" ON inspection_findings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_health_reports" ON health_reports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_review_actions" ON review_actions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_rule_probation" ON rule_probation
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_digests" ON digest_history
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_calibration" ON calibration_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_meta" ON meta
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_field_sync" ON field_sync_queue
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can insert inspections (field PWA)
CREATE POLICY "auth_insert_inspections" ON inspections
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_insert_inspection_items" ON inspection_items
  FOR INSERT TO authenticated WITH CHECK (true);
-- MPLADS Platform — Storage Buckets

-- Evidence bucket for work photos/documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence',
  'evidence',
  FALSE,
  5242880,  -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Exports bucket for digest HTML exports
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exports',
  'exports',
  FALSE,
  10485760,  -- 10MB
  ARRAY['text/html', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "auth_read_evidence" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_evidence" ON storage.objects;

-- Service role has full access by default
-- Authenticated users can read evidence
CREATE POLICY "auth_read_evidence"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'evidence');

-- Authenticated users can upload to evidence (field inspections)
CREATE POLICY "auth_upload_evidence"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'evidence');
-- Auto-generated by data-gen/generate.ts
-- Seed: 12345

INSERT INTO districts (id, name, state, code, lgd_code) VALUES ('f47d851c-fd7f-4fa3-a4cd-acca7153c141', 'North District', 'Delhi', 'DIST_101', 'DIST_101') ON CONFLICT (code) DO NOTHING;
INSERT INTO districts (id, name, state, code, lgd_code) VALUES ('ae530ac0-9be0-4e9d-a448-b41d6e202c6b', 'South District', 'Delhi', 'DIST_102', 'DIST_102') ON CONFLICT (code) DO NOTHING;
INSERT INTO districts (id, name, state, code, lgd_code) VALUES ('615ffc40-9282-4e3c-acf2-df809ba9fcfe', 'East District', 'Delhi', 'DIST_103', 'DIST_103') ON CONFLICT (code) DO NOTHING;
INSERT INTO districts (id, name, state, code, lgd_code) VALUES ('7634f720-5464-45fd-a920-f0afb51960a9', 'West District', 'Delhi', 'DIST_104', 'DIST_104') ON CONFLICT (code) DO NOTHING;

INSERT INTO agencies (id, district_id, name, type) VALUES ('15949fdd-c6fd-4aed-af6d-470228a09e88', 'f47d851c-fd7f-4fa3-a4cd-acca7153c141', 'Public Works Department (PWD)', 'State PWD') ON CONFLICT (id) DO NOTHING;
INSERT INTO agencies (id, district_id, name, type) VALUES ('9a39f27a-52be-4ec9-ac22-80a4fff6ca62', 'f47d851c-fd7f-4fa3-a4cd-acca7153c141', 'Rural Development Agency (DRDA)', 'DRDA') ON CONFLICT (id) DO NOTHING;
INSERT INTO agencies (id, district_id, name, type) VALUES ('2b21680a-59b8-4042-a191-be0df781f352', 'f47d851c-fd7f-4fa3-a4cd-acca7153c141', 'Municipal Corporation', 'Urban Local Body') ON CONFLICT (id) DO NOTHING;
INSERT INTO agencies (id, district_id, name, type) VALUES ('70b017cc-a363-4a1d-a9aa-7ddac543813c', 'f47d851c-fd7f-4fa3-a4cd-acca7153c141', 'Irrigation & Flood Control Dept', 'Line Department') ON CONFLICT (id) DO NOTHING;

INSERT INTO constituencies (id, district_id, name, lgd_code) VALUES ('1eb11f9b-7c2f-4fee-a2dd-2e0ae58934e4', 'f47d851c-fd7f-4fa3-a4cd-acca7153c141', 'North Assembly', '201') ON CONFLICT (id) DO NOTHING;
INSERT INTO constituencies (id, district_id, name, lgd_code) VALUES ('b1f66ff5-89de-4d1b-aa01-bcb8e2d0c783', 'ae530ac0-9be0-4e9d-a448-b41d6e202c6b', 'South Assembly', '202') ON CONFLICT (id) DO NOTHING;
INSERT INTO constituencies (id, district_id, name, lgd_code) VALUES ('073b8704-0e8e-4495-a9fb-85cdfbe3c141', '615ffc40-9282-4e3c-acf2-df809ba9fcfe', 'East Assembly', '203') ON CONFLICT (id) DO NOTHING;
INSERT INTO constituencies (id, district_id, name, lgd_code) VALUES ('cbed8323-6795-419a-a24a-314a4bf6a54d', '7634f720-5464-45fd-a920-f0afb51960a9', 'West Assembly', '204') ON CONFLICT (id) DO NOTHING;

-- Works, payments, health reports and the answer key: none seeded here.
--
-- 200 works used to be embedded at this point, copied from a data-gen run. They were
-- stale in a way that could not be seen by reading them: they carried the statuses
-- 'PROPOSED' and 'APPROVED' and the categories 'ROADS' and 'WATER', none of which are
-- in WORK_STATUSES or WORK_CATEGORIES in backend/src/types.ts. No rule status gate, no
-- eligibility list and no benchmark cohort matches those values, so the rows loaded
-- cleanly, appeared in every count, and were invisible to the analysis.
--
-- Worse, README told the reader to apply this file and then supabase/seed.sql, which
-- inserts 2,000 works of its own. The result was a 2,200-work corpus, 200 of them
-- unanalysable, against a documented 2,000 — so /calibration compared published
-- benchmarks against a corpus that was not the one data-gen calibrated.
--
-- Schema is history; a corpus is current state. Load supabase/seed.sql for the corpus:
--   npm run generate -w data-gen && psql "$DATABASE_URL" -f supabase/seed.sql
--
-- The districts, agencies and constituencies above are kept deliberately. They are
-- reference data rather than corpus, seed.sql emits the same four of each with the same
-- UUIDs, and both sides upsert on the natural key — so applying both is idempotent and a
-- schema-only database still has somewhere to hang a work.

-- Alerts: none seeded.
--
-- Alerts are the output of the rule engine and detectors, not seed input. Run
-- POST /api/analyze after loading this file to populate the triage queue; each
-- alert then derives its rule, severity and evidence text from the rule that
-- fired. The 50 rows previously here paired a randomly drawn rule ID with a
-- randomly drawn work and severity and a single canned evidence string, and
-- none of those four rule IDs existed in backend/src/rules/mplads_rules.yaml —
-- so they rendered in the triage queue but could not be opened on /rules, put
-- on probation, or shown with a verification_status.
