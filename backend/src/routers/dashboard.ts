/**
 * Dashboard Router — GET /dashboard, GET /dashboard/districts
 */

import { Router } from 'express';
import { getDb, count } from '../db.ts';
import { qstr } from '../http.ts';
import type { DashboardStats, SeverityLevel, WorkStatus } from '../types.ts';

const router = Router();

/** GET /dashboard — aggregate stats */
router.get('/', async (req, res) => {
  const district_id = qstr(req, 'district_id');
  const db = getDb();

  // Works by status
  let worksQuery = db.from('works').select('status, sanctioned_amount, expenditure, actual_completion_date');
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

  const works_by_status: Record<string, number> = {};
  for (const w of worksList) {
    const st = w.status as string;
    works_by_status[st] = (works_by_status[st] ?? 0) + 1;
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
    works_by_category: {}, // TODO: compute
    trend: [], // TODO: compute from monthly data
  };

  res.json({ data: stats });
});

/** GET /dashboard/districts — per-district breakdown */
router.get('/districts', async (_req, res) => {
  const db = getDb();
  const { data: districts } = await db.from('districts').select('*');

  const breakdown = await Promise.all(
    (districts ?? []).map(async (d) => {
      const works = await count('works', { district_id: d.id });
      const alerts = await count('alerts', { status: 'OPEN' });
      return {
        district: d,
        total_works: works,
        open_alerts: alerts,
      };
    }),
  );

  res.json({ data: breakdown });
});

export default router;
