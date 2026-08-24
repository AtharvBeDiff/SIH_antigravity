/**
 * Audit Router — GET /audit, GET /audit/verify,
 * POST /audit/_demo/tamper, POST /audit/_demo/restore
 */

import { Router } from 'express';
import { readAudit, verifyChain, demoTamper, demoRestore } from '../services/audit_chain.ts';
import { qstr, qnum, requireDemoMode, requireBody } from '../http.ts';

const router = Router();

/** GET /audit — list audit events with optional filters */
router.get('/', async (req, res) => {
  const events = await readAudit({
    entity_type: qstr(req, 'entity_type'),
    entity_id: qstr(req, 'entity_id'),
    limit: qnum(req, 'limit') ?? 100,
    offset: qnum(req, 'offset') ?? 0,
  });
  res.json({ data: events });
});

/** GET /audit/verify — verify the entire hash chain */
router.get('/verify', async (_req, res) => {
  const result = await verifyChain();
  res.json({ data: result });
});

/** POST /audit/_demo/tamper — tamper a row (DEMO_MODE only) */
router.post('/_demo/tamper', async (req, res) => {
  requireDemoMode();
  const body = requireBody(req);
  const seq = typeof body['seq'] === 'number' ? body['seq'] : undefined;
  if (!seq) {
    res.status(400).json({ error: { code: 'MISSING_SEQ', message: 'seq is required' } });
    return;
  }
  await demoTamper(seq);
  res.json({ data: { tampered: true, seq } });
});

/** POST /audit/_demo/restore — restore a tampered row (DEMO_MODE only) */
router.post('/_demo/restore', async (req, res) => {
  requireDemoMode();
  const body = requireBody(req);
  const seq = typeof body['seq'] === 'number' ? body['seq'] : undefined;
  if (!seq) {
    res.status(400).json({ error: { code: 'MISSING_SEQ', message: 'seq is required' } });
    return;
  }
  await demoRestore(seq);
  res.json({ data: { restored: true, seq } });
});

export default router;
