/**
 * Alerts Router — GET /alerts, GET /alerts/:id, PATCH /alerts/:id
 * Queue ordered by severity_rank ASC, created_at ASC.
 */

import { Router } from 'express';
import { getDb, get, update } from '../db.ts';
import { qstr, qnum, qbool, paging, notFound, actorOf, requireBody, requireOneOf } from '../http.ts';
import { appendAudit } from '../services/audit_chain.ts';
import { nowIso, newId } from '../util.ts';
import { ALERT_STATUSES, DISMISS_REASON_CODES } from '../types.ts';
import type { Alert, AlertStatus, DismissReasonCode } from '../types.ts';

const router = Router();

/** GET /alerts — queue ordered by severity_rank DESC, created_at ASC */
router.get('/', async (req, res) => {
  const { page, page_size } = paging(req);
  const district_id = qstr(req, 'district_id');
  const status = qstr(req, 'status');
  const severity = qstr(req, 'severity');
  const in_budget = qbool(req, 'in_budget');

  const db = getDb();
  let query = db.from('alerts').select(`
    *,
    works!inner(title, district_id, category, status, sanctioned_amount)
  `, { count: 'exact' });

  if (district_id) query = query.eq('works.district_id', district_id);
  if (status) query = query.eq('status', status);
  if (severity) query = query.eq('severity', severity);
  if (in_budget !== undefined) query = query.eq('in_budget', in_budget);

  query = query
    .order('severity_rank', { ascending: true })
    .order('created_at', { ascending: true })
    .range((page - 1) * page_size, page * page_size - 1);

  const { data, error, count: total } = await query;
  if (error) throw new Error(`alerts list: ${error.message}`);

  res.json({
    data: data ?? [],
    meta: { total: total ?? 0, page, page_size, has_more: (total ?? 0) > page * page_size },
  });
});

/** GET /alerts/:id — alert detail with evidence */
router.get('/:id', async (req, res) => {
  const alert = await get<Alert>('alerts', { id: req.params['id'] });
  notFound(alert, 'Alert', req.params['id'] ?? '');
  res.json({ data: alert });
});

/** PATCH /alerts/:id — officer review (dismiss, acknowledge, escalate) */
router.patch('/:id', async (req, res) => {
  const actor = actorOf(req);
  const body = requireBody(req);
  const action = requireOneOf(body, 'action', ['ACKNOWLEDGED', 'DISMISSED', 'ESCALATED'] as const);

  const alert = await get<Alert>('alerts', { id: req.params['id'] });
  notFound(alert, 'Alert', req.params['id'] ?? '');

  const updates: Record<string, unknown> = {
    status: action,
    reviewed_by: actor,
    reviewed_at: nowIso(),
    updated_at: nowIso(),
  };

  if (action === 'DISMISSED') {
    const reason = requireOneOf(body, 'reason_code', DISMISS_REASON_CODES);
    updates['dismiss_reason'] = reason;
    updates['dismiss_note'] = typeof body['note'] === 'string' ? body['note'] : null;
  }

  const [updated] = await update<Alert>('alerts', { id: alert.id }, updates);

  // Record review action
  const db = getDb();
  await db.from('review_actions').insert({
    id: newId(),
    alert_id: alert.id,
    action,
    actor,
    reason_code: updates['dismiss_reason'] ?? null,
    note: updates['dismiss_note'] ?? null,
    created_at: nowIso(),
  });

  // Audit trail
  await appendAudit(actor, `ALERT_${action}`, 'alert', alert.id, {
    previous_status: alert.status,
    new_status: action,
    reason_code: updates['dismiss_reason'] ?? null,
  });

  res.json({ data: updated });
});

export default router;
