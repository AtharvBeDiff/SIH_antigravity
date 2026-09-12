-- ═══════════════════════════════════════════════════════════════════════
-- 019 · Refresh works.last_payment_date in one statement, not one per work
-- ═══════════════════════════════════════════════════════════════════════
--
-- ## What this replaces
--
-- `refreshLastPaymentDates` in services/payments.ts read every payment for the
-- works being written, reduced them to a maximum date per work in TypeScript,
-- and then issued **one UPDATE per work, sequentially**:
--
--   for (const workId of workIds) {
--     await db.from('works').update({ last_payment_date: ... }).eq('id', workId);
--   }
--
-- It runs at the end of every ingest. On the 2,000-row export this repository
-- ships as its reference dataset that is 2,000 serial round trips to hosted
-- Postgres, inside the same HTTP request that has already upserted the works —
-- minutes of latency, and long enough that the proxy in front closes the
-- connection first. The ingest would then appear to fail after having written
-- the works, which is the worst of the available outcomes: a half-applied import
-- whose second half is invisible.
--
-- Grouping the works by date in TypeScript and updating each group was measured
-- against the reference dataset first: 878 distinct last-payment dates across
-- 2,000 works, so it trades 2,000 round trips for 880. That is the same problem
-- with a smaller constant, not a fix.
--
-- `last_payment_date` is derived data — `MAX(payment_date)` over the work's
-- payments. Deriving it is one UPDATE ... FROM. It belongs in the database.
--
-- ## Scoped to the works supplied, deliberately
--
-- The function takes the work ids rather than rebuilding the column for the whole
-- table. Writing a single payment should not rewrite two thousand unrelated rows,
-- both because `updated_at` would then be untrue for all of them and because the
-- write amplification is unnecessary. Passing an empty array is a no-op.
--
-- ## Works with no payments are set to NULL, not skipped
--
-- A work in `work_ids` whose payments have all been deleted must have the column
-- cleared. Leaving the stale date behind would keep the work looking funded on
-- the strength of a payment that no longer exists, and R-007 measures its stall
-- window from exactly this field — it would report the stall as having ended on a
-- date that no row supports. The LEFT JOIN produces NULL for those works, which
-- is the correct value: not "never paid", but "no payment on record", which is
-- what the column has always meant.
--
-- Idempotent: CREATE OR REPLACE, and re-running the function recomputes the same
-- values from the same rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.drishti_refresh_last_payment_dates(work_ids TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
-- SECURITY INVOKER: this writes, so it must run with the caller's rights and never
-- widen them. The backend reaches it with the service-role key; the read-only SQL
-- role introduced in 012 has no UPDATE on `works` and so cannot call it usefully.
SECURITY INVOKER
-- Empty search_path, matching drishti_readonly_select (012): every object below is
-- schema-qualified, so no caller-supplied search_path can point `works` or
-- `payments` at a shadowed table.
SET search_path = ''
AS $fn$
DECLARE
  touched INTEGER;
BEGIN
  IF work_ids IS NULL OR array_length(work_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.works w
     SET last_payment_date = p.max_date,
         updated_at        = NOW()
    FROM (
      SELECT target.id AS work_id,
             MAX(pay.payment_date) AS max_date
        FROM unnest(work_ids) AS target(id)
        LEFT JOIN public.payments pay ON pay.work_id = target.id
       GROUP BY target.id
    ) p
   WHERE w.id = p.work_id
     -- Skip rows whose value is already correct, so `updated_at` moves only when
     -- the payment history actually changed. Re-ingesting an unchanged file then
     -- leaves the works untouched instead of restamping every one of them.
     AND w.last_payment_date IS DISTINCT FROM p.max_date;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$fn$;

COMMENT ON FUNCTION public.drishti_refresh_last_payment_dates(TEXT[]) IS
  'Recompute works.last_payment_date as MAX(payments.payment_date) for the given works, in one statement. Called by services/payments.ts after every payment write; do not set the column independently. Works with no payments are set to NULL. Returns the number of rows whose value actually changed.';

COMMIT;
