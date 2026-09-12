/**
 * Run the analysis locally against the live database, and report the before /
 * after alert counts per rule.
 *
 * Local rather than `POST /api/analyze` on Render deliberately: the fix to
 * `services/alerts.ts` that stops probation being ignored by the four
 * corpus-wide detectors is not deployed, so hitting the hosted backend would
 * exercise the old path. The alerts land in the same database either way.
 */
import { createClient } from '@supabase/supabase-js';
import { runAnalyze } from './src/services/alerts.ts';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapshot() {
  let data;
  for (let i = 1; ; i++) {
    try {
      const res = await db.rpc('drishti_readonly_select', {
        query_text: `SELECT COALESCE(rule_id, '(none)') AS rule_id, status, COUNT(*) AS n
                       FROM public.alerts GROUP BY 1, 2`,
        timeout_ms: 9000,
      });
      if (res.error?.code) throw new Error(`${res.error.code}: ${res.error.message}`);
      if (!res.error) { data = res.data; break; }
      throw new Error(res.error.message);
    } catch (e) {
      if (i >= 5) throw e;
      await sleep(500 * i);
    }
  }
  const byRule = new Map();
  for (const r of data) {
    const cur = byRule.get(r.rule_id) ?? { total: 0, OPEN: 0, BACKLOG: 0, other: 0 };
    cur.total += Number(r.n);
    if (r.status === 'OPEN' || r.status === 'BACKLOG') cur[r.status] += Number(r.n);
    else cur.other += Number(r.n);
    byRule.set(r.rule_id, cur);
  }
  return byRule;
}

const before = await snapshot();
console.log('running analysis...\n');
const summary = await runAnalyze('seed_verification');
const after = await snapshot();

console.log(JSON.stringify(summary, null, 2), '\n');
console.log('rule        before -> after     open   backlog   reviewed');
const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
let tb = 0, ta = 0;
for (const id of ids) {
  const b = before.get(id) ?? { total: 0 };
  const a = after.get(id) ?? { total: 0, OPEN: 0, BACKLOG: 0, other: 0 };
  tb += b.total; ta += a.total;
  const delta = a.total - b.total;
  console.log(
    `${id.padEnd(26)} ${String(b.total).padStart(5)} -> ${String(a.total).padStart(5)}` +
      ` ${(delta === 0 ? '' : delta > 0 ? `+${delta}` : String(delta)).padStart(6)}` +
      `   ${String(a.OPEN ?? 0).padStart(4)}   ${String(a.BACKLOG ?? 0).padStart(7)}   ${String(a.other ?? 0).padStart(8)}`,
  );
}
console.log(`${'TOTAL'.padEnd(26)} ${String(tb).padStart(5)} -> ${String(ta).padStart(5)}`);
