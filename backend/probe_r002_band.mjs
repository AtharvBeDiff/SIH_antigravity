/**
 * Why does the projection raise 3 R-002 candidates when the SQL band says ~11?
 *
 * Prints, for every work the SQL says should fire, the exact inputs the rule
 * reads: the seeded non-advance total against works.released_amount.
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await db.rpc('drishti_readonly_select', {
  query_text: `
    SELECT id, status, sanctioned_amount, released_amount, physical_progress_pct,
           (released_amount / sanctioned_amount * 100) - physical_progress_pct AS gap_full,
           ((released_amount - LEAST(released_amount, sanctioned_amount * 0.10))
             / sanctioned_amount * 100) - physical_progress_pct AS gap_ex_advance
      FROM public.works
     WHERE sanctioned_amount > 0 AND released_amount >= 100000
       AND physical_progress_pct IS NOT NULL
       AND (released_amount / sanctioned_amount * 100) - physical_progress_pct > 40
     ORDER BY gap_ex_advance DESC`,
  timeout_ms: 9000,
});
if (error) throw new Error(`${error.code}: ${error.message}`);

console.log(`${data.length} works clear the threshold before the advance is deducted\n`);
console.log('status        sanctioned    released  prog   gap_full  gap_ex_adv  fires?');
for (const w of data) {
  const fires = Number(w.gap_ex_advance) > 40 ? 'YES' : 'no';
  console.log(
    `${String(w.status).padEnd(12)} ${String(w.sanctioned_amount).padStart(11)} ` +
      `${String(w.released_amount).padStart(11)} ${String(w.physical_progress_pct).padStart(5)} ` +
      `${Number(w.gap_full).toFixed(1).padStart(9)} ${Number(w.gap_ex_advance).toFixed(1).padStart(11)}  ${fires}`,
  );
}

const flips = data.filter((w) => Number(w.gap_ex_advance) <= 40).length;
console.log(`\n${data.length - flips} fire with the advance deducted; ${flips} are suppressed by it alone.`);
