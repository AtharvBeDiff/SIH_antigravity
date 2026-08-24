/**
 * Meta Router — GET /meta
 * Returns system metadata, districts, demo mode flag.
 * This unblocks the frontend's AppStateProvider.
 */

import { Router } from 'express';
import { getDb, count } from '../db.ts';
import { SCHEMA_VERSION } from '../db.ts';
import { nowIso } from '../util.ts';
import type { MetaResponse, District } from '../types.ts';

const router = Router();

router.get('/', async (_req, res) => {
  const db = getDb();

  // Fetch districts
  const { data: districts, error: dErr } = await db
    .from('districts')
    .select('*')
    .order('name');
  if (dErr) throw new Error(`meta districts: ${dErr.message}`);

  // Fetch meta singleton
  const { data: meta, error: mErr } = await db
    .from('meta')
    .select('*')
    .eq('id', 'singleton')
    .single();
  if (mErr) throw new Error(`meta singleton: ${mErr.message}`);

  const totalWorks = await count('works');

  const response: MetaResponse = {
    schema_version: SCHEMA_VERSION,
    demo_mode: meta?.demo_mode ?? true,
    is_synthetic: meta?.is_synthetic ?? true,
    districts: (districts ?? []) as District[],
    total_works: totalWorks,
    last_ingest: meta?.last_ingest ?? null,
    server_time: nowIso(),
  };

  res.json({ data: response });
});

export default router;
