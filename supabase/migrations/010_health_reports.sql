-- ═══════════════════════════════════════════════════════════════════════
-- 010 · health_reports: create the table the schema only ever dropped
-- ═══════════════════════════════════════════════════════════════════════
--
-- `supabase/full_schema.sql` DROPped `health_reports` and never created it —
-- 19 DROPs against 18 CREATEs. The consequences were not a missing feature but
-- a misreporting one:
--
--   * `routers/health_reports.ts` caught the missing-table error on GET and
--     returned `[]`, so the endpoint answered 200 with an empty list. A caller
--     could not tell "no reports filed" from "no table to file them in". The
--     POST on the same router had no such catch and 500'd, so the feature
--     read as working and failed on use.
--   * R-019 ("missing 10-day health report") never queried the table at all.
--     It measured `works.updated_at`, which `services/payments.ts` touches on
--     every payment refresh — so the rule reported "no health report in N days"
--     from a timestamp that means "this row changed N days ago". Any write to
--     the work reset the cadence clock.
--
-- The 10-day cadence is the scheme's own reporting requirement, so the reports
-- are the primary record and `updated_at` was never a stand-in for them.

CREATE TABLE IF NOT EXISTS health_reports (
  id                 TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id            TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  reported_by        TEXT NOT NULL,
  report_date        DATE NOT NULL,
  progress_pct       DOUBLE PRECISION NOT NULL,
  evidence_image_key TEXT,
  remarks            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- R-019 reads the newest report per work, so the index is (work_id, date DESC).
CREATE INDEX IF NOT EXISTS idx_health_reports_work_date
  ON health_reports(work_id, report_date DESC);

-- One report per work per day. A field app that retries a submission must update
-- that day's report rather than append a second one: two rows for one day would
-- not change the cadence arithmetic, but they would make the report count a
-- measure of retry behaviour rather than of reporting.
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_reports_work_day
  ON health_reports(work_id, report_date);

COMMENT ON TABLE health_reports IS
  'Mandatory 10-day progress check-ins. The only source R-019 measures cadence from; works.updated_at is not a substitute for it.';

COMMENT ON COLUMN health_reports.progress_pct IS
  'Progress as reported in this check-in. Kept per report, not only on works.physical_progress_pct, so a revision downward stays visible instead of being overwritten.';

-- ─── RLS ────────────────────────────────────────────────────
--
-- Matches the posture of every other table in 002: RLS on, no anon policy, and
-- authenticated read. The backend uses the service-role key and bypasses this
-- (see the auth-gap disclosure in the README) — these policies are what
-- constrains direct Supabase access from a browser.

ALTER TABLE health_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_all_health_reports" ON health_reports;
CREATE POLICY "auth_read_all_health_reports" ON health_reports
  FOR SELECT TO authenticated USING (TRUE);
