/**
 * Dashboard Router — GET /dashboard, GET /dashboard/districts
 */

import { Router } from 'express';
import { getDb, count } from '../db.ts';
import { qstr } from '../http.ts';
import { toMonth } from '../util.ts';
import type { DashboardStats, SeverityLevel, TrendPoint, WorkStatus } from '../types.ts';

const router = Router();

type TrendWorkRow = {
  id: string;
  sanctioned_amount: number | null;
  sanction_date: string | null;
  actual_completion_date: string | null;
};

/**
 * The monthly activity series.
 *
 * `DashboardStats.trend` was `null` with a note that computing it needed a monthly
 * rollup of sanction dates, completion dates and alert timestamps. This is that
 * rollup. It exists because `OverviewPage.tsx` was charting a six-month financial
 * series from literal rupee figures — `{ month: 'Apr', sanctioned: 32000000, ... }` —
 * with only the last point wired to anything real, so the chart described a scheme
 * trajectory nobody had measured.
 *
 * Four decisions worth recording:
 *
 * 1. **Only months present in the data appear.** The series is not padded to a fixed
 *    window. A month with no sanctions, no completions and no payments is absent
 *    rather than emitted as a row of zeros, because a zero is a measurement and the
 *    absence of a row is not. Months between two populated months *are* filled, so a
 *    quiet interior month reads as quiet rather than as a gap in the axis.
 * 2. **`released` comes from `payments`, not `works.released_amount`.** That column is
 *    a running total carrying no date, so no month can be attributed to it. The
 *    payment rows each have a `payment_date`.
 * 3. **No `expenditure` series.** `works.expenditure` is likewise a dated-nowhere
 *    scalar. The overview chart drops the expenditure area rather than inventing a
 *    curve for it.
 * 4. **`alerts_resolved` counts `reviewed_at`, not `status`.** A resolved alert is one
 *    an officer acted on at a knowable time; a status alone has no date and so has no
 *    month.
 *
 * Returns `null` when the rollup is empty — nothing dated, nothing to chart.
 */
async function computeTrend(
  works: TrendWorkRow[],
  districtId: string | null,
): Promise<TrendPoint[] | null> {
  const db = getDb();

  const buckets = new Map<string, TrendPoint>();
  const bucketFor = (month: string): TrendPoint => {
    const existing = buckets.get(month);
    if (existing) return existing;
    const fresh: TrendPoint = {
      month,
      completed: 0,
      sanctioned: 0,
      released: 0,
      alerts_opened: 0,
      alerts_resolved: 0,
    };
    buckets.set(month, fresh);
    return fresh;
  };

  const workIds = new Set<string>();
  for (const w of works) {
    workIds.add(w.id);
    if (w.sanction_date) {
      const amount = Number(w.sanctioned_amount ?? 0);
      bucketFor(toMonth(w.sanction_date)).sanctioned += Number.isFinite(amount) ? amount : 0;
    }
    if (w.actual_completion_date) {
      bucketFor(toMonth(w.actual_completion_date)).completed += 1;
    }
  }

  // Payments and alerts are scoped through the work set rather than by a second
  // district predicate: neither table carries a district, and joining for one would
  // ask PostgREST to re-resolve a relationship the works query has already resolved.
  const { data: payments, error: pErr } = await db
    .from('payments')
    .select('work_id, amount, payment_date');
  if (pErr) throw new Error(`dashboard trend (payments): ${pErr.message}`);
  for (const p of (payments ?? []) as { work_id: string; amount: number; payment_date: string }[]) {
    if (districtId && !workIds.has(p.work_id)) continue;
    if (!p.payment_date) continue;
    const amount = Number(p.amount ?? 0);
    bucketFor(toMonth(p.payment_date)).released += Number.isFinite(amount) ? amount : 0;
  }

  const { data: alertRows, error: aErr } = await db
    .from('alerts')
    .select('work_id, created_at, reviewed_at');
  if (aErr) throw new Error(`dashboard trend (alerts): ${aErr.message}`);
  for (const a of (alertRows ?? []) as {
    work_id: string;
    created_at: string | null;
    reviewed_at: string | null;
  }[]) {
    if (districtId && !workIds.has(a.work_id)) continue;
    // `created_at`/`reviewed_at` are ISO-8601 timestamps; the first seven characters
    // are the YYYY-MM the bucket is keyed on.
    if (a.created_at) bucketFor(a.created_at.slice(0, 7)).alerts_opened += 1;
    if (a.reviewed_at) bucketFor(a.reviewed_at.slice(0, 7)).alerts_resolved += 1;
  }

  if (buckets.size === 0) return null;

  const sorted = [...buckets.keys()].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  // Fill interior months so the axis is continuous. A month between two populated
  // months genuinely had no activity, which is a measurement; a month outside the
  // range was never observed, which is not, and is left off the series entirely.
  const series: TrendPoint[] = [];
  let [year, month] = first.split('-').map(Number) as [number, number];
  const [lastYear, lastMonth] = last.split('-').map(Number) as [number, number];
  // Bounded by construction — the loop advances one calendar month per iteration and
  // `last` is a month key drawn from the same map, so it is always reachable.
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    series.push(buckets.get(key) ?? bucketFor(key));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return series;
}

/** GET /dashboard — aggregate stats */
router.get('/', async (req, res) => {
  const district_id = qstr(req, 'district_id');
  const db = getDb();

  // `category` is selected because `works_by_category` is part of the response and
  // was previously returned as `{}` with a `// TODO: compute` beside it. An empty
  // map is not a neutral placeholder here — it says every category has zero works.
  // `id` and `sanction_date` are selected for the monthly trend, and
  // `released_amount` for `total_released` — a figure `OverviewPage.tsx` was deriving
  // as `total_sanctioned * 0.62` while the real column sat unread.
  let worksQuery = db
    .from('works')
    .select(
      'id, status, category, sanctioned_amount, released_amount, expenditure, sanction_date, actual_completion_date',
    );
  if (district_id) worksQuery = worksQuery.eq('district_id', district_id);
  const { data: works, error: wErr } = await worksQuery;
  if (wErr) throw new Error(`dashboard works: ${wErr.message}`);

  const worksList = works ?? [];
  const total_works = worksList.length;
  const completed_works = worksList.filter(w => w.status === 'COMPLETED').length;
  const total_sanctioned = worksList.reduce((s, w) => s + (w.sanctioned_amount as number), 0);
  const completed_value = worksList
    .filter(w => w.status === 'COMPLETED')
    .reduce((s, w) => s + (w.sanctioned_amount as number), 0);
  const total_expenditure = worksList.reduce((s, w) => s + (w.expenditure as number), 0);
  const total_released = worksList.reduce((s, w) => s + ((w.released_amount as number) ?? 0), 0);

  const works_by_status: Record<string, number> = {};
  const works_by_category: Record<string, number> = {};
  for (const w of worksList) {
    const st = w.status as string;
    works_by_status[st] = (works_by_status[st] ?? 0) + 1;
    const cat = w.category as string | null;
    if (cat) works_by_category[cat] = (works_by_category[cat] ?? 0) + 1;
  }

  // Alerts by severity
  let alertsQuery = db.from('alerts').select('severity, status');
  if (district_id) {
    // Join through works for district filtering
    alertsQuery = db.from('alerts').select('severity, status, works!inner(district_id)');
    alertsQuery = alertsQuery.eq('works.district_id', district_id);
  }
  const { data: alerts } = await alertsQuery;
  const alertsList = alerts ?? [];

  const open_alerts = alertsList.filter(a => a.status === 'OPEN').length;
  const backlog_alerts = alertsList.filter(a => a.status === 'BACKLOG').length;
  const alerts_by_severity: Record<string, number> = {};
  for (const a of alertsList.filter(a => a.status === 'OPEN' || a.status === 'BACKLOG')) {
    const sev = a.severity as string;
    alerts_by_severity[sev] = (alerts_by_severity[sev] ?? 0) + 1;
  }

  const trend = await computeTrend(worksList as TrendWorkRow[], district_id ?? null);

  const stats: DashboardStats = {
    total_works,
    completed_works,
    completion_rate_by_count: total_works > 0 ? completed_works / total_works : 0,
    total_sanctioned,
    total_expenditure,
    completion_rate_by_value: total_sanctioned > 0 ? completed_value / total_sanctioned : 0,
    open_alerts,
    backlog_alerts,
    alerts_by_severity: alerts_by_severity as Record<SeverityLevel, number>,
    works_by_status: works_by_status as Record<WorkStatus, number>,
    works_by_category: works_by_category as Record<string, number>,
    total_released,
    // `null` when there is nothing to roll up, never `[]`: an empty array says the
    // corpus has no activity in any month, which a caller can legitimately chart as a
    // flat line at zero.
    trend,
  };

  res.json({ data: stats });
});

/**
 * GET /dashboard/districts — per-district breakdown.
 *
 * `open_alerts` used to be `count('alerts', { status: 'OPEN' })` with no district
 * predicate, so every district was handed the *global* open-alert total. On the
 * canonical four-district corpus that renders four identical numbers, each of them
 * roughly four times the district's real load — and it reads as a coincidence rather
 * than a bug, which is why it survived.
 *
 * `alerts` has no `district_id` of its own; a district is a property of the work. So
 * the count goes through the FK with an inner join and `head: true`, which asks
 * PostgREST for the count without transferring the rows.
 */
router.get('/districts', async (_req, res) => {
  const db = getDb();
  const { data: districts, error } = await db.from('districts').select('*');
  if (error) throw new Error(`dashboard districts: ${error.message}`);

  const breakdown = await Promise.all(
    (districts ?? []).map(async (d) => {
      const works = await count('works', { district_id: d.id });
      const { count: openAlerts, error: aErr } = await db
        .from('alerts')
        .select('id, works!inner(district_id)', { count: 'exact', head: true })
        .eq('status', 'OPEN')
        .eq('works.district_id', d.id);
      if (aErr) throw new Error(`dashboard districts alerts (${d.id}): ${aErr.message}`);
      return {
        district: d,
        total_works: works,
        open_alerts: openAlerts ?? 0,
      };
    }),
  );

  res.json({ data: breakdown });
});

export default router;
