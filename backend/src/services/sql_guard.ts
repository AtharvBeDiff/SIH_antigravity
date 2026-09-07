/**
 * SQL Guard — the allowlist a generated query must survive before it reaches Postgres.
 *
 * This file exists because of a specific hazard. P-15 asks for natural-language
 * questions over the corpus, and the honest way to build that is text-to-SQL with the
 * generated query shown to the officer. But `db.ts` connects with the **service-role
 * key, which bypasses every RLS policy in the schema**, and `http.ts` performs no
 * authentication at all. So a model that can be talked into emitting
 * `DELETE FROM works` is a model that can delete the corpus over HTTP, from an
 * unauthenticated endpoint, and that would violate Doctrine 1 — DRISHTI never mutates
 * a source record — through the front door.
 *
 * The repo has been here before. `raw_sql(query TEXT)` was a `SECURITY DEFINER`
 * wrapper around `EXECUTE format(...)` that F-23 removed; see the `exec()` obituary in
 * `db.ts`. The lesson recorded there is the one that governs this file: *keeping an
 * unused arbitrary-SQL path because it might be convenient someday is how it
 * eventually gets used with an interpolated string in it.* This time the arbitrary SQL
 * is not merely possible, it is the feature — so the path is not avoided, it is fenced.
 *
 * **The design commitment: this guard is an allowlist and it fails closed.** It does
 * not look for dangerous constructs and reject them; it describes the one shape a
 * query may have and rejects everything else. A blacklist of `DROP|DELETE|UPDATE`
 * would be defeated by comment splicing, unicode homoglyphs, `/*!50000 ... *​/`
 * MySQL-style hints, string-concatenated keywords and the next trick nobody has
 * thought of. An allowlist is defeated only by a construct that looks exactly like a
 * plain single-statement `SELECT`, which is the thing it is safe to run.
 *
 * **What this guard is not.** It is not a SQL parser. It is a lexer plus a set of
 * structural rules, and it is deliberately conservative: it rejects queries that would
 * have been harmless (a legitimate `WITH` clause, a `$$`-quoted string) rather than
 * accept a class it cannot reason about. Anything it wrongly rejects surfaces as a
 * clear error the officer can read, which is a far better failure than a query it
 * wrongly accepts. The last line of defence is not this file at all — it is the
 * read-only database role in `supabase/migrations/012_readonly_sql_role.sql`, which
 * lacks the privilege to write regardless of what text reaches it. Defence in depth:
 * the guard is the cheap check, the role is the real one, and neither is trusted alone.
 */

import { ApiError } from '../http.ts';

/**
 * Tables and views a generated query may read.
 *
 * An allowlist, not the full schema. Three tables are deliberately absent and the
 * reasons differ:
 *
 *   - **`constituencies`** — carries `mp_name` and `mp_party`. Doctrine 3 forbids
 *     MP-level aggregation, and a text-to-SQL endpoint is precisely where
 *     `GROUP BY mp_name ORDER BY count(*) DESC` gets written by accident. The columns
 *     are inert by convention everywhere else in the codebase; here the convention
 *     needs an enforcement point, because the query author is a language model that
 *     has never read the doctrine. `works.mp_name` is filtered at column level below
 *     for the same reason.
 *   - **`audit_events`** — the tamper-evident ledger. Readable through `/api/audit`,
 *     which verifies the hash chain as it reads. Exposing it to ad-hoc SQL invites a
 *     reader to draw conclusions from rows nobody verified.
 *   - **`answer_key`** — the evaluation ground truth. A question that can read the
 *     answer key can be used to make the detectors look better than they are.
 */
export const READABLE_RELATIONS: readonly string[] = [
  'works',
  'districts',
  'agencies',
  'payments',
  'alerts',
  'inspections',
  'inspection_items',
  'health_reports',
  'review_actions',
  'rule_probation',
  'documents',
];

/**
 * Columns no generated query may name, on any relation.
 *
 * Doctrine 3, enforced lexically. `works.mp_name` exists and is populated with a
 * placeholder, so a query naming it would succeed and return a column of
 * `'Hon. Member of Parliament'` — harmless today, and exactly the sort of thing that
 * stops being harmless the moment real data lands. The rule is that an MP's name is a
 * fact on a record, never a subject of aggregation, so the safest place to enforce it
 * is before the query runs rather than after someone charts the result.
 */
export const FORBIDDEN_COLUMNS: readonly string[] = ['mp_name', 'mp_party'];

/**
 * The hard row cap applied to every query.
 *
 * Enforced by wrapping rather than by trusting a `LIMIT` the model wrote, because a
 * model that forgets the limit is more likely than one that writes a hostile one, and
 * a `LIMIT 5000000` typo would stream the corpus into a JSON response.
 */
export const MAX_ROWS = 500;

/** Statement timeout, in milliseconds, applied per query by the executor. */
export const STATEMENT_TIMEOUT_MS = 5_000;

/**
 * Keywords that may begin a statement. Exactly one entry, and that is the point.
 *
 * `WITH` is excluded even though a read-only CTE is perfectly reasonable SQL. The
 * reason is `WITH x AS (DELETE FROM works RETURNING *) SELECT * FROM x` — data-modifying
 * CTEs are valid Postgres, and a guard that admits `WITH` has to parse the entire CTE
 * body to know whether it writes. That is a parser, and a parser is the thing this
 * file is explicitly not. A question that genuinely needs a CTE can be expressed as a
 * subquery, which the guard does allow.
 */
const ALLOWED_LEADING_KEYWORD = 'select';

/**
 * Constructs that must not appear anywhere in the query text, checked against the
 * *stripped* form after comments and string literals are removed.
 *
 * This list is a second line inside the allowlist, not a blacklist substitute. The
 * structural checks above already reject anything that is not a lone `SELECT`; these
 * catch constructs that can hide inside a syntactically valid `SELECT` and reach
 * outside it — writes via function call, filesystem access, privilege changes, or
 * another statement smuggled through a construct the lexer treats as one token.
 */
const FORBIDDEN_TOKENS: readonly string[] = [
  // Writes and DDL, in case a subquery or function call carries one.
  'insert', 'update', 'delete', 'truncate', 'drop', 'alter', 'create',
  'grant', 'revoke', 'merge', 'upsert', 'replace',
  // Transaction and session control — a query that can open a transaction or change
  // a session setting can undo the executor's own read-only guarantees.
  'commit', 'rollback', 'savepoint', 'begin', 'start', 'set', 'reset', 'discard',
  'listen', 'notify', 'unlisten', 'lock', 'prepare', 'execute', 'deallocate',
  'declare', 'fetch', 'move', 'close', 'do', 'call', 'analyze', 'vacuum',
  'cluster', 'reindex', 'refresh', 'import', 'security',
  // COPY reads and writes the server filesystem.
  'copy',
  // `pg_read_file`, `pg_ls_dir`, `lo_import`, `dblink`, `pg_sleep` and friends. The
  // bare prefixes are checked as identifier substrings rather than whole tokens,
  // below, because `pg_read_file` is one token.
  'pg_sleep', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  'lo_import', 'lo_export', 'dblink', 'dblink_exec', 'postgres_fdw',
  // Language-level escapes.
  'language', 'returning', 'into',
];

/**
 * Identifier prefixes that must not appear. Catches the catalogue and every
 * `pg_`-namespaced function in one rule, including ones that do not exist yet.
 *
 * `information_schema` and `pg_catalog` are excluded not because reading them is
 * dangerous but because it is reconnaissance: a question about the corpus has no
 * reason to enumerate the schema, and the schema is already handed to the model
 * deliberately by `schemaPrompt()`.
 */
const FORBIDDEN_PREFIXES: readonly string[] = [
  'pg_', 'information_schema', 'pg_catalog', 'current_setting', 'set_config',
];

/** The outcome of guarding a query. Never a partial success. */
export interface GuardedQuery {
  /** The query text as validated, with the row cap applied. Safe to execute. */
  sql: string;
  /** The relations the query reads, for display and for the audit payload. */
  relations: string[];
  /** True when {@link MAX_ROWS} was applied because the query named no smaller limit. */
  limit_applied: boolean;
}

/**
 * Removes comments and string literals from a query, replacing each with a space.
 *
 * Every structural check runs against this stripped form, because the alternative is a
 * guard that can be walked past with `SELECT 1 --[newline] ; DROP TABLE works` or
 * `SELECT 'delete from works'`. Stripping first means a keyword *inside a literal* is
 * not mistaken for a keyword, and a semicolon inside a comment is not mistaken for a
 * statement separator. The replacement is a space rather than an empty string so
 * `a/**​/b` does not silently become the single identifier `ab`.
 *
 * Handles: `--` line comments, `/* *​/` block comments **with nesting** (Postgres
 * nests them, and a non-nesting stripper can be defeated by
 * `/* /* *​/ DROP TABLE works /* *​/`), single-quoted strings with `''` escapes,
 * and double-quoted identifiers.
 *
 * Dollar-quoted strings (`$$...$$`, `$tag$...$tag$`) are **not** stripped — they are
 * rejected outright by {@link assertNoDollarQuoting} before this runs, because
 * dollar quoting is how a function body gets smuggled in and there is no legitimate
 * need for it in a generated `SELECT`.
 */
export function stripCommentsAndLiterals(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i]!;
    const next = i + 1 < n ? sql[i + 1] : '';

    // `--` line comment, to end of line.
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    // `/* ... */` block comment, nesting.
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += ' ';
      continue;
    }

    // Single-quoted string literal. `''` is an escaped quote, not a terminator.
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += ' ';
      continue;
    }

    // Double-quoted identifier. Replaced with a space like any other literal: a
    // quoted identifier is the standard way to smuggle a forbidden name past a
    // token check (`SELECT * FROM "works"` is fine, but `"mp_name"` must not slip
    // through), so quoted identifiers are rejected wholesale by
    // `assertNoQuotedIdentifiers` before this point rather than parsed here.
    if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
        } else if (sql[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += ' ';
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function reject(message: string, sql: string): never {
  throw new ApiError(400, 'UNSAFE_QUERY', message, { sql });
}

/**
 * Rejects an unterminated block comment or string literal.
 *
 * This is a *stripper-agreement* check, and the reason it exists is worth recording
 * because the case that produced it looks like an attack and is not.
 *
 * Postgres nests block comments — `/* /* *​/ ; DROP TABLE works /* *​/` opens to depth
 * two, closes to one, and reaches end-of-input still inside a comment, which Postgres
 * reports as a syntax error. {@link stripCommentsAndLiterals} nests too, so it agrees:
 * it consumes the whole tail and the query reduces to the harmless prefix. The two
 * agreeing is the safe outcome, and it is why that input is not the injection it
 * appears to be — the injection only works against a stripper that stops at the *first*
 * `*​/` while Postgres keeps nesting.
 *
 * But agreement-by-consumption is a thin place to stand. An unterminated construct
 * means the guard is reasoning about a query Postgres would refuse to parse at all, so
 * the guard's structural conclusions describe text that has no valid interpretation.
 * Refusing outright is both safer and a clearer error than silently analysing the
 * prefix and admitting it.
 */
function assertTerminatedConstructs(sql: string): void {
  let i = 0;
  const n = sql.length;
  let commentDepth = 0;

  while (i < n) {
    const c = sql[i]!;
    const next = i + 1 < n ? sql[i + 1] : '';

    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && next === '*') {
      commentDepth++;
      i += 2;
      while (i < n && commentDepth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          commentDepth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          commentDepth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (commentDepth > 0) {
        reject(
          'Unterminated block comment. Postgres nests /* */ and would reject this as a ' +
            'syntax error, so the guard has no valid query to reason about.',
          sql,
        );
      }
      continue;
    }

    if (c === "'") {
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          closed = true;
          break;
        } else {
          i++;
        }
      }
      if (!closed) reject('Unterminated string literal.', sql);
      continue;
    }

    i++;
  }
}

/**
 * Rejects dollar quoting outright.
 *
 * `$$ ... $$` and `$tag$ ... $tag$` are how a PL/pgSQL body is written, and a body can
 * contain anything. There is no reason for a generated analytical `SELECT` to use
 * dollar quoting, so the whole construct is refused rather than stripped — refusing is
 * a one-line rule, stripping correctly requires matching arbitrary tags.
 */
function assertNoDollarQuoting(sql: string): void {
  if (/\$[A-Za-z0-9_]*\$/.test(sql)) {
    reject(
      'Dollar-quoted strings ($$ or $tag$) are not permitted. ' +
        'They can carry a function body, and an analytical query has no need for them.',
      sql,
    );
  }
}

/**
 * Rejects double-quoted identifiers.
 *
 * Postgres treats `"mp_name"` and `mp_name` as the same column, so a column filter
 * that only checks bare identifiers is bypassed by quoting. Rather than normalise
 * quoted identifiers and re-check them — which means implementing Postgres's folding
 * rules — quoting is refused. Every column in this schema is lower-case and
 * unquoted, so nothing legitimate needs it.
 */
function assertNoQuotedIdentifiers(sql: string): void {
  if (sql.includes('"')) {
    reject(
      'Double-quoted identifiers are not permitted. Every column and table in this ' +
        'schema is lower-case, so quoting is unnecessary — and quoting can hide a ' +
        'forbidden column name from the guard.',
      sql,
    );
  }
}

/**
 * Rejects backslash escapes and non-ASCII characters outside literals.
 *
 * Two separate hazards. `E'\x44'` can spell a keyword in hex, and unicode homoglyphs
 * (Cyrillic `е` for Latin `e`) can spell one that a keyword comparison misses while
 * Postgres's own parser may still fold it. Since the stripped form contains no
 * literals, anything non-ASCII left in it is either a homoglyph attempt or a
 * legitimate identifier this schema does not have.
 */
function assertAsciiOnly(stripped: string, sql: string): void {
  if (/[^\x20-\x7E\s]/.test(stripped)) {
    reject(
      'Query contains non-ASCII characters outside string literals. Identifiers in ' +
        'this schema are ASCII, and homoglyphs can spell a keyword the guard would miss.',
      sql,
    );
  }
  if (stripped.includes('\\')) {
    reject('Backslash escapes are not permitted outside string literals.', sql);
  }
}

/**
 * The core structural check: exactly one statement, and it begins with `SELECT`.
 *
 * Both halves matter and they fail differently. A trailing semicolon is tolerated
 * because models emit one habitually and it is not an attack; a semicolon with
 * anything after it is a second statement and is refused. The leading-keyword check
 * is what makes this an allowlist: `DELETE` is not rejected because it appears in a
 * blacklist, it is rejected because it is not `SELECT`.
 */
function assertSingleSelect(stripped: string, sql: string): void {
  const trimmed = stripped.trim().replace(/;+\s*$/, '');

  if (trimmed.includes(';')) {
    reject(
      'Only a single statement is permitted. A semicolon separating two statements ' +
        'is the classic way to append a write to a read.',
      sql,
    );
  }

  if (trimmed === '') {
    reject('Query is empty after removing comments and literals.', sql);
  }

  const firstWord = trimmed.match(/^[A-Za-z_]+/)?.[0]?.toLowerCase();
  if (firstWord !== ALLOWED_LEADING_KEYWORD) {
    reject(
      `Only ${ALLOWED_LEADING_KEYWORD.toUpperCase()} statements are permitted; this one ` +
        `begins with '${firstWord ?? '?'}'. Note that WITH is refused too, because a ` +
        'data-modifying CTE is valid SQL and telling one apart needs a full parser. ' +
        'Express the question as a subquery instead.',
      sql,
    );
  }
}

/** Tokenises the stripped query into lower-cased identifier-ish words. */
function tokens(stripped: string): string[] {
  return (stripped.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []);
}

/** Rejects any forbidden keyword, prefix, or Doctrine-3 column. */
function assertNoForbiddenTokens(stripped: string, sql: string): void {
  const found = tokens(stripped);
  const forbidden = new Set(FORBIDDEN_TOKENS);

  for (const t of found) {
    if (forbidden.has(t)) {
      reject(
        `The token '${t}' is not permitted in a generated query. This endpoint is ` +
          'read-only by construction, not by convention.',
        sql,
      );
    }
    if (FORBIDDEN_COLUMNS.includes(t)) {
      reject(
        `The column '${t}' may not be queried. Doctrine 3: an MP's name is a fact on a ` +
          'work record, never a subject of aggregation. Accountability in this platform ' +
          'attaches to the agency and the district.',
        sql,
      );
    }
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (t.startsWith(prefix)) {
        reject(
          `The identifier '${t}' is not permitted: '${prefix}' names the system catalogue ` +
            'or a server-side function. The schema is supplied to the model directly, so ' +
            'a question about the corpus never needs to enumerate it.',
          sql,
        );
      }
    }
  }
}

/**
 * Extracts the relations the query reads, and rejects any that is not allowlisted.
 *
 * Reads the identifier following each `FROM` or `JOIN`. An open parenthesis after
 * either means a subquery rather than a relation, which is allowed — the subquery's own
 * `FROM` is matched by the same regex on the next pass, so nesting does not evade the
 * check.
 *
 * Because the leading-keyword check has already guaranteed a single `SELECT`, a query
 * that names no relation at all is a scalar expression like `SELECT 1`. That is
 * refused: it cannot answer a question about the corpus, and allowing it would admit
 * `SELECT pg_sleep(60)`-shaped probes if a future edit weakened the token list.
 */
function collectRelations(stripped: string, sql: string): string[] {
  const relations: string[] = [];
  const allowed = new Set(READABLE_RELATIONS);
  const re = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const rel = m[1]!.toLowerCase();
    if (!allowed.has(rel)) {
      reject(
        `The relation '${rel}' is not readable from this endpoint. Readable relations: ` +
          `${READABLE_RELATIONS.join(', ')}. Note that 'constituencies' is deliberately ` +
          "absent (it carries mp_name), as are 'audit_events' (read it through /api/audit, " +
          "which verifies the hash chain) and 'answer_key' (it is the evaluation ground truth).",
        sql,
      );
    }
    if (!relations.includes(rel)) relations.push(rel);
  }

  if (relations.length === 0) {
    reject(
      'Query reads no allowlisted relation. A question about the corpus has to select ' +
        'from one of: ' + READABLE_RELATIONS.join(', ') + '.',
      sql,
    );
  }

  return relations;
}

/**
 * Applies the row cap.
 *
 * Wrapping in an outer `SELECT` rather than appending `LIMIT` to the model's text,
 * because appending is wrong in two ways: a query that already ends in
 * `LIMIT 1000000` would become `LIMIT 1000000 LIMIT 500`, which is a syntax error
 * rather than a cap, and a query ending in a comment would swallow the appended
 * clause. Wrapping caps the result whatever the inner text says, and the inner
 * `LIMIT` is left in place because it may be load-bearing for a `ORDER BY ... LIMIT 5`
 * "top five" question.
 *
 * The wrapper is applied unconditionally. `limit_applied` reports whether the cap is
 * *binding* — that is, whether the inner query named no limit at or below the cap — so
 * the UI can tell the officer when they are seeing a truncated answer.
 */
function applyRowCap(sql: string): { sql: string; limit_applied: boolean } {
  const inner = sql.trim().replace(/;+\s*$/, '');
  const stripped = stripCommentsAndLiterals(inner);
  const limitMatch = stripped.match(/\blimit\s+(\d+)\s*$/i);
  const innerLimit = limitMatch ? Number(limitMatch[1]) : null;
  const binding = innerLimit === null || innerLimit > MAX_ROWS;

  return {
    sql: `SELECT * FROM (${inner}) AS drishti_guarded LIMIT ${MAX_ROWS}`,
    limit_applied: binding,
  };
}

/**
 * Validates a generated query and returns it in executable form, or throws
 * {@link ApiError} with `UNSAFE_QUERY`.
 *
 * The order of checks is deliberate: the two constructs that would defeat the stripper
 * are refused *before* stripping, then everything else runs against the stripped form.
 * Reordering these would let a dollar-quoted body reach the token check as an opaque
 * literal.
 *
 * Never returns a partially-validated query. Every rejection path throws.
 */
export function guardQuery(rawSql: string): GuardedQuery {
  if (typeof rawSql !== 'string' || rawSql.trim() === '') {
    reject('No query text supplied.', String(rawSql));
  }

  // Length bound before anything else: the checks below are linear, but a
  // pathological input has no business reaching them, and a model that emitted 100 kB
  // of SQL has malfunctioned in a way no guard should try to interpret.
  if (rawSql.length > 4_000) {
    reject('Query exceeds 4,000 characters. An analytical question does not need that much SQL.', rawSql);
  }

  // Must precede stripping — see the doc comments on each.
  assertNoDollarQuoting(rawSql);
  assertNoQuotedIdentifiers(rawSql);
  assertTerminatedConstructs(rawSql);

  const stripped = stripCommentsAndLiterals(rawSql);

  assertAsciiOnly(stripped, rawSql);
  assertSingleSelect(stripped, rawSql);
  assertNoForbiddenTokens(stripped, rawSql);
  const relations = collectRelations(stripped, rawSql);

  const { sql, limit_applied } = applyRowCap(rawSql);
  return { sql, relations, limit_applied };
}
