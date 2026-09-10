-- MPLADS Platform — P-06 Evidence Photo Verification: EXIF, vision, reconciliation
--
-- What this migration exists to fix
--
-- A work could be marked COMPLETED, its payment released, and the only "evidence" the
-- platform held was `works.evidence_image_key` — a bare storage key, read by exactly one
-- dormant detector (`photo_reuse.ts`, R-010) that never fires because nothing populates
-- the column. The photograph itself — where it was taken, what it shows, whether the
-- asset in frame matches the asset on the record — was never looked at. A photo of an
-- empty field could sit against a "completed community hall" and no part of the platform
-- would notice.
--
-- This migration gives site photographs somewhere to live and somewhere to be checked.
--
-- ## Three tables, and why
--
-- `work_photos` is *the file and the facts in its bytes*: the stored object plus the EXIF
-- GPS coordinate and capture time, which are deterministic properties of the file (like
-- its sha256 and size) and are parsed once at upload with no model involved.
--
-- `photo_analyses` is *what the vision model saw*: a blind reading of the image — the
-- asset category it appears to depict, the construction stage, an authenticity concern.
-- The model is never told what the work claims, so its reading cannot be anchored to the
-- record it is meant to check.
--
-- `photo_findings` is *where the photo and the portal disagree*. They are separated for
-- the same reasons P-04 separates extractions from findings (see migration 013): a file
-- fact, a model reading, and an actionable claim have different lifetimes and different
-- trust. An analysis is superseded (never edited) when the image is re-read; a finding is
-- something an officer acts on or dismisses.
--
-- ## EXIF coordinates and capture time are nullable — and null is never (0, 0)
--
-- A photo with its location stripped (every messaging app does this) must be recorded as
-- having no geotag, not as sitting at latitude 0, longitude 0. (0, 0) is a real point in
-- the Gulf of Guinea; writing it for "no geotag" would fabricate a location 8,000 km from
-- any Indian work and turn a missing fact into a false one. Doctrine 11 with teeth: a
-- field that could not be read is NULL, never a plausible-looking zero.
--
-- ## No confidence column on the analysis
--
-- Deliberate, exactly as in 013. A vision model's self-reported confidence for a whole
-- image is uncalibrated, and Doctrine 11 forbids rendering an unmeasured quantity as a
-- number. Per-dimension presence is recorded instead: an observation is made or it is
-- null, and `fields_found` / `fields_expected` are countable facts.

-- ─── The photograph: the file and the facts in its bytes ────────────────────

CREATE TABLE IF NOT EXISTS work_photos (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Optional human caption ("north elevation", "handpump, ward 4"). Nullable: most uploads
  -- carry none, and an absent caption is not an empty string.
  caption           TEXT,

  storage_key       TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,

  -- sha256 of the stored bytes. Byte-exact reuse of the same photograph against two
  -- different works is detectable here (the deterministic half of Doctrine 7's photo-reuse
  -- concern); perceptual near-duplicate reuse remains with R-010 and is still dormant.
  -- Not unique: a legitimate re-upload correcting a caption repeats the hash.
  content_sha256    TEXT NOT NULL,

  -- EXIF GPS, parsed from the file at upload by a dependency-free reader
  -- (backend/src/services/exif.ts). NULL = the image carried no geotag. NEVER 0 for
  -- "absent" — see the header. DOUBLE PRECISION holds a decimal degree; the reader has
  -- already applied the N/S and E/W hemisphere refs.
  exif_latitude     DOUBLE PRECISION,
  exif_longitude    DOUBLE PRECISION,

  -- EXIF DateTimeOriginal (when the shutter fired), NULL if the tag is absent. Distinct
  -- from uploaded_at (when the file reached us) — the gap between them is itself a signal a
  -- reviewer may care about.
  exif_taken_at     TIMESTAMPTZ,

  -- Who uploaded. Not authentication — `actorOf` reads a client-supplied header. Recorded
  -- for attribution the reader can weigh, clearly labelled as unverified.
  uploaded_by       TEXT NOT NULL DEFAULT 'system',
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_photos_work ON work_photos(work_id);
CREATE INDEX IF NOT EXISTS idx_work_photos_sha ON work_photos(content_sha256);

-- ─── Analysis: what the vision model saw in one image ───────────────────────

CREATE TABLE IF NOT EXISTS photo_analyses (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  photo_id          TEXT NOT NULL REFERENCES work_photos(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- The model that produced this reading, and how long it took. An analysis is only
  -- interpretable against the model that made it.
  model             TEXT NOT NULL,
  latency_ms        INTEGER,

  -- What the model saw, read blind (it is never told the work's claimed category/status).
  -- Every field nullable: an image the model cannot classify records null, never a guess.
  --   asset_category      — one of WORK_CATEGORIES (backend/src/types.ts), or null.
  --   asset_description   — free text describing what is visible.
  --   construction_stage  — NOT_STARTED | FOUNDATION | IN_PROGRESS | COMPLETED, or null.
  --   integrity_concern   — NONE | POSSIBLE | LIKELY, or null. A prompt for human review,
  --                         explicitly not a determination that the image is fake.
  --   integrity_note      — what the model observed that drove the concern.
  asset_category    TEXT,
  asset_description TEXT,
  construction_stage TEXT,
  integrity_concern TEXT,
  integrity_note    TEXT,

  -- Countable substitute for a confidence score. `fields_expected` is how many observation
  -- dimensions this pass should carry; `fields_found` is how many were non-null. Their
  -- ratio is a measured completeness, not the model's opinion of itself.
  fields_found      INTEGER NOT NULL DEFAULT 0,
  fields_expected   INTEGER NOT NULL DEFAULT 0,

  -- Verbatim text the model returned, kept so a disputed observation can be checked without
  -- a second model call. Bounded in application code (MAX_TRANSCRIPT_CHARS), not by column type.
  raw_response      TEXT,

  -- Set when a later analysis of the same photo replaces this one. NULL = current.
  superseded_at     TIMESTAMPTZ,

  analyzed_by       TEXT NOT NULL DEFAULT 'system',
  analyzed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_analyses_photo ON photo_analyses(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_analyses_work ON photo_analyses(work_id);

-- One current analysis per photo. Partial unique index so history accumulates freely while
-- "which reading is live" stays unambiguous — without it, two concurrent analyses of the
-- same image both land as current and the dossier picks one arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_analyses_current
  ON photo_analyses(photo_id)
  WHERE superseded_at IS NULL;

-- ─── Findings: where the photo and the portal disagree ──────────────────────

CREATE TABLE IF NOT EXISTS photo_findings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  analysis_id       TEXT NOT NULL REFERENCES photo_analyses(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Denormalised so a photo's findings can be pulled without joining through the analysis.
  photo_id          TEXT NOT NULL REFERENCES work_photos(id) ON DELETE CASCADE,

  -- Which comparison fired. Mirrors CHECK_IDS in services/photo_reconcile.ts. Prefixed V-
  -- (visual evidence) to stay distinct from both the R-0xx rule catalogue and the D-0xx
  -- document findings: these are not catalogued rules, carry no verification_status, and
  -- must not be scored against answer_key.
  check_id          TEXT NOT NULL,

  -- LOW | MEDIUM | HIGH | CRITICAL, matching the alerts vocabulary so one severity scale
  -- reads across the product. The integrity check (V-004) is capped at MEDIUM by code: a
  -- model's authenticity concern prompts a human look, it does not indict.
  severity          TEXT NOT NULL DEFAULT 'MEDIUM',

  -- The disagreement in words. Written by the check, not a model, so it cannot hedge or invent.
  detail            TEXT NOT NULL,

  -- The two sides as strings, so a location mismatch and a category mismatch share the
  -- column. `observed_value` is what the photo/model shows; `portal_value` is what the
  -- record claims. Rendered verbatim: the officer compares them.
  observed_value    TEXT,
  portal_value      TEXT,

  -- Only for checks with a genuine magnitude — the geotag check (V-001) stores the
  -- photo-to-work distance in METRES here. NULL for the categorical checks, where a number
  -- would be decoration. Named `deviation` (not `deviation_pct`): this is a distance, not a
  -- percentage, and calling it a percentage would misread in the UI.
  deviation         DOUBLE PRECISION,

  -- Officer disposition. OPEN | ACCEPTED | DISMISSED | SUPERSEDED. No CHECK constraint:
  -- SUPERSEDED is written by services/photos.ts when a re-analysis closes the prior
  -- reading's open findings, and a constraint here would have to be kept in lockstep with
  -- that code. A finding is NOT an alert: no alerts row, no district alert budget, no
  -- answer_key scoring; it lives on the work's dossier.
  status            TEXT NOT NULL DEFAULT 'OPEN',
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_findings_work ON photo_findings(work_id);
CREATE INDEX IF NOT EXISTS idx_photo_findings_analysis ON photo_findings(analysis_id);
CREATE INDEX IF NOT EXISTS idx_photo_findings_photo ON photo_findings(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_findings_status ON photo_findings(status);

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Enabled and given read policies to match `documents` and the P-04 tables. The honest
-- caveat from docs/API_CONTRACT.md §11 holds: backend/src/db.ts connects with the
-- service-role key, which bypasses every policy below. These exist so the tables are not
-- the one unprotected set if a non-service-role client is ever introduced — they are not
-- in force for any request the API makes today.

ALTER TABLE work_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_all_work_photos" ON work_photos;
CREATE POLICY "auth_read_all_work_photos" ON work_photos
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "auth_read_all_photo_analyses" ON photo_analyses;
CREATE POLICY "auth_read_all_photo_analyses" ON photo_analyses
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "auth_read_all_photo_findings" ON photo_findings;
CREATE POLICY "auth_read_all_photo_findings" ON photo_findings
  FOR SELECT TO authenticated USING (TRUE);
