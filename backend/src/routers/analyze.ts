/**
 * Analyze Router — POST /analyze, GET /analyze/status
 * Integration hub: runs the full analysis pipeline.
 */

import { Router } from 'express';
import { actorOf } from '../http.ts';
import { appendAudit } from '../services/audit_chain.ts';
import { nowIso } from '../util.ts';

const router = Router();

/** POST /analyze — trigger full analysis pipeline */
router.post('/', async (req, res) => {
  const actor = actorOf(req);

  // TODO: Full pipeline — benchmarks → rules → detectors → upsert → auto-resolve → budget → audit
  // For now, record the attempt
  await appendAudit(actor, 'ANALYZE_RUN', 'system', 'analyze', {
    timestamp: nowIso(),
    status: 'started',
  });

  // Import and run when services are built
  try {
    const { runAnalyze } = await import('../services/alerts.ts');
    const result = await runAnalyze(actor);
    res.json({ data: result });
  } catch {
    res.json({
      data: {
        status: 'pending',
        message: 'Analysis pipeline not yet fully implemented. Use seed script for demo data with pre-computed alerts.',
      },
    });
  }
});

/** GET /analyze/status — last pipeline run status */
router.get('/status', async (_req, res) => {
  res.json({ data: { status: 'ready', last_run: null } });
});

export default router;
