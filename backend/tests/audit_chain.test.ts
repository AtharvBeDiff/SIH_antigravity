import { test } from 'node:test';
import * as assert from 'node:assert';
import 'dotenv/config';
import { canonicalJson, sha256 } from '../src/util.ts';
import { getDb } from '../src/db.ts';
import { appendAudit, verifyChain, demoTamper, demoRestore, chainHead } from '../src/services/audit_chain.ts';

test('audit_chain formula logic (pure math)', () => {
  const GENESIS_PREV_HASH = '0'.repeat(64);
  const payload = { test: 123, obj: { a: 1 } };
  
  const payload_hash = sha256(canonicalJson(payload));
  const expectedPayloadHash = '36d0921cdf469500862fc361292fa150e1b3f7e11849d980a501a89b4d602eb0';
  assert.strictEqual(payload_hash, expectedPayloadHash);

  const seq = 1;
  const this_hash = sha256(`${seq}|${GENESIS_PREV_HASH}|${payload_hash}`);
  
  assert.ok(this_hash.length === 64);
  
  // Seq 2
  const seq2 = 2;
  const payload2 = {};
  const payload_hash2 = sha256(canonicalJson(payload2));
  const this_hash2 = sha256(`${seq2}|${this_hash}|${payload_hash2}`);
  
  assert.ok(this_hash2 !== this_hash);
});

/*
  These tests append to the live `audit_events` table, and the runner executes
  test *files* in parallel — several of which append too. So between this test's
  two appends, another file's event can legitimately land in between.

  The assertions used to be `evt2.seq === evt1.seq + 1` and
  `evt2.prev_hash === evt1.this_hash`, which hold only if nothing else writes in
  that window. They failed intermittently, and the failure said nothing about
  the chain: interleaving is what an append-only log is *for*.

  What is actually invariant, and what is asserted now: an event links to
  whatever row precedes it, whoever wrote that row. That is the property
  `verifyChain` walks, and it is checked here against the database rather than
  against this test's own previous return value.
*/
test('audit_chain database append and verify integrity', async () => {
  const evt1 = await appendAudit('officer_test', 'TEST_ACTION_1', 'work', 'test_work_1', { status: 'APPROVED', amount: 50000 });
  assert.ok(evt1.seq >= 1);
  assert.ok(evt1.this_hash.length === 64);

  const evt2 = await appendAudit('officer_test', 'TEST_ACTION_2', 'work', 'test_work_1', { status: 'IN_PROGRESS', progress: 25 });

  // Strictly later, not necessarily adjacent.
  assert.ok(evt2.seq > evt1.seq, `evt2.seq ${evt2.seq} should follow evt1.seq ${evt1.seq}`);

  // And linked to its real predecessor — read back, not assumed.
  const { data: predecessor, error } = await getDb()
    .from('audit_events')
    .select('this_hash')
    .eq('seq', evt2.seq - 1)
    .single();
  assert.ok(!error, `predecessor at seq ${evt2.seq - 1} should exist: ${error?.message}`);
  assert.strictEqual(evt2.prev_hash, predecessor!.this_hash);

  // Verify chain passes
  const verification = await verifyChain();
  assert.strictEqual(verification.valid, true);
  assert.strictEqual(verification.first_break, null);
  assert.ok(verification.checked >= 2);
});

test('audit_chain tamper detection and restoration', async () => {
  process.env['DEMO_MODE'] = 'true';
  const head = await chainHead();
  assert.ok(head, 'Chain should have events');

  // Verify valid before tamper
  const initialVerify = await verifyChain();
  assert.strictEqual(initialVerify.valid, true);

  // Tamper head
  await demoTamper(head.seq);
  
  // Verify detects tampering
  const tamperedVerify = await verifyChain();
  assert.strictEqual(tamperedVerify.valid, false);
  assert.ok(tamperedVerify.first_break !== null);
  assert.strictEqual(tamperedVerify.first_break.seq, head.seq);

  // Restore
  await demoRestore(head.seq);

  // Verify returns to valid
  const restoredVerify = await verifyChain();
  assert.strictEqual(restoredVerify.valid, true);
  assert.strictEqual(restoredVerify.first_break, null);
});
