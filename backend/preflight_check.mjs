import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const q = async (label, sql) => {
  const { data, error } = await db.rpc('drishti_readonly_select', { query_text: sql, timeout_ms: 9000 });
  console.log(`${label.padEnd(46)} ${error ? `ERROR ${error.code}: ${error.message}` : JSON.stringify(data)}`);
};

// For each never-fired rule: does the CONDITION exist in the corpus at all?
// Distinguishes "structurally dead, no data source" from "no work happens to match".
await q('R-005: IN_PROGRESS, progress>=10, spend=0', `
  SELECT COUNT(*) AS n FROM public.works
   WHERE status='IN_PROGRESS' AND physical_progress_pct >= 10 AND COALESCE(expenditure,0) = 0`);
await q('R-015: works ON_HOLD', `
  SELECT COUNT(*) AS n FROM public.works WHERE status='ON_HOLD'`);
await q('R-016: SCSP/TSP flagged works', `
  SELECT COUNT(*) FILTER (WHERE is_scsp) AS scsp, COUNT(*) FILTER (WHERE is_tsp) AS tsp
    FROM public.works`);
await q('R-020/021: awaiting sanction (no sanction_date)', `
  SELECT COUNT(*) AS n FROM public.works
   WHERE sanction_date IS NULL AND recommended_date IS NOT NULL`);

// R-012 fired 18x but payments is empty — are those alerts stale?
await q('R-012 alerts vs live works', `
  SELECT COUNT(*) AS r012_alerts,
         COUNT(*) FILTER (WHERE w.id IS NULL) AS pointing_at_deleted_works
    FROM public.alerts a LEFT JOIN public.works w ON w.id = a.work_id
   WHERE a.rule_id = 'R-012'`);
await q('ALL alerts pointing at deleted works', `
  SELECT COUNT(*) AS orphaned FROM public.alerts a
   LEFT JOIN public.works w ON w.id = a.work_id WHERE w.id IS NULL`);
