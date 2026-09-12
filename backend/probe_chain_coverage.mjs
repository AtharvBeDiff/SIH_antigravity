/**
 * Does the audit chain actually commit to WHO did WHAT?
 *
 * Replays the exact verifyChain() logic from services/audit_chain.ts against an
 * in-memory chain, then mutates one field at a time to see which mutations the
 * verifier catches and which it waves through.
 */
import { canonicalJson, sha256 } from './src/util.ts';

const GENESIS = '0'.repeat(64);

function build(events) {
  const rows = [];
  let prev = GENESIS;
  events.forEach((e, i) => {
    const seq = i + 1;
    const payload_hash = sha256(canonicalJson(e.payload));
    const this_hash = sha256(`${seq}|${prev}|${payload_hash}`);
    rows.push({ ...e, seq, payload_hash, prev_hash: prev, this_hash });
    prev = this_hash;
  });
  return rows;
}

// Verbatim from verifyChain(), audit_chain.ts:140-221.
function verify(rows) {
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.seq !== i + 1) return `SEQUENCE_GAP at ${row.seq}`;
    if (row.prev_hash !== prev) return `PREV_HASH_MISMATCH at ${row.seq}`;
    if (row.payload_hash !== sha256(canonicalJson(row.payload))) return `PAYLOAD_TAMPERED at ${row.seq}`;
    if (row.this_hash !== sha256(`${row.seq}|${row.prev_hash}|${row.payload_hash}`)) return `HASH_MISMATCH at ${row.seq}`;
    prev = row.this_hash;
  }
  return 'VALID — chain verifies clean';
}

const base = () => build([
  { actor: 'officer_meena', action: 'ALERT_DISMISSED', entity_type: 'alert',
    entity_id: 'A-1', payload: { reason: 'verified on site' }, created_at: '2026-09-01T10:00:00Z' },
  { actor: 'officer_rao', action: 'ALERT_ACCEPTED', entity_type: 'alert',
    entity_id: 'A-2', payload: { reason: 'cost overrun confirmed' }, created_at: '2026-09-02T11:00:00Z' },
]);

console.log('baseline                          ->', verify(base()));

const tests = [
  ['payload edited (what the demo does)', (r) => { r[0].payload = { reason: 'HACKED' }; }],
  ['ACTOR swapped meena -> rao', (r) => { r[0].actor = 'officer_rao'; }],
  ['ACTION flipped DISMISSED -> ACCEPTED', (r) => { r[0].action = 'ALERT_ACCEPTED'; }],
  ['ENTITY_ID repointed A-1 -> A-99', (r) => { r[0].entity_id = 'A-99'; }],
  ['CREATED_AT backdated by a year', (r) => { r[0].created_at = '2025-09-01T10:00:00Z'; }],
  ['last block deleted (truncation)', (r) => { r.pop(); }],
];

for (const [label, mutate] of tests) {
  const rows = base();
  mutate(rows);
  console.log(label.padEnd(34), '->', verify(rows));
}
