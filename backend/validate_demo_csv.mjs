/**
 * Validate demo/esakshi_demo_batch.csv against the real ingest parser.
 *
 * `parsePaymentHistory` is imported from the router itself so the payment cells
 * are checked by the code that will actually read them. `parseCsvLine` is not
 * exported, so it is copied verbatim below — if that function ever changes, this
 * check goes stale, which is why the field-count assertion matters more than the
 * values it produces.
 */
import { parsePaymentHistory } from './src/routers/ingest.ts';
import { readFileSync } from 'node:fs';

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += char;
  }
  result.push(current.trim());
  return result;
}

const csv = readFileSync(process.argv[2], 'utf8');
const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
const headers = parseCsvLine(lines[0]);
console.log(`headers: ${headers.length}\n`);

const today = new Date('2026-09-11');
const days = (d) => d ? Math.floor((today - new Date(d)) / 86400000) : null;
const months = (d) => d ? Math.floor(days(d) / 30.44) : null;

const VALID = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED'];
let dropped = 0, noRecDate = 0, badStatus = 0, rejects = 0;

for (let i = 1; i < lines.length; i++) {
  const v = parseCsvLine(lines[i]);
  if (v.length < headers.length) {
    console.log(`ROW ${i}: DROPPED — ${v.length} fields, need ${headers.length}`);
    dropped++; continue;
  }
  const r = Object.fromEntries(headers.map((h, k) => [h, v[k] || '']));
  const n = (x) => parseFloat(r[x] || '0');
  const fires = [];

  // Arithmetic mirrored from the rule params in src/rules/mplads_rules.yaml.
  const sanctioned = n('sanctioned_amount'), released = n('released_amount');
  const spent = n('expenditure'), prog = n('physical_progress_pct');
  const status = r.status.toUpperCase();

  if (spent > sanctioned * 1.10) fires.push(`R-004 CRITICAL (spent ${((spent / sanctioned - 1) * 100).toFixed(0)}% over)`);
  if (status === 'COMPLETED' && r.has_uc !== 'true' && days(r.completion_date) > 90)
    fires.push(`R-003 MEDIUM (no UC, ${days(r.completion_date)}d past completion)`);
  if (status === 'IN_PROGRESS' && prog >= 10 && spent === 0) fires.push('R-005 MEDIUM (progress, zero spend)');
  if (['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD'].includes(status) && r.sanction_date && months(r.sanction_date) > 12)
    fires.push(`R-006 HIGH (${months(r.sanction_date)} months since sanction)`);
  if (status === 'COMPLETED' && prog < 80) fires.push(`R-008 MEDIUM (complete at ${prog}%)`);
  if (!r.sanction_date && r.recommended_date && days(r.recommended_date) > 45
      && ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].includes(status))
    fires.push(`R-020 CRITICAL (${days(r.recommended_date)}d awaiting decision)`);

  const { payments, errors } = parsePaymentHistory(r.payment_history, 'x');
  const nonAdvance = payments.filter((p) => p.stage !== 'MOBILISATION_ADVANCE')
    .reduce((s, p) => s + p.amount, 0);
  const gap = sanctioned ? (nonAdvance / sanctioned) * 100 - prog : 0;
  if (status === 'IN_PROGRESS' && nonAdvance >= 100000 && gap > 40)
    fires.push(`R-002 HIGH (paid ${(nonAdvance / sanctioned * 100).toFixed(0)}% vs ${prog}% progress, gap ${gap.toFixed(0)}pp)`);

  const lastPay = payments.length ? payments.map((p) => p.payment_date).sort().at(-1) : r.sanction_date;
  if (['IN_PROGRESS', 'NOT_STARTED'].includes(status) && lastPay && days(lastPay) > 180)
    fires.push(`R-007 HIGH (${days(lastPay)}d since last payment)`);

  if (!r.recommended_date) { noRecDate++; fires.push('-> counted: no recommendation date'); }
  if (r.status && !VALID.includes(status)) { badStatus++; fires.push(`-> reported: status '${r.status}' unrecognised`); }
  if (errors.length) { rejects += errors.length; for (const e of errors) fires.push(`-> rejected payment: ${e}`); }

  console.log(`${r.work_id}  ${payments.length} payment(s)`);
  console.log(fires.length ? fires.map((f) => '    ' + f).join('\n')
                           : '    no fire from the checks modelled here');
}

console.log(`\nrows dropped for field count: ${dropped}`);
console.log(`works without recommendation date: ${noRecDate}`);
console.log(`unrecognised statuses: ${badStatus}`);
console.log(`payment entries rejected: ${rejects}`);

// Which rules this file does NOT model, so "no fire" is never read as "clean".
//
// Every check above is per-row arithmetic. R-001 is not: it is a MAD z-score of
// the work's cost against the median for its (district, category) peer group,
// which cannot be evaluated without the rest of the corpus. ESK-9002 is built as
// its exemplar — ₹1.45 Cr in DIST_104 ROADS_BRIDGES, against a median of about
// ₹11.7 lakh in the current corpus — and prints no fire here purely because the
// peer group is absent. Only a live ingest settles it.
console.log(`
NOT CHECKED HERE: R-001 (cost outlier, needs the peer group), and every rule
that reads a table this CSV does not populate — documents, inspections, photos,
embeddings. A row printing "no fire" is only clean with respect to the ~9
per-row rules mirrored above.`);
