-- ═══════════════════════════════════════════════════════════════════════
-- 018 · works.esakshi_work_id becomes the ingest upsert key
-- ═══════════════════════════════════════════════════════════════════════
--
-- ## The bug this fixes
--
-- `POST /api/ingest` has never written a row. Every upload returns
--
--   500 INGEST_ERROR — there is no unique or exclusion constraint matching
--                      the ON CONFLICT specification
--
-- because `routers/ingest.ts` ends with `upsertMany('works', batch,
-- 'esakshi_work_id')`, and 001 declares that column as a bare `TEXT` with no
-- UNIQUE and no index. Postgres has nothing to resolve `ON CONFLICT
-- (esakshi_work_id)` against, so the very first batch of 50 aborts and the
-- whole request rolls back. The failure is total and silent from the outside:
-- no partial import, no half-loaded corpus, just a 500 on every file.
--
-- The column has been the upsert key in the code since ingest was written. This
-- migration makes the schema agree with it.
--
-- ## Why a plain ALTER would have failed here
--
-- The constraint cannot simply be added, because the table already violates it.
-- At the time of writing the demo database held 1,000 work rows carrying only
-- 400 distinct `esakshi_work_id` values — every id present two to five times.
--
-- That is not corruption, it is the same bug from the other side: with no unique
-- key, each re-run of the seed or a repeated import appended a second full copy
-- of every work instead of updating it in place. The duplicates are the evidence
-- that the upsert was never an upsert.
--
-- So the surplus copies go first, then the constraint that prevents them
-- recurring. Doing it in that order, in one transaction, means the table is
-- never left in a state where an import could add a fresh duplicate between the
-- two steps.
--
-- ## What deleting a duplicate takes with it
--
-- Every `work_id` foreign key in this schema is ON DELETE CASCADE — `payments`,
-- `documents`, `alerts`, `answer_key`, `inspections` (001), `health_reports`
-- (010), the document and photo tables (013, 014), `work_embeddings` (015) and
-- the inspection evidence tables (017). Children of a discarded copy are removed
-- with it, which is what should happen: they were attached to a row that was
-- always a duplicate of another.
--
-- `audit_events` is deliberately NOT in that list. Its `entity_id` is a bare
-- TEXT with no foreign key, so the hash chain is untouched by anything here. An
-- append-only ledger that lost entries when the rows they describe were tidied
-- up would not be one.
--
-- ## Preconditions
--
-- Migrations 005 and 008 must already be applied. They are checked below rather
-- than assumed, because both were found missing from a database where every
-- other migration had run, and the symptom in each case is a later failure that
-- names something other than the missing migration:
--
--   * without 008, `payments` has no `stage` / `sequence_number`, so the ingest
--     clears this fix and then dies in `writePayments` instead;
--   * without 005, `evaluation_runs` cannot store the NULL precision/recall that
--     an empty answer key produces, so the evaluation write fails.
--
-- Both are idempotent. Run 005 and 008, then this file.

BEGIN;

-- ─── Preconditions ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'
      AND column_name = 'sequence_number'
  ) THEN
    RAISE EXCEPTION
      'Migration 008_payment_stages.sql has not been applied: payments.sequence_number is missing. Run 008 first — ingest would clear this migration and then fail in writePayments instead.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'evaluation_runs'
      AND column_name = 'precision_val' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'Migration 005_evaluation_nullable_metrics.sql has not been applied: evaluation_runs.precision_val is still NOT NULL. Run 005 first — an empty answer key yields NULL metrics that this column cannot store.';
  END IF;
END $$;

-- ─── Discard the surplus copies ─────────────────────────────
--
-- One row survives per `esakshi_work_id`: the earliest `created_at`, ties broken
-- on the lowest `id`. Both columns are NOT NULL, so the ordering is total and
-- the outcome does not depend on the order Postgres happens to scan in — run
-- this twice and the same row survives.
--
-- Keeping the EARLIEST rather than the newest is the deliberate choice. The
-- ingest resolves an existing work by `esakshi_work_id` and reuses its UUID, so
-- the oldest row is the one any surviving foreign key was most likely written
-- against; it is also the one a re-import will now update in place. The newer
-- copies carry no information the next ingest will not overwrite.
--
-- Rows with a NULL `esakshi_work_id` are left alone. `=` is never true for NULL,
-- so they cannot match a partner here, and the UNIQUE index below permits any
-- number of them — a work that arrived without an e-SAKSHI id is not a duplicate
-- of every other work that also lacks one.

DELETE FROM works victim
USING works survivor
WHERE victim.esakshi_work_id = survivor.esakshi_work_id
  AND (victim.created_at, victim.id) > (survivor.created_at, survivor.id);

-- ─── The upsert key ─────────────────────────────────────────
--
-- A UNIQUE INDEX rather than a UNIQUE CONSTRAINT. PostgREST resolves
-- `on_conflict=esakshi_work_id` against either, and an index can be created
-- IF NOT EXISTS — so re-running this file is a no-op instead of an error, which
-- a named constraint would raise on the second run.

CREATE UNIQUE INDEX IF NOT EXISTS works_esakshi_work_id_key
  ON works (esakshi_work_id);

COMMENT ON COLUMN works.esakshi_work_id IS
  'The work id as e-SAKSHI issues it, and the conflict target for the ingest upsert (routers/ingest.ts). Unique: re-importing an export must update the work in place, not append a second copy. NULL is permitted and is not a duplicate of another NULL — a work that arrived with no e-SAKSHI id simply has none.';

COMMIT;
