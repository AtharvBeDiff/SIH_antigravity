-- DRISHTI — record which checks actually ran against a reading
--
-- ## What was missing
--
-- A photo analysis and a document extraction each produce two separate things: the
-- findings, and the list of checks that were able to run at all. Only the findings were
-- stored. `checks_run` was computed (photo_reconcile.ts, document_reconcile.ts), written
-- into the audit payload, and returned in the analyze/extract HTTP response — then
-- dropped. Reload the work and it was gone, so the dossier could not answer "was anything
-- actually compared?" for any reading it had not just performed itself.
--
-- ## Why `fields_found` was the wrong proxy for it
--
-- Without this column the panels inferred "something was compared" from `fields_found > 0`.
-- That is a different question, and it answers wrongly in both directions:
--
--   * Photos — `asset_description` counts toward `fields_found` (COUNTED_DIMENSIONS in
--     photo_ai.ts) but is read by no V-check. A photo the model described and nothing more
--     scored `fields_found = 1` and rendered a green "no discrepancies" while zero of the
--     four checks had run.
--   * Documents — worse. Three of the six fields a utilisation certificate expects
--     (`sanction_reference`, `work_reference`, `signatory_name`) are read by no D-check at
--     all; document_reconcile.ts never references them. An extraction could read half its
--     expected fields, run nothing, and still show clean.
--   * And inverted: V-001 compares the EXIF geotag against the work's coordinates and needs
--     no reading whatsoever, so `fields_found = 0` never meant "nothing was compared"
--     either.
--
-- A count of fields read is a fact about the model. A list of checks run is a fact about
-- the comparison. The dossier claims things about the comparison, so it must store one.
--
-- ## Nullable, and deliberately without a DEFAULT
--
-- Rows written before this migration carry no record of which checks ran. `DEFAULT '[]'`
-- would state that zero checks ran on them — a measurement nobody took, rendered as a
-- fact, and the panels would then print "none of the checks could run" about readings that
-- may well have run all of them. That is the mistake migration 014 refuses when it stores a
-- stripped geotag as NULL rather than (0, 0): a field that could not be read is NULL, never
-- a plausible-looking zero.
--
-- So there are three states and the panels branch on all three: a non-empty array (these
-- ran), `[]` (none could run — a real, measured result), and NULL (not recorded; re-analyse
-- the photo or re-extract the document to fill it in).
--
-- JSONB rather than TEXT[], following `evaluation_runs.covered_rule_ids` (migration 009) —
-- the existing precedent for "a list of check ids on a row" — and because the db layer
-- round-trips JSON without needing an array-type adapter.
--
-- Additive and idempotent: both statements are ADD COLUMN IF NOT EXISTS on tables that
-- already exist (013, 014). No data is rewritten.

ALTER TABLE photo_analyses
  ADD COLUMN IF NOT EXISTS checks_run JSONB;

ALTER TABLE document_extractions
  ADD COLUMN IF NOT EXISTS checks_run JSONB;

COMMENT ON COLUMN photo_analyses.checks_run IS
  'V-check ids that were able to run against this reading. [] = none could run, a measured result. NULL = the reading predates this column and nothing was recorded. Never inferred from fields_found: asset_description counts toward fields_found but no check reads it, and V-001 runs off the EXIF geotag with no reading at all.';

COMMENT ON COLUMN document_extractions.checks_run IS
  'D-check ids that were able to run against this reading. [] = none could run, a measured result. NULL = the reading predates this column and nothing was recorded. Never inferred from fields_found: sanction_reference, work_reference and signatory_name count toward fields_found but no D-check reads any of them.';
