/**
 * Works Router — GET /works, GET /works/:id
 */

import { Router } from 'express';
import { getDb, all, get, count } from '../db.ts';
import { qstr, qnum, paging, notFound } from '../http.ts';
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

/** GET /works/:id — work detail with alerts, payments, documents */
router.get('/:id', async (req, res) => {
  const work = await get<Work>('works', { id: req.params['id'] });
  notFound(work, 'Work', req.params['id'] ?? '');

  const [alerts, payments, documents] = await Promise.all([
    all<Alert>('alerts', { where: { work_id: work.id }, orderBy: 'severity_rank' }),
    all<Payment>('payments', { where: { work_id: work.id }, orderBy: 'payment_date' }),
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
