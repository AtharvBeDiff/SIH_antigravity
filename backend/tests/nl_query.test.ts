/**
 * NL-query pipeline tests — everything except the network call.
 *
 * `answerQuestion` takes its model client as a parameter precisely so this file can
 * exist: prompt construction, SQL extraction, the guard boundary and the schema/allowlist
 * agreement are all testable with no Gemini credential and no database. A feature whose
 * only test is "it works when the key is set" has no tests, and the key on this box is
 * expected to rotate.
 *
 * What is deliberately NOT tested here: execution. That needs Postgres, and the
 * guarantee it carries — `SET TRANSACTION READ ONLY` — is verified by the three queries
 * at the foot of `supabase/migrations/012_readonly_sql_role.sql`, which must be run
 * against a real database because the whole point is that Postgres enforces it rather
 * than application code.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { ApiError } from '../src/http.ts';
import { READABLE_RELATIONS, FORBIDDEN_COLUMNS } from '../src/services/sql_guard.ts';
import {
  extractSql,
  systemPrompt,
  schemaCoversAllowlist,
  answerQuestion,
  capability,
  type GenerateFn,
} from '../src/services/nl_query.ts';

/** A model that always returns the given text, with plausible metadata. */
function stubModel(text: string): GenerateFn {
  return async () => ({ text, model: 'stub-model', latency_ms: 1, attempts: 1 });
}

// ─── extractSql: recover the query from however the model wrapped it ─────────

test('extractSql passes bare SQL through unchanged', () => {
  assert.strictEqual(extractSql('SELECT id FROM works'), 'SELECT id FROM works');
});

test('extractSql unwraps a ```sql fence', () => {
  assert.strictEqual(
    extractSql('```sql\nSELECT id FROM works\n```'),
    'SELECT id FROM works',
  );
});

test('extractSql unwraps an untagged fence', () => {
  assert.strictEqual(extractSql('```\nSELECT id FROM works\n```'), 'SELECT id FROM works');
});

test('extractSql drops prose that precedes the statement', () => {
  assert.strictEqual(
    extractSql('Here is the query you asked for:\n\nSELECT id FROM works'),
    'SELECT id FROM works',
  );
});

test('extractSql prefers the fenced block over surrounding prose', () => {
  const out = extractSql('Sure! Here you go:\n```sql\nSELECT count(*) FROM alerts\n```\nHope that helps.');
  assert.strictEqual(out, 'SELECT count(*) FROM alerts');
});

test('extractSql is lenient, not permissive — leniency cannot admit a bad query', () => {
  // It happily unwraps this. The guard is what refuses it, one layer later, and the
  // test below proves that ordering holds end to end.
  assert.strictEqual(extractSql('```sql\nDROP TABLE works\n```'), 'DROP TABLE works');
});

// ─── The prompt: what the model is and is not told ───────────────────────────

test('the prompt describes every allowlisted relation', () => {
  const { missing } = schemaCoversAllowlist();
  assert.deepStrictEqual(
    missing,
    [],
    'a relation the guard allows but the prompt omits is a relation the model will never query',
  );
});

test('the prompt never names a Doctrine 3 column', () => {
  // Naming a forbidden column in a prompt — even to prohibit it — puts it in the model's
  // context. Doctrine 3 is expressed as a property of the domain instead: accountability
  // attaches to the agency and the district.
  const prompt = systemPrompt();
  for (const col of FORBIDDEN_COLUMNS) {
    assert.ok(!prompt.includes(col), `prompt must not mention ${col}`);
  }
});

test('the prompt never names a relation the guard would refuse', () => {
  const prompt = systemPrompt();
  for (const forbidden of ['constituencies', 'audit_events', 'answer_key']) {
    assert.ok(
      !prompt.includes(forbidden),
      `prompt must not mention ${forbidden} — a model told about a table it must not read ` +
        'will eventually read it',
    );
  }
});

test('the prompt states the single-SELECT and no-CTE constraints', () => {
  const prompt = systemPrompt();
  assert.match(prompt, /single SELECT/i);
  assert.match(prompt, /No WITH/i);
});

// ─── The boundary: a hostile model cannot get past the guard ─────────────────

/** Runs `answerQuestion` with a stubbed model and asserts the guard refused. */
async function assertGuardRefuses(modelOutput: string, why: string): Promise<void> {
  await assert.rejects(
    () => answerQuestion('anything', 'test-actor', stubModel(modelOutput)),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `${why}: expected ApiError, got ${String(err)}`);
      assert.strictEqual(err.code, 'UNSAFE_QUERY', `${why}: wrong code`);
      return true;
    },
    why,
  );
}

test('a model emitting DELETE is refused before anything executes', async () => {
  await assertGuardRefuses('DELETE FROM works', 'the whole point of the guard');
});

test('a model emitting a stacked statement is refused', async () => {
  await assertGuardRefuses('SELECT id FROM works; DROP TABLE works', 'statement smuggling');
});

test('a model emitting a data-modifying CTE is refused', async () => {
  await assertGuardRefuses(
    'WITH gone AS (DELETE FROM works RETURNING *) SELECT * FROM gone',
    'valid Postgres that deletes the corpus',
  );
});

test('a model persuaded to aggregate by MP is refused (Doctrine 3)', async () => {
  await assertGuardRefuses(
    'SELECT mp_name, count(*) FROM works GROUP BY mp_name ORDER BY count(*) DESC',
    'this is exactly what prompt injection through the question would produce',
  );
});

test('a model reading the audit ledger is refused', async () => {
  await assertGuardRefuses('SELECT * FROM audit_events', 'must be read through /api/audit');
});

test('a model reading the answer key is refused', async () => {
  await assertGuardRefuses('SELECT * FROM answer_key', 'evaluation ground truth');
});

test('a fenced hostile query is unwrapped and then refused', async () => {
  // Proves the ordering: extraction is lenient, the guard is not, and leniency in the
  // first does not weaken the second.
  await assertGuardRefuses(
    '```sql\nSELECT * FROM works; DELETE FROM alerts\n```',
    'unwrapping must not be a bypass',
  );
});

// ─── Input validation happens before the model is called ────────────────────

test('an empty question never reaches the model', async () => {
  let called = false;
  const spy: GenerateFn = async () => {
    called = true;
    return { text: 'SELECT 1', model: 'stub', latency_ms: 0, attempts: 1 };
  };
  await assert.rejects(
    () => answerQuestion('   ', 'test-actor', spy),
    (err: unknown) => err instanceof ApiError && err.code === 'NO_QUESTION',
  );
  assert.strictEqual(called, false, 'no model call should be made for an empty question');
});

test('an over-long question is refused without a model call', async () => {
  let called = false;
  const spy: GenerateFn = async () => {
    called = true;
    return { text: 'SELECT 1', model: 'stub', latency_ms: 0, attempts: 1 };
  };
  await assert.rejects(
    () => answerQuestion('x'.repeat(501), 'test-actor', spy),
    (err: unknown) => err instanceof ApiError && err.code === 'QUESTION_TOO_LONG',
  );
  assert.strictEqual(called, false, 'a 501-char block is more instruction than question');
});

// ─── Capability reporting ───────────────────────────────────────────────────

test('capability reports the limits it actually enforces', () => {
  const cap = capability();
  assert.deepStrictEqual([...cap.readable_relations], [...READABLE_RELATIONS]);
  assert.strictEqual(cap.max_rows, 500);
  assert.ok(typeof cap.model === 'string' && cap.model.length > 0);
});

test('capability explains an absent credential rather than reporting a bare false', () => {
  const cap = capability();
  if (cap.available) {
    assert.strictEqual(cap.reason, null, 'available means no reason to give');
  } else {
    assert.match(cap.reason ?? '', /GEMINI_API_KEY/, 'the reason must name the fix');
  }
});
