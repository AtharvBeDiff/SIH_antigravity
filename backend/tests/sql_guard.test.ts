/**
 * SQL Guard tests — adversarial, and they must not be weakened.
 *
 * This file stands in the same relation to `services/sql_guard.ts` as
 * `public_leakage.test.ts` does to `services/public_view.ts`: it is the enforcement
 * point for a doctrine, and a change that makes a test here pass by relaxing the guard
 * has broken the product rather than fixed the test.
 *
 * The threat model is specific. `/api/query` accepts a natural-language question,
 * hands it to a language model, and executes the SQL that comes back. The model is
 * *not* trusted — not because it is malicious, but because the question it is
 * translating comes from an unauthenticated HTTP caller (`http.ts` has no
 * authentication) and reaches a client holding the **service-role key, which bypasses
 * every RLS policy**. Prompt injection through the question is therefore a direct
 * path to arbitrary SQL. Every test below is a thing an injected instruction would
 * plausibly produce.
 *
 * Each rejection test asserts on `ApiError` with code `UNSAFE_QUERY` rather than
 * merely `throws`, so a test cannot start passing for the wrong reason — a typo that
 * made the guard throw `TypeError` on every input would otherwise look like a pass.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { ApiError } from '../src/http.ts';
import {
  guardQuery,
  stripCommentsAndLiterals,
  MAX_ROWS,
  READABLE_RELATIONS,
  FORBIDDEN_COLUMNS,
} from '../src/services/sql_guard.ts';

/** Asserts the guard refuses `sql`, with the specific error the API contract promises. */
function assertRejected(sql: string, why: string): void {
  assert.throws(
    () => guardQuery(sql),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `${why}: expected ApiError, got ${String(err)}`);
      assert.strictEqual(err.code, 'UNSAFE_QUERY', `${why}: wrong error code`);
      assert.strictEqual(err.statusCode, 400, `${why}: wrong status`);
      return true;
    },
    why,
  );
}

// ─── The happy path, so the guard is not merely "rejects everything" ──────────

test('guard admits a plain analytical SELECT', () => {
  const g = guardQuery(
    "SELECT district_id, count(*) FROM works WHERE status = 'IN_PROGRESS' GROUP BY district_id",
  );
  assert.deepStrictEqual(g.relations, ['works']);
  assert.match(g.sql, /LIMIT 500$/);
  assert.strictEqual(g.limit_applied, true);
});

test('guard admits joins across allowlisted relations and reports each', () => {
  const g = guardQuery(
    'SELECT a.name, count(*) FROM works w JOIN agencies a ON a.id = w.agency_id GROUP BY a.name',
  );
  assert.deepStrictEqual(g.relations, ['works', 'agencies']);
});

test('guard admits a subquery, and checks the inner relation too', () => {
  const g = guardQuery(
    'SELECT * FROM works WHERE id IN (SELECT work_id FROM alerts WHERE severity = %s)'.replace('%s', "'HIGH'"),
  );
  assert.ok(g.relations.includes('works'));
  assert.ok(g.relations.includes('alerts'));
});

test("a query's own smaller LIMIT is preserved and reported as non-binding", () => {
  const g = guardQuery('SELECT id FROM works ORDER BY sanctioned_amount DESC LIMIT 5');
  assert.strictEqual(g.limit_applied, false, 'LIMIT 5 is below the cap, so the cap is not binding');
  assert.match(g.sql, /LIMIT 5\b/, 'the inner limit must survive — "top five" depends on it');
  assert.match(g.sql, new RegExp(`LIMIT ${MAX_ROWS}$`), 'the cap still wraps it');
});

test('an oversized LIMIT is capped rather than trusted', () => {
  const g = guardQuery('SELECT id FROM works LIMIT 1000000');
  assert.strictEqual(g.limit_applied, true);
  assert.match(g.sql, new RegExp(`LIMIT ${MAX_ROWS}$`));
});

// ─── Statement smuggling ─────────────────────────────────────────────────────

test('rejects a second statement after a semicolon', () => {
  assertRejected(
    'SELECT id FROM works; DROP TABLE works',
    'stacked statement — the classic append-a-write-to-a-read',
  );
});

test('tolerates a trailing semicolon, which models emit habitually', () => {
  const g = guardQuery('SELECT id FROM works;');
  assert.deepStrictEqual(g.relations, ['works']);
});

test('rejects a write hidden behind a line comment and a newline', () => {
  assertRejected(
    'SELECT id FROM works --\n; DELETE FROM works',
    'the newline ends the comment, so the DELETE is live',
  );
});

test('nesting: the stripper must nest exactly as Postgres does', () => {
  // `/* x /* y */ z */` opens to depth two and closes cleanly, so the whole span is
  // comment for Postgres AND for the stripper. Their agreement is the safety property:
  // the classic injection here relies on a stripper that stops at the FIRST `*/` while
  // Postgres keeps nesting, which would leave the tail exposed to Postgres but hidden
  // from the guard. This query is therefore admitted, and admitting it is correct.
  const g = guardQuery('SELECT id FROM works /* outer /* inner */ still comment */');
  assert.deepStrictEqual(g.relations, ['works']);
});

test('rejects an unterminated block comment rather than analysing the prefix', () => {
  // Depth reaches one at end of input. Postgres would reject this as a syntax error,
  // so the guard is being asked to reason about text with no valid interpretation.
  assertRejected(
    'SELECT id FROM works /* /* */ ; DROP TABLE works /* */',
    'unterminated comment — no valid query to reason about',
  );
});

test('rejects an unterminated string literal', () => {
  assertRejected("SELECT id FROM works WHERE title = 'oops", 'unterminated literal');
});

// ─── Leading keyword: the allowlist itself ───────────────────────────────────

for (const stmt of [
  'DELETE FROM works',
  'UPDATE works SET status = %s',
  'INSERT INTO works (id) VALUES (%s)',
  'DROP TABLE works',
  'TRUNCATE works',
  'ALTER TABLE works ADD COLUMN x TEXT',
  'GRANT ALL ON works TO PUBLIC',
  'CREATE TABLE evil (id TEXT)',
  'COPY works TO %s',
  'CALL some_procedure()',
  'DO %s',
  'VACUUM works',
]) {
  test(`rejects a bare ${stmt.split(' ')[0]} statement`, () => {
    assertRejected(stmt.replace('%s', "'x'"), 'not a SELECT');
  });
}

test('rejects WITH, even though a read-only CTE would be harmless', () => {
  assertRejected(
    'WITH x AS (SELECT id FROM works) SELECT * FROM x',
    'WITH is refused by design: telling a read-only CTE from a data-modifying one needs a parser',
  );
});

test('rejects a data-modifying CTE, which is the reason WITH is refused at all', () => {
  assertRejected(
    'WITH gone AS (DELETE FROM works RETURNING *) SELECT * FROM gone',
    'valid Postgres, and it deletes the corpus',
  );
});

// ─── Literal and escape trickery ─────────────────────────────────────────────

test('a keyword inside a string literal does not trip the guard', () => {
  // The point of stripping literals: this query is harmless and must be admitted, or
  // the guard is useless for questions about text fields.
  const g = guardQuery("SELECT id FROM works WHERE title LIKE '%delete the old road%'");
  assert.deepStrictEqual(g.relations, ['works']);
});

test('an escaped quote does not let a literal leak into executable text', () => {
  assertRejected(
    "SELECT id FROM works WHERE title = 'it''s fine'; DROP TABLE works",
    'the `` escape must not terminate the literal early',
  );
});

test('rejects dollar-quoted strings outright', () => {
  assertRejected(
    'SELECT $$ anything at all $$ FROM works',
    'dollar quoting can carry a function body',
  );
});

test('rejects tagged dollar quoting', () => {
  assertRejected(
    'SELECT $tag$ DROP TABLE works $tag$ FROM works',
    'arbitrary tags are why the construct is refused rather than stripped',
  );
});

test('rejects double-quoted identifiers', () => {
  assertRejected(
    'SELECT "id" FROM works',
    'quoting is how a forbidden column name hides from a bare-identifier check',
  );
});

test('rejects backslash escapes outside literals', () => {
  assertRejected('SELECT id FROM works WHERE x = E\\x44', 'hex escapes can spell a keyword');
});

test('rejects non-ASCII outside literals, which is how homoglyphs arrive', () => {
  // Cyrillic 'е' (U+0435) in place of Latin 'e'.
  assertRejected('SELECT id FROM works WHERE statе = 1', 'homoglyph identifier');
});

// ─── Doctrine 3, enforced lexically ─────────────────────────────────────────

for (const col of FORBIDDEN_COLUMNS) {
  test(`rejects any query naming ${col} (Doctrine 3)`, () => {
    assertRejected(
      `SELECT ${col}, count(*) FROM works GROUP BY ${col} ORDER BY count(*) DESC`,
      'MP-level aggregation is forbidden regardless of how plausible the question sounds',
    );
  });
}

test('rejects the constituencies table, which carries mp_name', () => {
  assertRejected(
    'SELECT name FROM constituencies',
    'not allowlisted — Doctrine 3 needs an enforcement point here, not a convention',
  );
});

test('rejects the audit ledger, which must be read through the verifying endpoint', () => {
  assertRejected('SELECT * FROM audit_events', 'hash chain is verified by /api/audit, not by ad-hoc SQL');
});

test('rejects the evaluation answer key', () => {
  assertRejected(
    'SELECT * FROM answer_key',
    'a question that reads ground truth can make the detectors look better than they are',
  );
});

// ─── Catalogue, filesystem and server-side function access ──────────────────

test('rejects the system catalogue', () => {
  assertRejected('SELECT * FROM pg_tables', 'reconnaissance; the schema is handed over deliberately');
});

test('rejects information_schema', () => {
  assertRejected('SELECT table_name FROM information_schema.tables', 'same reason as pg_catalog');
});

test('rejects a filesystem read smuggled into the select list', () => {
  assertRejected(
    "SELECT pg_read_file('/etc/passwd') FROM works",
    'server-side file access from an unauthenticated endpoint',
  );
});

test('rejects pg_sleep, which is a denial-of-service primitive', () => {
  assertRejected('SELECT pg_sleep(60) FROM works', 'ties up a connection for a minute per request');
});

test('rejects current_setting, which can read the connection string', () => {
  assertRejected("SELECT current_setting('data_directory') FROM works", 'session introspection');
});

test('rejects SET, which could undo the executor read-only guarantees', () => {
  assertRejected('SELECT id FROM works WHERE (SET x = 1)', 'session control inside a query');
});

// ─── Degenerate and malformed input ─────────────────────────────────────────

test('rejects an empty query', () => {
  assertRejected('   ', 'nothing to run');
});

test('rejects a query that is only a comment', () => {
  assertRejected('-- just a comment', 'empty after stripping');
});

test('rejects a scalar SELECT that reads no relation', () => {
  assertRejected('SELECT 1', 'cannot answer a question about the corpus');
});

test('rejects an unknown relation', () => {
  assertRejected('SELECT * FROM secrets', 'not on the allowlist');
});

test('rejects an absurdly long query', () => {
  assertRejected('SELECT id FROM works WHERE ' + 'x = 1 AND '.repeat(500) + 'x = 1', 'length bound');
});

test('rejects a non-string input without crashing', () => {
  assertRejected(undefined as unknown as string, 'defensive: the router validates first, but the guard must not throw TypeError');
});

// ─── The stripper itself, since every other check depends on it ─────────────

test('stripper removes line comments', () => {
  assert.strictEqual(stripCommentsAndLiterals('a -- b\nc').trim().replace(/\s+/g, ' '), 'a c');
});

test('stripper removes nested block comments completely', () => {
  assert.strictEqual(stripCommentsAndLiterals('a /* x /* y */ z */ b').trim().replace(/\s+/g, ' '), 'a b');
});

test('stripper replaces literals with a space, not with nothing', () => {
  // `a/**/b` must not become the single identifier `ab` — that would let two
  // harmless-looking fragments join into a forbidden token.
  assert.strictEqual(stripCommentsAndLiterals('a/**/b').trim(), 'a b');
});

test('stripper handles an unterminated literal without looping forever', () => {
  // A model can emit malformed SQL. The stripper must terminate; the guard rejects
  // it afterwards on structural grounds.
  const out = stripCommentsAndLiterals("SELECT 'unterminated");
  assert.ok(typeof out === 'string');
});

// ─── The allowlist is a deliberate list, not an accident ───────────────────

test('the readable-relation list excludes the three sensitive relations by name', () => {
  for (const forbidden of ['constituencies', 'audit_events', 'answer_key']) {
    assert.ok(
      !READABLE_RELATIONS.includes(forbidden),
      `${forbidden} must not be added to READABLE_RELATIONS — see the doc comment for why`,
    );
  }
});
