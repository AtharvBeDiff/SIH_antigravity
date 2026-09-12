/**
 * Blast-radius probe: what does `POST /api/analyze` do to the corpus TODAY,
 * before any seeding?
 *
 * Two rules are armed and have simply not been re-run. Both read a table that is
 * empty, and both treat "empty" as a finding rather than as unknown:
 *
 *   R-014  `paymentsByWork.get(w.id) ?? []` in alerts.ts means `history` is never
 *          null, so `history.count === 0` is true for every work — and `payments`
 *          has zero rows.
 *   R-019  `lastReportDateByWork()` returns an empty Map, and an empty Map is
 *          truthy, so the `if (lastReportDate && ...)` guard passes.
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const q = async (label, sql) => {
  const { data, error } = await db.rpc('drishti_readonly_select', { query_text: sql, timeout_ms: 9000 });
  console.log(`${label}\n    ${error ? `ERROR ${error.code}: ${error.message}` : JSON.stringify(data)}\n`);
};

await q('R-014 BLAST RADIUS (sanction_date > 90d ago, zero payments)', `
  SELECT COUNT(*) AS would_fire FROM public.works
   WHERE sanction_date IS NOT NULL AND sanction_date < CURRENT_DATE - 90`);

await q('  ...split by status', `
  SELECT status, COUNT(*) AS n FROM public.works
   WHERE sanction_date IS NOT NULL AND sanction_date < CURRENT_DATE - 90
   GROUP BY status ORDER BY n DESC`);

await q('R-012 blast radius (>= Rs 25L sanctioned, >= 50% progress)', `
  SELECT COUNT(*) AS would_fire FROM public.works
   WHERE sanctioned_amount >= 2500000 AND physical_progress_pct >= 50`);

await q('payments columns in the LIVE db (is 008 really applied?)', `
  SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='payments' ORDER BY ordinal_position`);

await q('sanction_date coverage and range', `
  SELECT COUNT(sanction_date) AS with_sd, MIN(sanction_date) AS oldest,
         MAX(sanction_date) AS newest FROM public.works`);
