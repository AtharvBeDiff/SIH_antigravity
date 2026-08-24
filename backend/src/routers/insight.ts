/**
 * Insight Router — GET /evaluation, GET /calibration, GET /readiness
 */

import { Router } from 'express';
import { getDb } from '../db.ts';

const router = Router();

/** GET /evaluation — latest evaluation run with precision/recall */
router.get('/evaluation', async (_req, res) => {
  const db = getDb();
  const { data, error } = await db
    .from('evaluation_runs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`evaluation fetch: ${error.message}`);
  res.json({ data: data ?? null });
});

/** GET /calibration — corpus vs real aggregates */
router.get('/calibration', async (_req, res) => {
  const db = getDb();
  const { data, error } = await db
    .from('calibration_snapshots')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`calibration fetch: ${error.message}`);
  res.json({ data: data ?? null });
});

/** GET /readiness — integration readiness checklist */
router.get('/readiness', async (_req, res) => {
  // Static checklist as per DATA_CONTRACT
  const checklist = [
    { column: 'work_id', description: 'Unique identifier', mapped: true, source_field: 'esakshi_work_id', notes: '' },
    { column: 'district_code', description: 'District LGD code', mapped: true, source_field: 'district_id', notes: 'Mapped via internal district ID' },
    { column: 'constituency_code', description: 'Constituency code', mapped: true, source_field: 'constituency_id', notes: '' },
    { column: 'sanctioned_amount', description: 'Total sanctioned funds', mapped: true, source_field: 'sanctioned_amount', notes: '' },
    { column: 'expenditure', description: 'Total expenditure', mapped: true, source_field: 'expenditure', notes: '' },
    { column: 'status', description: 'Current status', mapped: true, source_field: 'status', notes: 'Mapped to internal enum' },
    { column: 'completion_pct', description: 'Physical progress', mapped: true, source_field: 'physical_progress_pct', notes: '' },
    { column: 'category', description: 'Work category', mapped: true, source_field: 'category', notes: '' },
  ];
  res.json({ data: checklist });
});

export default router;
