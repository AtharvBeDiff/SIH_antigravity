/**
 * Public Router — GET /public/works, GET /public/works/:id
 * WHITELIST ONLY. Must not leak alerts, severity, officers.
 */

import { Router } from 'express';
import { getDb, get } from '../db.ts';
import { qstr, paging, notFound } from '../http.ts';
import type { PublicWork } from '../types.ts';

const router = Router();

/** 
 * Maps a full work to a PublicWork by EXPLICITLY naming fields.
 * NEVER use `delete` or spread operators to remove fields.
 */
function toPublicWork(work: Record<string, unknown>, districtName: string, constName: string): PublicWork {
  return {
    id: work['id'] as string,
    title: work['title'] as string,
    description: work['description'] as string,
    category: work['category'] as any,
    location_name: work['location_name'] as string,
    status: work['status'] as any,
    physical_progress_pct: work['physical_progress_pct'] as number,
    sanctioned_amount: work['sanctioned_amount'] as number,
    expenditure: work['expenditure'] as number,
    sanction_date: work['sanction_date'] as string,
    actual_completion_date: (work['actual_completion_date'] as string) ?? null,
    district_name: districtName,
    constituency_name: constName,
  };
}

router.get('/works', async (req, res) => {
  const { page, page_size } = paging(req);
  const search = qstr(req, 'search');

  const db = getDb();
  let query = db.from('works').select(`
    *,
    districts (name),
    constituencies (name)
  `, { count: 'exact' });

  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1);

  const { data, error, count: total } = await query;
  if (error) throw new Error(`public works list: ${error.message}`);

  const publicWorks = (data ?? []).map((w: any) => 
    toPublicWork(w, w.districts?.name ?? 'Unknown', w.constituencies?.name ?? 'Unknown')
  );

  res.json({
    data: publicWorks,
    meta: { total: total ?? 0, page, page_size, has_more: (total ?? 0) > page * page_size },
  });
});

router.get('/works/:id', async (req, res) => {
  const db = getDb();
  const { data: work, error } = await db.from('works').select(`
    *,
    districts (name),
    constituencies (name)
  `).eq('id', req.params['id']).maybeSingle();

  if (error) throw new Error(`public works get: ${error.message}`);
  notFound(work, 'Work', req.params['id'] ?? '');

  const publicWork = toPublicWork(work, work.districts?.name ?? 'Unknown', work.constituencies?.name ?? 'Unknown');
  res.json({ data: publicWork });
});

export default router;
