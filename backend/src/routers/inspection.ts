/**
 * Inspection Router — GET /inspections, POST /inspections, GET /inspections/:id
 */

import { Router } from 'express';
import { getDb, get, all, insert, insertMany } from '../db.ts';
import { paging, qstr, notFound, requireBody, actorOf } from '../http.ts';
import { appendAudit } from '../services/audit_chain.ts';
import { newId, nowIso } from '../util.ts';
import type { Inspection, InspectionItem } from '../types.ts';

const router = Router();

/** GET /inspections — list inspections */
router.get('/', async (req, res) => {
  const { page, page_size } = paging(req);
  const work_id = qstr(req, 'work_id');

  const db = getDb();
  let query = db.from('inspections').select('*', { count: 'exact' });
  if (work_id) query = query.eq('work_id', work_id);
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1);

  const { data, error, count: total } = await query;
  if (error) throw new Error(`inspections list: ${error.message}`);

  res.json({
    data: data ?? [],
    meta: { total: total ?? 0, page, page_size, has_more: (total ?? 0) > page * page_size },
  });
});

/** POST /inspections — create or sync inspection from field PWA */
router.post('/', async (req, res) => {
  const actor = actorOf(req);
  const body = requireBody(req);

  const inspectionId = newId();
  const inspection = {
    id: inspectionId,
    work_id: body['work_id'] as string,
    inspector_id: actor,
    inspector_name: (body['inspector_name'] as string) ?? actor,
    inspection_date: (body['inspection_date'] as string) ?? nowIso().slice(0, 10),
    latitude: body['latitude'] as number,
    longitude: body['longitude'] as number,
    overall_status: body['overall_status'] as string,
    notes: (body['notes'] as string) ?? null,
    photo_keys: (body['photo_keys'] as string[]) ?? [],
    synced: true,
    created_at: nowIso(),
  };

  await insert('inspections', inspection);

  // Insert checklist items
  const items = (body['items'] as Array<{ checklist_id: string; checked: boolean; note?: string }>) ?? [];
  if (items.length > 0) {
    const itemRows = items.map(item => ({
      id: newId(),
      inspection_id: inspectionId,
      checklist_id: item.checklist_id,
      checked: item.checked,
      note: item.note ?? null,
    }));
    await insertMany('inspection_items', itemRows);
  }

  await appendAudit(actor, 'INSPECTION_CREATED', 'inspection', inspectionId, {
    work_id: body['work_id'],
    overall_status: body['overall_status'],
  });

  res.status(201).json({ data: { id: inspectionId, ...inspection } });
});

/** GET /inspections/:id — inspection detail with items */
router.get('/:id', async (req, res) => {
  const inspection = await get<Inspection>('inspections', { id: req.params['id'] });
  notFound(inspection, 'Inspection', req.params['id'] ?? '');

  const items = await all<InspectionItem>('inspection_items', {
    where: { inspection_id: inspection.id },
  });

  res.json({ data: { ...inspection, items } });
});

export default router;
