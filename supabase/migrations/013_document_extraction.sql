-- MPLADS Platform — P-04 Document AI: extraction and reconciliation
--
-- What this migration exists to fix
--
-- The `documents` table was (id, work_id, type, filename, storage_key, uploaded_at) and
-- nothing more. A Utilisation Certificate could be attached to a work and the platform
-- knew only that a file existed. Everything the document actually *says* — the certified
-- amount, the sanction reference, the completion date, the officer who signed it — was
-- discarded at the point of upload. The whole of that evidence was compressed into
-- `works.has_uc BOOLEAN`, read in exactly one place (`rule_engine.ts:152`, R-003), plus a
-- `works.uc_date` that is read by nothing at all.
--
-- So the record could say "UC filed" while the certificate itself certified a different
-- amount than the portal's expenditure figure, and no part of the platform would notice.
-- That mismatch is the finding. This migration gives it somewhere to live.
--
-- ## Two tables, not one, and why
--
-- `document_extractions` is *what the model read*. `document_findings` is *where the
-- document and the portal disagree*. They are separated because they have different
-- lifetimes and different trust: an extraction is a fact about one model call on one file
-- at one moment (and is superseded, never edited, when the file is re-read), while a
-- finding is a claim about the corpus that an officer will act on or dismiss.
--
-- Collapsing them would also force the wrong shape. One document produces zero or many
-- disagreements; a single wide row cannot hold "the amount differs by ₹2.4 L AND the
-- sanction reference does not match AND the certificate predates completion".
--
-- ## Extractions are append-only, latest-wins
--
-- A second read of the same file inserts a new row with `superseded_at` set on the old
-- one, rather than updating in place. A re-read happens when the model changes or the
-- prompt changes, and the previous verdict is the evidence for what the officer was
-- looking at when they made their decision. Overwriting it would make a dismissed finding
-- unexplainable after the fact — the officer's reason would reference numbers no longer
-- on record.
--
-- ## No confidence column on the extraction
--
-- Deliberate. A model's self-reported confidence for a whole document is a number with no
-- calibration behind it, and Doctrine 11 forbids rendering an unmeasured quantity as a
-- number. Per-field presence is recorded instead: a field is extracted or it is null, and
-- `fields_found` / `fields_expected` are countable facts. Confidence lives on the finding,
-- where it means something specific and bounded — see the comment there.

-- ─── Extraction: what the model read out of one file ────────────────────────

CREATE TABLE IF NOT EXISTS document_extractions (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- UTILISATION_CERTIFICATE | COMPLETION_CERTIFICATE | BILL | OTHER.
  -- Mirrors `DOCUMENT_KINDS` in backend/src/services/document_ai.ts. Not a Postgres enum:
  -- this codebase bans TS `enum` and the kind list will grow faster than migrations do.
  doc_kind          TEXT NOT NULL,

  -- The model that produced this reading, and how long it took. Recorded because an
  -- extraction is only interpretable against the model that made it.
  model             TEXT NOT NULL,
  latency_ms        INTEGER,

  -- Fields read off the document. Every one nullable: a certificate that does not state
  -- an amount must be recorded as not stating one, never as zero. A zero here would be
  -- read downstream as "the document certifies nil expenditure", which is a different
  -- and much more serious claim than "the amount could not be read".
  certified_amount      DOUBLE PRECISION,
  certificate_date      DATE,
  sanction_reference    TEXT,
  work_reference        TEXT,
  agency_named          TEXT,
  signatory_name        TEXT,
  signatory_designation TEXT,
  period_from           DATE,
  period_to             DATE,

  -- Countable substitute for a confidence score. `fields_expected` is the number of
  -- fields this doc_kind should carry; `fields_found` is how many were non-null. Their
  -- ratio is a measured completeness, not a model's opinion of itself.
  fields_found      INTEGER NOT NULL DEFAULT 0,
  fields_expected   INTEGER NOT NULL DEFAULT 0,

  -- Verbatim text the model transcribed, kept so a disputed field can be checked without
  -- a second model call and without re-downloading the file. Bounded in application code
  -- (`MAX_TRANSCRIPT_CHARS`) rather than by a column type, so the limit is visible where
  -- the truncation happens.
  raw_transcript    TEXT,

  -- Set when a later extraction of the same document replaces this one. NULL = current.
  superseded_at     TIMESTAMPTZ,

  -- Who ran the extraction. Not authentication — `actorOf` reads a client-supplied
  -- header. Recorded for the same reason the audit ledger records it: attribution the
  -- reader can weigh, clearly labelled as unverified.
  extracted_by      TEXT NOT NULL DEFAULT 'system',
  extracted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_extractions_document ON document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_extractions_work ON document_extractions(work_id);

-- One current extraction per document. A partial unique index rather than a plain one, so
-- history accumulates freely while the "which reading is live" question stays unambiguous.
-- Without this, two concurrent extractions of the same file both land as current and the
-- dossier picks one arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_extractions_current
  ON document_extractions(document_id)
  WHERE superseded_at IS NULL;

-- ─── Findings: where the document and the portal disagree ───────────────────

CREATE TABLE IF NOT EXISTS document_findings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  extraction_id     TEXT NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- Which comparison fired. Mirrors `CHECK_IDS` in services/document_reconcile.ts.
  -- Prefixed D- to keep it clearly distinct from the R-0xx rule catalogue: these are not
  -- catalogued rules, they carry no verification_status, and they must not be confused
  -- with rules on /rules or scored against `answer_key`.
  check_id          TEXT NOT NULL,

  -- LOW | MEDIUM | HIGH | CRITICAL, matching the alerts vocabulary so an officer reads
  -- one severity scale across the product.
  severity          TEXT NOT NULL DEFAULT 'MEDIUM',

  -- The disagreement in words, with both numbers in it. Written by the check, not by a
  -- model, so it cannot hedge or invent.
  detail            TEXT NOT NULL,

  -- The two sides, as strings, so a date mismatch and an amount mismatch can share the
  -- column. Rendered verbatim in the UI: the officer compares them, the platform does not
  -- summarise them away.
  document_value    TEXT,
  portal_value      TEXT,

  -- Only for checks with a genuine tolerance band — an amount within rounding is not a
  -- finding, and this records how far outside the band the value fell. NULL for checks
  -- where the comparison is exact (a reference either matches or does not), because a
  -- number there would be decoration.
  deviation_pct     DOUBLE PRECISION,

  -- Officer disposition. A finding is not an alert: it does not enter the district alert
  -- budget, it is not scored against `answer_key`, and it lives on the work's dossier.
  -- OPEN | ACCEPTED | DISMISSED.
  status            TEXT NOT NULL DEFAULT 'OPEN',
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_findings_work ON document_findings(work_id);
CREATE INDEX IF NOT EXISTS idx_doc_findings_extraction ON document_findings(extraction_id);
CREATE INDEX IF NOT EXISTS idx_doc_findings_status ON document_findings(status);

-- ─── documents: two columns the table should always have had ────────────────

-- Byte size and MIME type of the stored object. Needed to decide whether a document can
-- be sent to a vision model at all, and to say why not when it cannot, without a round
-- trip to storage on every dossier render.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS size_bytes INTEGER;

-- sha256 of the stored bytes. Two purposes: a re-upload of an identical file is
-- recognisable rather than duplicated, and the same certificate submitted against two
-- different works is detectable — the document analogue of photo reuse. Not unique: the
-- same file legitimately appears twice when a re-upload corrects metadata, and a UNIQUE
-- constraint would reject the correction instead of recording it.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(content_sha256);

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Enabled and given read policies to match `documents` in 002_rls_policies.sql. Note the
-- honest caveat recorded in docs/API_CONTRACT.md §11: backend/src/db.ts connects with the
-- service-role key, which bypasses every policy below. These exist so the tables are not
-- the one unprotected pair if a non-service-role client is ever introduced — they are not
-- in force for any request the API makes today.

ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_all_document_extractions" ON document_extractions;
CREATE POLICY "auth_read_all_document_extractions" ON document_extractions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "auth_read_all_document_findings" ON document_findings;
CREATE POLICY "auth_read_all_document_findings" ON document_findings
  FOR SELECT TO authenticated USING (TRUE);
