/**
 * Digest Router — GET /digest, POST /digest/generate, GET /digest/:id
 */

import { Router } from 'express';
import { getDb, get, insert } from '../db.ts';
import { paging, qstr, notFound } from '../http.ts';
import { newId, nowIso } from '../util.ts';
import type { DigestSummary } from '../types.ts';

const router = Router();

/** GET /digest — list past digests */
router.get('/', async (req, res) => {
  const { page, page_size } = paging(req);
  const district_id = qstr(req, 'district_id');

  const db = getDb();
  let query = db.from('digest_history').select('id, district_id, generated_at, period_start, period_end', { count: 'exact' });
  if (district_id) query = query.eq('district_id', district_id);

  query = query
    .order('generated_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1);

  const { data, error, count: total } = await query;
  if (error) throw new Error(`digest list: ${error.message}`);

  res.json({
    data: data ?? [],
    meta: { total: total ?? 0, page, page_size, has_more: (total ?? 0) > page * page_size },
  });
});

/** POST /digest/generate — trigger digest generation (placeholder) */
router.post('/generate', async (req, res) => {
  const district_id = req.body['district_id'] as string;
  if (!district_id) return res.status(400).json({ error: { code: 'MISSING_DISTRICT', message: 'district_id is required' } });

  // Generate placeholder HTML
  const html = `<html><body><h1>Digest for District ${district_id}</h1><p>Generated at ${nowIso()}</p></body></html>`;
  const digestId = newId();
  
  const digest = {
    id: digestId,
    district_id,
    generated_at: nowIso(),
    period_start: nowIso().slice(0, 10), // Placeholder
    period_end: nowIso().slice(0, 10),
    html,
  };

  await insert('digest_history', digest);
  res.json({ data: { id: digestId, ...digest, html: undefined } }); // Don't return full HTML in list
});

/** GET /digest/:id — download digest HTML */
router.get('/:id', async (req, res) => {
  const digest = await get<DigestSummary>('digest_history', { id: req.params['id'] });
  notFound(digest, 'Digest', req.params['id'] ?? '');

  // If client wants JSON metadata
  if (req.accepts('json') && !req.accepts('html')) {
    return res.json({ data: digest });
  }

  // Return raw HTML for browser viewing/downloading
  res.setHeader('Content-Type', 'text/html');
  res.send(digest.html);
});

export default router;
