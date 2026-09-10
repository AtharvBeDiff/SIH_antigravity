-- DRISHTI — P-10: what the inspector found, against what the record claims
--
-- ## What was missing
--
-- The platform already stored field inspections (`inspections`, `inspection_items`) and
-- already stored site photographs with their EXIF facts (`work_photos`, migration 014).
-- Nothing compared them. An inspector could stand at a site, record WORK_NOT_STARTED, sync
-- it, and the work would go on reading COMPLETED on every dossier and every list in the
-- product — because the inspection was filed beside the record rather than checked against
-- it. The two most direct pieces of ground truth the platform holds were inert.
--
-- This migration gives that comparison somewhere to live.
--
-- ## Two tables, and why
--
-- `inspection_comparisons` is *the run*: which inspection was compared, what photographic
-- corpus it had to work with, and which I-checks were able to run. One row per comparison,
-- superseded rather than edited.
--
-- `inspection_findings` is *where the inspector and the record disagree*. Separated from the
-- run for the same reason 013 and 014 separate readings from findings: a run is a fact about
-- what the platform did, a finding is something an officer accepts or dismisses, and they
-- have different lifetimes. Re-running a comparison supersedes the run; it must not silently
-- erase a decision an officer already made.
--
-- ## A comparison, not a reading — no model, no credential
--
-- Unlike its two siblings there is no uploaded file and no model call here. Every I-check is
-- a distance, a date subtraction, or an equality over values already on record. That is why
-- there is no `model`, no `latency_ms`, no `raw_response` and no `fields_found` column: there
-- is no reading to describe, and inventing those columns would imply a model was consulted.
--
-- ## Findings here are not alerts
--
-- Same discipline as D-0xx and V-0xx, stated again because it is the easiest thing to erode:
-- an I-finding mints no `alerts` row, does not enter a district's alert budget, carries no
-- `verification_status`, and is never scored against `answer_key`. An inspector disagreeing
-- with the record is a prompt for a human to look, not a platform verdict about a work.
-- Accepting one records the officer's judgement and changes no `works` column — the
-- correction to the record belongs in e-SAKSHI.
--
-- ## The record side is named by column, never by person
--
-- The comparison columns below are `record_value` and `record_source`, not `agency_value`.
-- No column anywhere records who entered a work's status; `uploaded_by` on a photo is an
-- unauthenticated header string (see 014). Naming an author for the record side would be a
-- fabrication the schema cannot support, so the finding names the column it compared against
-- and stops there.

-- ─── The run: one comparison of one inspection ──────────────────────────────

CREATE TABLE IF NOT EXISTS inspection_comparisons (
  id                    TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  inspection_id         TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,

  -- Denormalised so a work's comparisons can be pulled without joining through inspections.
  work_id               TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- The photographic corpus this comparison had. Three counts rather than one, because "no
  -- photos at all" and "photos, none of them geotagged" fail different checks and an officer
  -- reading a clean result deserves to know which. Counted at comparison time, never inferred
  -- back out of checks_run.
  photos_on_record      INTEGER NOT NULL DEFAULT 0,
  photos_with_geotag    INTEGER NOT NULL DEFAULT 0,
  photos_with_timestamp INTEGER NOT NULL DEFAULT 0,

  -- Which I-checks were able to run. Deliberately no DEFAULT, for the reason set out at
  -- length in migration 016: `DEFAULT '[]'` would assert that zero checks ran on rows nobody
  -- measured. Three states, and the panel branches on all three — a non-empty array (these
  -- ran), `[]` (none could run, a real measured result), NULL (nothing was recorded). Unlike
  -- 016's columns, this one ships with its table, so a NULL here is not an unapplied
  -- migration: it is a row written by something other than compareInspection, which always
  -- sets it — a backfill, a data repair. Nullable so that row cannot lie about coverage.
  --
  -- This is the column that separates "four checks ran and the inspection agrees with the
  -- record" from "nothing could be compared". Both render as zero findings; they mean
  -- opposite things.
  checks_run            JSONB,

  -- Set when a later comparison of the same inspection replaces this one. NULL = current.
  -- Superseded runs are kept because they are the evidence for what an officer saw when they
  -- accepted or dismissed a finding.
  superseded_at         TIMESTAMPTZ,

  -- Not authentication — `actorOf` reads a client-supplied header (see 014).
  compared_by           TEXT NOT NULL DEFAULT 'system',
  compared_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_comparisons_inspection
  ON inspection_comparisons(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_comparisons_work
  ON inspection_comparisons(work_id);

-- One current comparison per inspection. Partial unique index, matching photo_analyses: the
-- history accumulates freely while "which run is live" stays unambiguous. This is why
-- services/inspection_compare.ts stamps superseded_at on the previous row *before* inserting
-- the new one — inserting first violates this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_comparisons_current
  ON inspection_comparisons(inspection_id)
  WHERE superseded_at IS NULL;

COMMENT ON COLUMN inspection_comparisons.checks_run IS
  'I-check ids that were able to run against this inspection. [] = none could run, a measured result. NULL = nothing was recorded, which is not the same as nothing running; compareInspection always writes this column, so a NULL row came from a backfill or a data repair. Never inferred from the photo counts: I-002 compares the inspector''s verdict against the work status and runs with no photographs at all.';

-- ─── Findings: where the inspector and the record disagree ──────────────────

CREATE TABLE IF NOT EXISTS inspection_findings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  comparison_id     TEXT NOT NULL REFERENCES inspection_comparisons(id) ON DELETE CASCADE,

  -- Denormalised, as on the comparison, so a work's or an inspection's findings can be
  -- pulled without a join.
  inspection_id     TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- The photograph a finding keyed on, so an officer can open the exact image the measurement
  -- was taken from. I-001 (distance to its geotag) and I-003 (gap to its capture time) both set
  -- it; I-002 and I-004 compare against columns on `works` and leave it NULL.
  --
  -- ON DELETE SET NULL, not CASCADE: deleting a photograph must not delete the record that a
  -- discrepancy was found and reviewed. The finding survives with its detail and its stored
  -- distance intact, minus the link — which is the honest state, since the image really is
  -- gone.
  photo_id          TEXT REFERENCES work_photos(id) ON DELETE SET NULL,

  -- Which comparison fired. Mirrors CHECK_IDS in services/inspection_reconcile.ts. Prefixed
  -- I- (inspection) to stay distinct from the R-0xx rule catalogue, the D-0xx document
  -- findings and the V-0xx photo findings: these are not catalogued rules, carry no
  -- verification_status, and must not be scored against answer_key.
  check_id          TEXT NOT NULL,

  -- LOW | MEDIUM | HIGH | CRITICAL, matching the alerts vocabulary so one severity scale
  -- reads across the product.
  severity          TEXT NOT NULL DEFAULT 'MEDIUM',

  -- The disagreement in words. Written by the check, not a model, so it cannot hedge or invent.
  detail            TEXT NOT NULL,

  -- The two sides as strings, so a distance mismatch and a status mismatch share the columns.
  -- `observed_value` is what the inspector recorded; `record_value` is what the platform
  -- holds, and `record_source` names the column it was read from — see the header for why the
  -- record side is never attributed to a person.
  observed_value    TEXT,
  record_value      TEXT,
  record_source     TEXT,

  -- Only for checks with a genuine magnitude. NULL for the categorical check (I-002), where a
  -- number would be decoration.
  deviation         DOUBLE PRECISION,

  -- METRES or DAYS. Without this column a distance (I-001, I-004) and a lag in days (I-003)
  -- share one numeric column and cannot be told apart — a panel would have to guess from the
  -- check id, and would render "412 metres" as "412 days" the moment a check id moved.
  -- Migration 014 needed no such column because every V-check deviation was a distance.
  deviation_unit    TEXT,

  -- Officer disposition. OPEN | ACCEPTED | DISMISSED | SUPERSEDED. No CHECK constraint,
  -- matching photo_findings: SUPERSEDED is written by services/inspection_compare.ts when a
  -- re-comparison closes the previous run's open findings, and a constraint here would have to
  -- be kept in lockstep with that code.
  --
  -- There is no path back to OPEN. The ledger records the decision that was made; reopening
  -- would leave two contradictory entries with no way to tell which is current.
  status            TEXT NOT NULL DEFAULT 'OPEN',
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,

  -- Holds the note on an acceptance and the required reason on a dismissal. A dismissal with
  -- no stated reason is indistinguishable from a queue being cleared, and dismissals are the
  -- only evidence a check produces noise — I-001 is expected to be dismissed on large or
  -- linear sites, and that record is how anyone would know to widen its tolerance.
  review_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_findings_comparison
  ON inspection_findings(comparison_id);
CREATE INDEX IF NOT EXISTS idx_inspection_findings_inspection
  ON inspection_findings(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_findings_work
  ON inspection_findings(work_id);
CREATE INDEX IF NOT EXISTS idx_inspection_findings_status
  ON inspection_findings(status);

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Enabled and given read policies to match the P-04 and P-06 tables. The honest caveat from
-- docs/API_CONTRACT.md §11 holds: backend/src/db.ts connects with the service-role key, which
-- bypasses every policy below. These exist so these tables are not the one unprotected set if
-- a non-service-role client is ever introduced — they are not in force for any request the API
-- makes today.

ALTER TABLE inspection_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_all_inspection_comparisons" ON inspection_comparisons;
CREATE POLICY "auth_read_all_inspection_comparisons" ON inspection_comparisons
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "auth_read_all_inspection_findings" ON inspection_findings;
CREATE POLICY "auth_read_all_inspection_findings" ON inspection_findings
  FOR SELECT TO authenticated USING (TRUE);
