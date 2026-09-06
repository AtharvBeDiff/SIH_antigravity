-- ═══════════════════════════════════════════════════════════════════════
-- 008 · Payments: reshape the two-tranche model into a stage-keyed history
-- ═══════════════════════════════════════════════════════════════════════
--
-- `payments` has existed since 001 with zero writers, so every rule that
-- reasoned about money read `works.first_installment` / `works.second_installment`
-- instead. Two columns cannot hold an N-stage history, carry no dates (so
-- "no payment for an extended period" is unaskable), and cannot be reconciled
-- against PFMS, which settles per payment rather than per work.
--
-- MPLADS payment is stage-wise: the agency raises a bill against measured work,
-- the district sanctions a release, money moves, repeat. `installment_number` —
-- an INTEGER defaulting to 1 — could order those events but not say what any of
-- them was for, which is the part the rules need. It becomes two columns: a
-- `stage` key saying what the money was for, and a `sequence_number` saying where
-- it sits in the work's history.
--
-- Idempotent throughout: this migration is expected to run against both a fresh
-- 001 schema and a database where it has already been applied.

-- ─── New columns ────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sequence_number INTEGER;

-- The reconciliation key. A payment is matched to its PFMS/SNA settlement by
-- reference, one per payment — the reason a per-work column could never do this.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pfms_reference TEXT;

-- ─── Backfill ───────────────────────────────────────────────
--
-- The table has zero writers, so in every database this has ever run against
-- there is nothing here to convert. The backfill is written anyway rather than
-- assumed: if a row does exist, dropping `installment_number` without mapping it
-- would destroy the only ordering it had. Stage 1 maps to the advance because
-- that is what a first release under the old model was; anything later can only
-- be called a running bill, which is a claim the old data does not actually
-- support and is recorded here as the deliberate best guess it is.

UPDATE payments SET sequence_number = COALESCE(installment_number, 1)
  WHERE sequence_number IS NULL;

UPDATE payments SET stage = CASE
    WHEN COALESCE(installment_number, 1) <= 1 THEN 'MOBILISATION_ADVANCE'
    ELSE 'RUNNING_BILL'
  END
  WHERE stage IS NULL;

-- ─── Constraints ────────────────────────────────────────────

ALTER TABLE payments ALTER COLUMN stage SET NOT NULL;
ALTER TABLE payments ALTER COLUMN sequence_number SET NOT NULL;

-- The vocabulary is enforced in the database, not only in TypeScript. A stage key
-- the rules do not recognise would be silently ignored by every rule that reads
-- `stage`, which is a rule going quiet rather than a write failing.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_stage_check;
ALTER TABLE payments ADD CONSTRAINT payments_stage_check CHECK (
  stage IN ('MOBILISATION_ADVANCE', 'RUNNING_BILL', 'FINAL_BILL', 'RETENTION_RELEASE')
);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

-- One sequence number per work. Re-ingesting a payment file must update the
-- existing row rather than append a second copy of stage 3, which is what makes
-- `total_paid` trustworthy after a repeated import.
DROP INDEX IF EXISTS idx_payments_work_sequence;
CREATE UNIQUE INDEX idx_payments_work_sequence ON payments(work_id, sequence_number);

-- The heatmap and the stall detector both select on payment_date.
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

-- ─── Retire the ordering-only column ────────────────────────

ALTER TABLE payments DROP COLUMN IF EXISTS installment_number;

-- ─── The two work columns this supersedes ───────────────────
--
-- `works.first_installment` and `works.second_installment` are NOT dropped. They
-- are no longer written by ingest and no longer read by any rule (R-012 and R-014
-- now read the payment history), but dropping a column is not reversible and the
-- demo database is restored from `full_schema.sql`. They are marked so that the
-- next person to read the schema does not wire a new rule to them.

COMMENT ON COLUMN works.first_installment IS
  'RETIRED. Superseded by stage-keyed rows in payments. No writer, no reader; a two-column model cannot hold an N-stage history or reconcile against PFMS. Do not add readers.';
COMMENT ON COLUMN works.second_installment IS
  'RETIRED. Superseded by stage-keyed rows in payments. See first_installment.';
COMMENT ON COLUMN works.last_payment_date IS
  'Derived from payments — the max(payment_date) for the work. Maintained by services/payments.ts on every payment write; do not set it independently. Read by R-007 (stall detection).';
