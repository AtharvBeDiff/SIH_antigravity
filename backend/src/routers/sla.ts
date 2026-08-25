/**
 * SLA Router — GET /sla/stats, POST /sla/evaluate
 */

import { Router } from 'express';
import { getDb } from '../db.ts';
import { evaluateProposalSLAs } from '../services/sla_engine.ts';

const router = Router();
const SLA_LIMIT_DAYS = 45;
const SLA_WARNING_DAYS = 35;

/** GET /sla/stats — Returns aggregated SLA statistics */
router.get('/stats', async (_req, res) => {
  const db = getDb();

  const { data: proposedWorks, error } = await db
    .from('works')
    .select('id, recommended_date')
    .eq('status', 'PROPOSED');

  if (error) throw new Error(`Failed to fetch proposed works: ${error.message}`);

  const works = proposedWorks ?? [];
  let breached = 0;
  let atRisk = 0;
  let safe = 0;
  let totalDays = 0;

  const now = new Date();

  for (const work of works) {
    if (!work.recommended_date) continue;

    const recDate = new Date(work.recommended_date);
    const diffTime = Math.abs(now.getTime() - recDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    totalDays += diffDays;

    if (diffDays > SLA_LIMIT_DAYS) {
      breached++;
    } else if (diffDays > SLA_WARNING_DAYS) {
      atRisk++;
    } else {
      safe++;
    }
  }

  const avgDays = works.length > 0 ? Math.round(totalDays / works.length) : 0;

  res.json({
    data: {
      total: works.length,
      breached,
      atRisk,
      safe,
      avgDays,
    }
  });
});

/** POST /sla/evaluate — Manually triggers the SLA engine to generate alerts */
router.post('/evaluate', async (_req, res) => {
  const alerts = await evaluateProposalSLAs();
  res.json({ message: 'SLA evaluation complete', alertsGenerated: alerts.length });
});

export default router;
