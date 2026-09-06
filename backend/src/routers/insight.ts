/**
 * Insight Router — GET /evaluation, GET /calibration, GET /readiness
 */

import { Router } from 'express';
import { getDb } from '../db.ts';
import { runEvaluation } from '../services/evaluation.ts';
import { computeVintageAdjustment } from '../services/calibration.ts';
import { getReadinessChecklist } from '../services/readiness.ts';

const router = Router();

/**
 * GET /evaluation — measure detector performance against the `answer_key` table.
 *
 * Computed live and not persisted, so a GET stays read-only. Note that `answer_key`
 * has no writers anywhere in the repo: until it is populated, `total_planted` is 0
 * and every metric comes back null, because a ratio over a zero denominator is
 * undefined. The response says so rather than filling in a plausible number.
 */
router.get('/evaluation', async (_req, res) => {
  const run = await runEvaluation();
  res.json({ data: run });
});

/**
 * GET /calibration — the corpus's completion rates against the published figures,
 * plus the vintage-adjusted reading of those figures.
 *
 * `vintage_adjustment` is computed on every request and is **not** persisted: it is
 * arithmetic over `REFERENCE_AGGREGATES`, which are constants, so storing it would
 * create a second copy of a derivation that can already never drift. It is therefore
 * absent from the `calibration_snapshots` row and attached here, at the response
 * boundary — which is also why `computeCalibration` must not include it in the object
 * it inserts.
 *
 * It travels with the corpus comparison because 50.71% is the number a reader
 * arrives with, and the adjustment is what turns the gap into something actionable:
 * ~78.66% against matured value, ~₹919 Cr genuinely past deadline. The assumption
 * behind it is carried in the payload rather than left to the client to remember.
 */
router.get('/calibration', async (_req, res) => {
  const db = getDb();
  const { data, error } = await db
    .from('calibration_snapshots')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`calibration fetch: ${error.message}`);
  if (!data) {
    res.json({ data: null });
    return;
  }
  res.json({ data: { ...data, vintage_adjustment: computeVintageAdjustment() } });
});

/**
 * GET /readiness — DRISHTI's proposed integration schema, and what actually
 * populates each field today.
 *
 * Single source of truth is `services/readiness.ts`. This route used to carry its
 * own shorter inline copy, which meant the screen and the service disagreed.
 */
router.get('/readiness', async (_req, res) => {
  res.json({ data: getReadinessChecklist() });
});

export default router;
