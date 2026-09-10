/**
 * Works Router — GET /works, GET /works/:id
 */

import { Router } from 'express';
import { getDb, all, get, count } from '../db.ts';
import { qstr, qnum, paging, notFound, ApiError, actorOf } from '../http.ts';
import { isConfigured } from '../services/llm.ts';
import { capability as duplicateCheckCapability, duplicateCheck } from '../services/work_embeddings.ts';
import type { Work, Alert, Payment, Document } from '../types.ts';

const router = Router();

/** GET /works — paginated, filterable work list */
router.get('/', async (req, res) => {
  const { page, page_size } = paging(req);
  const district_id = qstr(req, 'district_id');
  const status = qstr(req, 'status');
  const category = qstr(req, 'category');
  const search = qstr(req, 'search');

  const db = getDb();
  let query = db.from('works').select('*', { count: 'exact' });

  if (district_id) query = query.eq('district_id', district_id);
  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1);

  const { data, error, count: total } = await query;
  if (error) throw new Error(`works list: ${error.message}`);

  res.json({
    data: data ?? [],
    meta: {
      total: total ?? 0,
      page,
      page_size,
      has_more: (total ?? 0) > page * page_size,
    },
  });
});

/**
 * GET /works/duplicate-check/status — whether semantic duplicate detection is configured.
 *
 * Literal path, declared before `/:id` so it is never captured as a work id. 200 with
 * `available: false` when no credential is set rather than a 503, so the UI renders an honest
 * disabled state instead of an action whose every use fails. Same contract as
 * `/api/photos/status` and `/api/documents/status`.
 */
router.get('/duplicate-check/status', async (_req, res) => {
  res.json({ data: duplicateCheckCapability() });
});

/**
 * POST /works/:id/duplicate-check — rank same-district peers by semantic similarity of text.
 *
 * Body, all optional: `{ threshold?: number, limit?: number }`. Both are clamped in the
 * service (threshold to 0..1, limit to 1..50), so an out-of-range tuning value is corrected
 * rather than rejected.
 *
 * The credential check comes first, before the work is even looked up, so a keyless deployment
 * answers "not configured" rather than a 404 — same ordering, and same reason, as
 * `POST /api/photos/:id/analyze`.
 *
 * This raises no alert and touches no district alert budget. It is a findings-not-alerts
 * capability that ranks candidates for a human, alongside — not replacing — the deterministic
 * R-009 detector, whose own alerts are reported per candidate as `also_flagged_by_r009`.
 */
router.post('/:id/duplicate-check', async (req, res) => {
  if (!isConfigured()) {
    const cap = duplicateCheckCapability();
    throw new ApiError(503, 'LLM_UNCONFIGURED', cap.reason ?? 'Model not configured.', {
      status: cap,
    });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const threshold = typeof body['threshold'] === 'number' ? body['threshold'] : undefined;
  const limit = typeof body['limit'] === 'number' ? body['limit'] : undefined;

  const data = await duplicateCheck(req.params['id'] ?? '', actorOf(req), { threshold, limit });
  res.json({ data });
});

/** GET /works/:id — work detail with alerts, payments, documents */
router.get('/:id', async (req, res) => {
  const work = await get<Work>('works', { id: req.params['id'] });
  notFound(work, 'Work', req.params['id'] ?? '');

  const [alerts, payments, documents] = await Promise.all([
    all<Alert>('alerts', { where: { work_id: work.id }, orderBy: 'severity_rank' }),
    // Ordered by sequence, not by date. Sequence is the stage's position in the
    // work's own history and is what the detail page renders in its '#' column;
    // two releases settled on the same date would otherwise come back in an
    // arbitrary order and be numbered inconsistently between requests.
    all<Payment>('payments', { where: { work_id: work.id }, orderBy: 'sequence_number' }),
    all<Document>('documents', { where: { work_id: work.id }, orderBy: 'uploaded_at' }),
  ]);

  res.json({
    data: {
      ...work,
      alerts,
      payments,
      documents,
    },
  });
});

export default router;
