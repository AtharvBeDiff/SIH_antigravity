/**
 * Health reports — the 10-day progress check-in, and the cadence R-019 measures.
 *
 * The table this reads was DROPped by the schema and never created (see
 * `supabase/migrations/010_health_reports.sql`), and the consequence was not a
 * missing feature but a misreporting one. R-019 fires on "no 10-day health report
 * in N days" and had no reports to count, so `detectors/delay.ts` measured
 * `works.updated_at` instead — a timestamp that means *this row changed*, which
 * `services/payments.ts` touches on every payment refresh. Any write to the work
 * reset the reporting clock, and a work whose progress was genuinely never
 * reported looked compliant because something else about it had been edited.
 *
 * This module is the only writer, and the only place the cadence is derived from.
 * `lastReportDateByWork` is what the detector consumes: one map lookup per work
 * rather than 2,000 round trips inside the analysis loop.
 */

import { all, getDb } from '../db.ts';
import type { HealthReport } from '../types.ts';
import { newId, nowIso } from '../util.ts';

/** A report as supplied by a caller, before its id and timestamps are assigned. */
export interface HealthReportInput {
  work_id: string;
  reported_by?: string | null;
  /** Defaults to today. A field app syncing an offline queue supplies its own. */
  report_date?: string | null;
  progress_pct: number;
  evidence_image_key?: string | null;
  remarks?: string | null;
}

/**
 * Validate one report input.
 *
 * Returns a reason string when the input cannot be written, or null when it can.
 * `progress_pct` is bounds-checked because it is written through to
 * `works.physical_progress_pct`, which R-005, R-008 and R-018 all read: a value
 * outside 0–100 there would make each of those rules report arithmetic on a
 * quantity that is not a percentage.
 */
function rejectionReason(input: HealthReportInput): string | null {
  if (!input.work_id) return 'no work_id';
  if (typeof input.progress_pct !== 'number' || !Number.isFinite(input.progress_pct)) {
    return 'progress_pct is not a number';
  }
  if (input.progress_pct < 0 || input.progress_pct > 100) {
    return 'progress_pct must be between 0 and 100';
  }
  if (input.report_date && !/^\d{4}-\d{2}-\d{2}/.test(input.report_date)) {
    return 'report_date must be YYYY-MM-DD';
  }
  return null;
}

export interface HealthReportWriteResult {
  report: HealthReport;
  /** Whether an existing report for that work and day was replaced. */
  replaced: boolean;
  /** The work's progress before this report, for the audit payload. */
  previous_progress_pct: number | null;
}

/**
 * File one health report and carry its progress through to the work.
 *
 * The report row is the record; `works.physical_progress_pct` is a projection of
 * the newest one. Both are written, and the previous value is returned so the
 * caller can put the before-and-after in the audit event — a progress figure that
 * changed with no record of what it was is the shape of an unexplainable number
 * on a dossier.
 *
 * `(work_id, report_date)` is unique, so a retried submission updates that day's
 * report instead of appending a second copy of it.
 */
export async function writeHealthReport(
  input: HealthReportInput,
): Promise<HealthReportWriteResult> {
  const reason = rejectionReason(input);
  if (reason) throw new Error(reason);

  const db = getDb();
  const reportDate = (input.report_date ?? nowIso().slice(0, 10)).slice(0, 10);

  // The work is read first, not assumed: a report against an unknown work would
  // otherwise surface as a foreign-key error the caller cannot act on, and the
  // previous progress is needed for the audit payload either way.
  const { data: work, error: workErr } = await db
    .from('works')
    .select('id, physical_progress_pct')
    .eq('id', input.work_id)
    .maybeSingle();
  if (workErr) throw workErr;
  if (!work) throw new Error(`unknown work_id '${input.work_id}'`);

  const { data: existing, error: existingErr } = await db
    .from('health_reports')
    .select('id')
    .eq('work_id', input.work_id)
    .eq('report_date', reportDate)
    .maybeSingle();
  if (existingErr) throw existingErr;

  const row: HealthReport = {
    id: existing?.id ?? newId(),
    work_id: input.work_id,
    reported_by: input.reported_by || 'Field Inspector',
    report_date: reportDate,
    progress_pct: input.progress_pct,
    evidence_image_key: input.evidence_image_key ?? undefined,
    remarks: input.remarks ?? undefined,
    created_at: nowIso(),
  };

  const { error: upsertErr } = await db
    .from('health_reports')
    .upsert(row as unknown as Record<string, unknown>, { onConflict: 'id' });
  if (upsertErr) throw upsertErr;

  const previous =
    typeof work.physical_progress_pct === 'number' ? work.physical_progress_pct : null;

  const { error: updateErr } = await db
    .from('works')
    .update({ physical_progress_pct: input.progress_pct, updated_at: nowIso() })
    .eq('id', input.work_id);
  if (updateErr) throw updateErr;

  return { report: row, replaced: Boolean(existing), previous_progress_pct: previous };
}

/** Reports for one work, newest first. */
export async function reportsForWork(workId: string): Promise<HealthReport[]> {
  const db = getDb();
  const { data, error } = await db
    .from('health_reports')
    .select('*')
    .eq('work_id', workId)
    .order('report_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as HealthReport[];
}

/** The most recent reports across the corpus, newest first. */
export async function recentReports(limit = 100): Promise<HealthReport[]> {
  const db = getDb();
  const { data, error } = await db
    .from('health_reports')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as HealthReport[];
}

/**
 * The newest report date per work — the input R-019 measures cadence from.
 *
 * A work absent from this map has **never** been reported on. That is not the same
 * as a work reported on long ago, and the detector must not collapse the two: an
 * absent report has no date to subtract, so under doctrine 6 the rule cannot claim
 * a specific number of days of silence. See `detectors/delay.ts`.
 */
export async function lastReportDateByWork(): Promise<Map<string, string>> {
  // Via `all()` because it pages — see the note in `payments.ts:allPayments`.
  // The direct `.select()` this replaced returned 1,000 of 2,375 reports, so
  // roughly two hundred works had a last-report date and the other ~275 looked
  // as though nobody had ever inspected them. R-019 raised 293 alerts against
  // the 31 works that actually qualify.
  const rows = await all<{ work_id: string; report_date: string }>(
    'health_reports',
    { select: 'work_id, report_date' },
  );

  const latest = new Map<string, string>();
  for (const row of rows) {
    if (!row.work_id || !row.report_date) continue;
    const date = String(row.report_date).slice(0, 10);
    const current = latest.get(row.work_id);
    if (!current || date > current) latest.set(row.work_id, date);
  }
  return latest;
}
