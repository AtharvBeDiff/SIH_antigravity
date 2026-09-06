-- 007 — Correct the completion benchmark, and admit two of them (F-07)
--
-- `calibration_snapshots.target_completion_rate` defaulted to 0.1924. That figure
-- does not appear in the published MPLADS aggregates for the period the platform
-- cites, and it was the single benchmark the whole calibration page compared
-- against.
--
-- The Standing Committee figures for 1 Apr 2023 – 22 Jan 2026 give two rates, and
-- they are not interchangeable:
--
--   by value:  ₹3,387.38 Cr completed of ₹6,680.29 Cr sanctioned  = 50.71%
--   by count:  69,061 works completed of 1,11,600 sanctioned      = 61.88%
--
-- They differ by more than eleven points because the works that complete are
-- systematically cheaper than the works that stall. A schema with one column for
-- "the" completion benchmark cannot represent that, so this migration adds the
-- by-count pair alongside the by-value one.
--
-- On 001_initial_schema.sql: that file still carries DEFAULT 0.1924 and is left
-- byte-identical on purpose. It is applied history — for a platform whose pitch is
-- a tamper-evident ledger, rewriting the record of what was applied is the wrong
-- instinct even when the rewrite is harmless. This migration is the correction, and
-- it runs on every fresh migrate, so a database built from 001 onward ends up with
-- the right default regardless. supabase/full_schema.sql is a regenerable
-- convenience artifact rather than history, so it was corrected in place.
--
-- Idempotent.

-- Two benchmarks, each with its own default.
ALTER TABLE calibration_snapshots
  ALTER COLUMN target_completion_rate SET DEFAULT 0.5071;

ALTER TABLE calibration_snapshots
  ADD COLUMN IF NOT EXISTS target_completion_rate_by_count DOUBLE PRECISION NOT NULL DEFAULT 0.6188;

ALTER TABLE calibration_snapshots
  ADD COLUMN IF NOT EXISTS corpus_completion_rate_by_count DOUBLE PRECISION;

ALTER TABLE calibration_snapshots
  ADD COLUMN IF NOT EXISTS deviation_pct_by_count DOUBLE PRECISION;

-- An empty corpus has no completion rate and no deviation from anything. These
-- were NOT NULL, which forced computeCalibration to invent a value for a corpus it
-- had not measured — it fell back to the benchmark itself, yielding a deviation of
-- exactly 0 and rendering an empty database as perfectly calibrated. Same defect
-- and same remedy as evaluation_runs in migration 005.
ALTER TABLE calibration_snapshots ALTER COLUMN corpus_completion_rate DROP NOT NULL;
ALTER TABLE calibration_snapshots ALTER COLUMN deviation_pct          DROP NOT NULL;

-- Existing rows were written against 0.1924 and cannot be repaired: the corpus they
-- measured is gone, so their deviation figures are unrecoverable. Discard them
-- rather than leave rows that silently mix two benchmarks. /calibration recomputes
-- on request, so nothing is lost but a stale audit trail of a wrong constant.
DELETE FROM calibration_snapshots
 WHERE target_completion_rate <> 0.5071;

COMMENT ON COLUMN calibration_snapshots.target_completion_rate IS
  '0.5071 — Rs 3,387.38 Cr completed of Rs 6,680.29 Cr sanctioned, 2023-04-01 to 2026-01-22.';
COMMENT ON COLUMN calibration_snapshots.target_completion_rate_by_count IS
  '0.6188 — 69,061 works completed of 1,11,600 sanctioned. Not interchangeable with the by-value rate.';
COMMENT ON COLUMN calibration_snapshots.corpus_completion_rate IS
  'NULL means unmeasured (empty corpus), not zero.';
