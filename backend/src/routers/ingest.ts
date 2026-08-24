/**
 * Ingest Router — POST /ingest, GET /ingest/history
 */

import { Router } from 'express';
import { getDb } from '../db.ts';
import { appendAudit } from '../services/audit_chain.ts';
import { actorOf } from '../http.ts';
import { nowIso, newId } from '../util.ts';

const router = Router();

/** POST /ingest — CSV upload endpoint (placeholder for now) */
router.post('/', async (req, res) => {
  const actor = actorOf(req);
  // TODO: Full CSV parsing via csv/field_map/validator/ingest services
  // For now, acknowledge receipt
  await appendAudit(actor, 'INGEST_ATTEMPT', 'system', 'ingest', {
    timestamp: nowIso(),
  });
  res.json({ data: { status: 'received', message: 'Ingest endpoint ready. Use seed script for demo data.' } });
});

/** GET /ingest/history — past ingest runs */
router.get('/history', async (_req, res) => {
  // Return audit events of type ingest
  const db = getDb();
  const { data, error } = await db
    .from('audit_events')
    .select('*')
    .eq('action', 'INGEST_ATTEMPT')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`ingest history: ${error.message}`);
  res.json({ data: data ?? [] });
});

export default router;
