/**
 * Post a CSV to the running dev server's ingest endpoint and print the result.
 *
 * Exists because the endpoint takes `{ csv: string }` in a JSON body rather than
 * a multipart upload, which makes it awkward to exercise from curl on Windows:
 * the CSV has to be JSON-escaped, and a shell-quoted heredoc mangles the commas
 * and the embedded `|` in the payment_history column. Reading the file and
 * building the body here keeps the request byte-identical to what the frontend
 * sends.
 *
 * Usage: node post_ingest.mjs [path-to-csv] [base-url]
 */

const csvPath = process.argv[2] ?? '../demo/esakshi_demo_batch.csv';
const base = process.argv[3] ?? 'http://localhost:4000';

const { readFileSync } = await import('node:fs');
const csv = readFileSync(csvPath, 'utf8');

const started = Date.now();
const res = await fetch(`${base}/api/ingest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ csv }),
});
const elapsed = Date.now() - started;

const text = await res.text();
console.log(`HTTP ${res.status} in ${elapsed} ms`);

let body;
try {
  body = JSON.parse(text);
} catch {
  console.log(text.slice(0, 4000));
  process.exit(res.ok ? 0 : 1);
}

const d = body.data ?? body;
const findings = d.findings ?? null;

// Findings are printed as a table rather than raw JSON: the point of the change
// is that an operator can read what was found on their own rows, so the check
// should look like what they would see.
const { findings: _omit, ...rest } = d;
console.log(JSON.stringify(rest, null, 2));

if (findings === null) {
  console.log('\nNO `findings` KEY IN RESPONSE — server is running pre-edit code.');
  process.exit(1);
}

console.log(`\nfindings: ${findings.length}`);
const byStatus = {};
const byRule = {};
for (const f of findings) {
  byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  byRule[f.rule_id] = (byRule[f.rule_id] ?? 0) + 1;
}
console.log('by status:', JSON.stringify(byStatus));
console.log('by rule:  ', JSON.stringify(byRule));
console.log();
for (const f of findings) {
  console.log(
    `${f.esakshi_work_id.padEnd(9)} ${f.rule_id.padEnd(7)} ${String(f.severity).padEnd(8)} ` +
      `${String(f.status).padEnd(8)} ${f.evidence_text}`,
  );
}
