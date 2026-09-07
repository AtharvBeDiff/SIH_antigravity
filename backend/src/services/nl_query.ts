/**
 * Natural-language query (P-15) — question in, SQL out, rows back, all of it shown.
 *
 * ## What this replaces
 *
 * The product had a "copilot" that returned canned strings. That is the failure mode
 * the whole cleanup pass was about: an interface that looks like it knows something and
 * does not. This is the honest version of the same feature — the officer's question is
 * translated to SQL by a model, **the SQL is shown to them verbatim**, it is executed
 * read-only, and the rows are what they are. If the translation is wrong the officer
 * can see that it is wrong, which is the only property that makes a text-to-SQL feature
 * usable in an oversight tool. Doctrine 7: explainable, or absent.
 *
 * ## The trust boundary, stated plainly
 *
 * The model is not trusted. Not because it is adversarial, but because the question it
 * translates arrives from an unauthenticated HTTP caller (`http.ts` performs no
 * authentication) and the client that would execute the result holds the **service-role
 * key, which bypasses every RLS policy**. Prompt injection through the question is
 * therefore a direct path to arbitrary SQL. Three layers stand in that path, and the
 * order matters because each one assumes the previous may have failed:
 *
 *   1. **The prompt** ({@link schemaPrompt}) — describes only the eleven allowlisted
 *      relations and never mentions `mp_name`. This is the weakest layer. It shapes what
 *      the model tends to emit; it constrains nothing. Treated as a quality measure, not
 *      a security control.
 *   2. **The guard** (`services/sql_guard.ts`) — an allowlist that fails closed, with 54
 *      adversarial tests behind it. Strong, and still only application code.
 *   3. **The database** (`supabase/migrations/012_readonly_sql_role.sql`) — execution
 *      happens inside `SET TRANSACTION READ ONLY`, so Postgres refuses any write
 *      regardless of what text got through. This is the layer that survives a bug in the
 *      other two.
 *
 * Nothing here executes SQL directly through `db.ts`'s helpers. Every query goes through
 * the `drishti_readonly_select` RPC, which is the only path that carries the read-only
 * transaction.
 *
 * ## Why the model client is injected
 *
 * {@link answerQuestion} takes an optional `generate` function. That exists so the whole
 * pipeline — prompt, extraction, guard, execution shape, audit payload — is testable
 * without a Gemini credential. A feature whose only test is "it works when the key is
 * set" has no tests, and the key on this box is expected to rotate.
 */

import { ApiError } from '../http.ts';
import { getDb } from '../db.ts';
import { appendAudit } from './audit_chain.ts';
import {
  guardQuery,
  READABLE_RELATIONS,
  MAX_ROWS,
  STATEMENT_TIMEOUT_MS,
  type GuardedQuery,
} from './sql_guard.ts';
import {
  generateText,
  isConfigured,
  activeModel,
  type GenerateOptions,
  type GenerateResult,
} from './llm.ts';
import {
  WORK_STATUSES,
  WORK_CATEGORIES,
  ALERT_STATUSES,
  SEVERITY_RANK,
} from '../types.ts';

/** The shape {@link answerQuestion} needs from a model. Injectable for tests. */
export type GenerateFn = (prompt: string, options?: GenerateOptions) => Promise<GenerateResult>;

/** Upper bound on the question itself. A question, not a document. */
const MAX_QUESTION_CHARS = 500;

/**
 * The schema handed to the model.
 *
 * Hand-written rather than introspected from `information_schema`, for three reasons.
 * It must describe *exactly* the allowlisted relations — introspection would surface
 * `constituencies`, `audit_events` and `answer_key`, and a model told about a table it
 * must not read will eventually read it. It must omit `mp_name` entirely rather than
 * mention it with a prohibition, because naming a forbidden column in a prompt is how it
 * ends up in output. And the column annotations here carry meaning the catalogue cannot:
 * that `expenditure` is cumulative, that `released_amount ≥ expenditure` is the normal
 * relation, that a null date means "not yet" rather than "unknown".
 *
 * The cost of hand-writing it is that it drifts from the schema. That is bounded by
 * {@link schemaCoversAllowlist}, which the test suite asserts: every allowlisted relation
 * must appear here, so adding a relation to the guard without describing it fails a test
 * rather than silently producing a model that cannot use it.
 */
const SCHEMA_DESCRIPTION = `
works — one MPLADS work. The central table; most questions start here.
  id                     text, primary key
  district_id            text -> districts.id
  agency_id              text -> agencies.id, nullable (work not yet assigned)
  title                  text
  description            text
  category               text, one of: ${WORK_CATEGORIES.join(', ')}
  sub_category           text, nullable
  location_name          text
  latitude, longitude    double precision, nullable
  sanctioned_amount      double precision, rupees. The approved cost.
  released_amount        double precision, rupees. Cumulative funds released to date.
  expenditure            double precision, rupees. Cumulative spend to date.
                         Normal relation: sanctioned >= released >= expenditure.
  first_installment      double precision, nullable
  second_installment     double precision, nullable
  sanction_date          date, nullable (null = not yet sanctioned)
  recommended_date       date, nullable (when the work was recommended)
  completion_target_date date, nullable. Past this date and not COMPLETED = overdue.
  actual_completion_date date, nullable (null = not completed)
  last_payment_date      date, nullable (null = no payment ever made)
  status                 text, one of: ${WORK_STATUSES.join(', ')}
  physical_progress_pct  double precision, 0-100
  has_uc                 boolean. Utilisation Certificate submitted.
  uc_date                date, nullable
  phase                  integer
  is_scsp, is_tsp        boolean. Scheduled Caste / Tribal Sub-Plan earmarking.
  created_at, updated_at timestamptz

districts — administrative district.
  id, name, state, code text; lgd_code text nullable; created_at timestamptz

agencies — the implementing agency responsible for a work. Accountability attaches here.
  id text; district_id text -> districts.id; name text; type text; created_at timestamptz

payments — one disbursement against a work. A work has many payments.
  id text; work_id text -> works.id
  amount           double precision, rupees, always > 0
  payment_date     date
  stage            text, one of: MOBILISATION_ADVANCE, RUNNING_BILL, FINAL_BILL, RETENTION_RELEASE
  sequence_number  integer, 1-based order within the work
  pfms_reference   text nullable; purpose text nullable; created_at timestamptz

alerts — one integrity finding raised by a rule against a work.
  id text; work_id text -> works.id
  rule_id        text, e.g. 'R-004'. Resolves to the YAML rule catalogue.
  origin_id      text, dedupe key
  severity       text, one of: ${Object.keys(SEVERITY_RANK).join(', ')}
  severity_rank  integer, 1 = CRITICAL .. 4 = LOW. Sort ascending for most-severe-first.
  status         text, one of: ${ALERT_STATUSES.join(', ')}
  reason_code    text, machine-readable reason
  evidence_text  text, the human-readable finding
  confidence     double precision nullable
  in_budget      boolean. False = overflowed the district alert budget into BACKLOG.
  reviewed_by    text nullable; reviewed_at timestamptz nullable
  dismiss_reason text nullable; dismiss_note text nullable
  created_at, updated_at timestamptz

inspections — a field visit to a work.
  id text; work_id text -> works.id
  inspector_id, inspector_name text
  inspection_date date; latitude, longitude double precision
  overall_status text; notes text nullable
  photo_keys jsonb (array); synced boolean; created_at timestamptz

inspection_items — checklist rows within one inspection.
  id text; inspection_id text -> inspections.id
  checklist_id text; checked boolean; note text nullable

health_reports — a periodic progress report filed against a work.
  id text; work_id text -> works.id
  reported_by text; report_date date; progress_pct double precision
  evidence_image_key text nullable; remarks text nullable; created_at timestamptz

review_actions — an officer's action on an alert. The review trail.
  id text; alert_id text -> alerts.id
  action text; actor text; reason_code text nullable; note text nullable
  created_at timestamptz

rule_probation — per-rule quality tracking. A rule below 40% actionable is suspended.
  rule_id text primary key
  total_reviews, dismissals integer
  actionable_rate double precision, 0-1
  suspended boolean; suspended_at, reinstated_at timestamptz nullable

documents — a file attached to a work.
  id text; work_id text -> works.id
  type text; filename text; storage_key text; uploaded_at timestamptz
`.trim();

/**
 * Asserts the hand-written schema mentions every allowlisted relation.
 *
 * Exported for the test suite. The guard's allowlist and this description are two lists
 * that must stay in step, and the failure mode of drift is quiet: a model that is never
 * told about `documents` simply never queries it, and nobody notices for a release.
 */
export function schemaCoversAllowlist(): { covered: string[]; missing: string[] } {
  const covered: string[] = [];
  const missing: string[] = [];
  for (const rel of READABLE_RELATIONS) {
    // Match the relation at the start of a line, which is how each block opens.
    if (new RegExp(`^${rel}\\s`, 'm').test(SCHEMA_DESCRIPTION)) covered.push(rel);
    else missing.push(rel);
  }
  return { covered, missing };
}

/**
 * The instruction block.
 *
 * Written as constraints with reasons attached, because a model given a bare rule list
 * violates the ones it cannot see a purpose for. The Doctrine 3 instruction is the one
 * that matters most and is stated as a property of the domain rather than as a
 * prohibition: accountability attaches to the agency and the district. Note it does not
 * name the forbidden columns — the guard enforces those, and naming them here would put
 * them in the model's context for no benefit.
 */
export function systemPrompt(): string {
  return `You translate an oversight officer's question about MPLADS works into a single
PostgreSQL SELECT statement. You are working inside DRISHTI, a read-only integrity
platform layered over the e-SAKSHI portal.

Return ONLY the SQL. No prose, no explanation, no markdown fence. Your entire response
must be a statement that can be executed as-is.

Hard constraints — a query breaking any of these is rejected before it runs, and the
officer sees an error instead of an answer:

1. One statement. A single SELECT. No semicolon-separated second statement.
2. SELECT only. No INSERT, UPDATE, DELETE, or DDL of any kind. This platform never
   mutates a record; it only reads.
3. No WITH / CTE. Express it as a subquery instead. (A data-modifying CTE is valid SQL,
   so the whole construct is refused rather than inspected.)
4. Only the tables described below. No system catalogue, no information_schema, no
   pg_* function.
5. Aggregate by agency, district, category, rule, status or time. Accountability in this
   platform attaches to the implementing agency and the district — those are the units an
   officer can act on. Do not group or rank by the elected representative; that is not a
   unit of accountability here and such a query is rejected.
6. No double-quoted identifiers. Every name in this schema is lower-case already.
7. Rows are capped at ${MAX_ROWS} and the statement times out at ${STATEMENT_TIMEOUT_MS}ms.
   Prefer an aggregate over a raw dump: an officer asking "which agencies are worst on
   delays" wants a count per agency, not five hundred work rows.

Guidance that makes answers useful rather than merely valid:

- Money is in rupees. A question phrased in crore needs the division applied
  (1 crore = 10,000,000), and label the column so the unit is visible.
- A null date means the event has not happened, not that it is unknown. "Overdue" is
  completion_target_date < CURRENT_DATE AND status <> 'COMPLETED', not a null check.
- Never let a rule fire on a null field: when filtering on a nullable column, decide
  explicitly whether null belongs in or out, and write it.
- Join to districts or agencies to return a name rather than an id — an id is not an
  answer a human can read.
- Sort so the interesting rows come first: severity_rank ASC for alerts, amount DESC for
  money, count DESC for rankings.
- If the question cannot be answered from these tables, return the closest SELECT that
  is answerable rather than inventing a column. A wrong column name fails; a narrower
  honest answer does not.

Schema:

${SCHEMA_DESCRIPTION}`;
}

/**
 * Strips the wrapping a model puts around code even when told not to.
 *
 * Models emit ```sql fences, a leading "Here is the query:", and trailing prose. Rather
 * than reject those and lose the answer, the wrapping is removed — but only wrapping.
 * Anything that survives this still faces the full guard, so being lenient here costs
 * nothing: this function makes a valid query recoverable, it does not make an invalid one
 * acceptable.
 */
export function extractSql(raw: string): string {
  let text = raw.trim();

  // Fenced block, with or without a language tag. Take the first fence's contents.
  const fence = text.match(/```(?:sql|postgresql|postgres)?\s*\n?([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  // A model that ignored the fence instruction may still have prefixed prose. Cut to
  // the first SELECT, since the guard requires the statement to begin with one anyway.
  const selectAt = text.search(/\bselect\b/i);
  if (selectAt > 0) text = text.slice(selectAt);

  return text.trim();
}

/** What the officer gets back. Every field is here to be shown, not just used. */
export interface QueryAnswer {
  question: string;
  /** The SQL exactly as the model produced it, before the guard wrapped it. */
  sql_generated: string;
  /** The SQL as executed, row cap applied. Differs from the above — both are shown. */
  sql_executed: string;
  /** Relations read, from the guard. */
  relations: string[];
  /** True when the row cap was binding, i.e. the answer may be truncated. */
  truncated: boolean;
  rows: Record<string, unknown>[];
  row_count: number;
  /** Column names in the order the first row presents them; `[]` when there are no rows. */
  columns: string[];
  model: string;
  latency_ms: { model: number; database: number };
  /** Audit ledger sequence for this execution, so the officer can find it again. */
  audit_seq: number | null;
}

/**
 * Executes a guarded query through the read-only RPC.
 *
 * The only execution path. `db.ts`'s `all()` and friends go through PostgREST's query
 * builder and cannot run arbitrary SQL, which is correct — and it is why the RPC exists.
 * `drishti_readonly_select` is the named Postgres function that `db.ts`'s `exec()`
 * obituary prescribes for exactly this case.
 */
async function executeGuarded(guarded: GuardedQuery): Promise<Record<string, unknown>[]> {
  const db = getDb();
  const { data, error } = await db.rpc('drishti_readonly_select', {
    query_text: guarded.sql,
    timeout_ms: STATEMENT_TIMEOUT_MS,
  });

  if (error) {
    // 25006 is `read_only_sql_transaction` — the database refusing a write. If this ever
    // appears it means something got past the guard, so it is called out by name rather
    // than folded into a generic failure: it is the one error here worth investigating.
    const isWriteAttempt =
      error.code === '25006' || /read-only transaction/i.test(error.message ?? '');
    if (isWriteAttempt) {
      throw new ApiError(
        400,
        'UNSAFE_QUERY',
        'The database refused this query because it attempts to write, and this path is ' +
          'read-only at the transaction level. The application guard should have caught ' +
          'this first — that it did not is a bug worth reporting.',
        { sql: guarded.sql },
      );
    }
    // A syntax error or an unknown column is the ordinary case: the model produced valid-
    // looking SQL that does not match the schema. Surfaced as-is, because the officer is
    // looking at the generated SQL and the database's own complaint is the useful message.
    throw new ApiError(
      422,
      'QUERY_FAILED',
      `The generated query did not run: ${error.message}. The SQL is shown above — the ` +
        'usual cause is a column that does not exist in this schema.',
      { sql: guarded.sql, pg_code: error.code ?? null },
    );
  }

  // The function returns JSONB: an array of row objects, or `[]`. Anything else means
  // the migration was not applied or was edited.
  if (!Array.isArray(data)) {
    throw new ApiError(
      500,
      'QUERY_SHAPE',
      'drishti_readonly_select returned a non-array. Check that ' +
        'supabase/migrations/012_readonly_sql_role.sql has been applied.',
    );
  }
  return data as Record<string, unknown>[];
}

/**
 * Question in, answer out.
 *
 * @param question  The officer's question, natural language.
 * @param actor     For the audit ledger. From `actorOf(req)`, which is not authentication.
 * @param generate  Model client. Defaults to the real one; injected in tests.
 *
 * Audits **every execution**, including failures, and audits after the query runs so the
 * ledger records what happened rather than what was attempted. A rejected query is
 * audited too — a series of rejected injection attempts is exactly the pattern the
 * ledger should preserve — and that write happens on the error path in
 * {@link auditRejection} rather than here.
 */
export async function answerQuestion(
  question: string,
  actor: string,
  generate: GenerateFn = generateText,
): Promise<QueryAnswer> {
  const q = typeof question === 'string' ? question.trim() : '';
  if (q === '') {
    throw new ApiError(400, 'NO_QUESTION', 'Ask a question about the works corpus.');
  }
  if (q.length > MAX_QUESTION_CHARS) {
    throw new ApiError(
      400,
      'QUESTION_TOO_LONG',
      `Question exceeds ${MAX_QUESTION_CHARS} characters. A long block of text is more ` +
        'likely to be an instruction to the model than a question about the corpus.',
    );
  }

  // Model call. `temperature: 0` so the same question yields the same SQL — an officer
  // comparing two runs should not have to wonder whether a difference is sampling noise.
  const generated = await generate(q, {
    system: systemPrompt(),
    temperature: 0,
    maxOutputTokens: 1024,
  });

  const sqlGenerated = extractSql(generated.text);

  // The guard. Throws `UNSAFE_QUERY` and the audit entry is written by the caller's
  // error path, not swallowed here.
  let guarded: GuardedQuery;
  try {
    guarded = guardQuery(sqlGenerated);
  } catch (err) {
    await auditRejection(actor, q, sqlGenerated, err, generated.model);
    throw err;
  }

  const dbStarted = Date.now();
  let rows: Record<string, unknown>[];
  try {
    rows = await executeGuarded(guarded);
  } catch (err) {
    await auditRejection(actor, q, sqlGenerated, err, generated.model);
    throw err;
  }
  const dbLatency = Date.now() - dbStarted;

  // The audit payload carries the question and both SQL forms but **not the rows**. The
  // ledger is append-only and hash-chained; putting result sets in it would grow it
  // without bound and would copy corpus data into a structure that is never pruned. The
  // query text is reproducible — that is what makes the entry useful.
  const seq = await auditExecution(actor, {
    question: q,
    sql_generated: sqlGenerated,
    sql_executed: guarded.sql,
    relations: guarded.relations,
    row_count: rows.length,
    truncated: guarded.limit_applied && rows.length >= MAX_ROWS,
    model: generated.model,
    model_latency_ms: generated.latency_ms,
    db_latency_ms: dbLatency,
  });

  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];

  return {
    question: q,
    sql_generated: sqlGenerated,
    sql_executed: guarded.sql,
    relations: guarded.relations,
    // Only claim truncation when the cap was binding *and* the cap was reached. A
    // 12-row answer is not truncated just because no LIMIT was written.
    truncated: guarded.limit_applied && rows.length >= MAX_ROWS,
    rows,
    row_count: rows.length,
    columns,
    model: generated.model,
    latency_ms: { model: generated.latency_ms, database: dbLatency },
    audit_seq: seq,
  };
}

/**
 * Audits a successful execution and returns the ledger sequence.
 *
 * A ledger write failure must not turn a successful answer into an error the officer
 * sees — they asked a question and it was answered. But it must not be silent either, so
 * it is logged and `audit_seq` comes back null, which the UI renders as "not recorded".
 */
async function auditExecution(actor: string, payload: Record<string, unknown>): Promise<number | null> {
  try {
    const event = await appendAudit(actor, 'NL_QUERY_EXECUTED', 'query', 'nl_query', payload);
    return event?.seq ?? null;
  } catch (err) {
    console.error('[nl_query] audit append failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Audits a rejected or failed query.
 *
 * Separate from the success path and deliberately best-effort: if the ledger is down, the
 * officer still gets the guard's explanation. The rejection reason is recorded because a
 * pattern of `UNSAFE_QUERY` entries is the signal that someone is probing the endpoint,
 * and that is precisely what a tamper-evident ledger should be holding.
 */
async function auditRejection(
  actor: string,
  question: string,
  sql: string,
  err: unknown,
  model: string,
): Promise<void> {
  try {
    await appendAudit(actor, 'NL_QUERY_REJECTED', 'query', 'nl_query', {
      question,
      sql_generated: sql,
      model,
      error_code: err instanceof ApiError ? err.code : 'UNKNOWN',
      error_message: err instanceof Error ? err.message : String(err),
    });
  } catch (auditErr) {
    console.error(
      '[nl_query] audit append failed on rejection path:',
      auditErr instanceof Error ? auditErr.message : auditErr,
    );
  }
}

/** Capability report for `/api/query/status`. Answers "can I use this" without a call. */
export interface QueryCapability {
  available: boolean;
  reason: string | null;
  model: string;
  readable_relations: readonly string[];
  max_rows: number;
  statement_timeout_ms: number;
}

export function capability(): QueryCapability {
  const configured = isConfigured();
  return {
    available: configured,
    reason: configured
      ? null
      : 'No Gemini credential is configured on the server. Set GEMINI_API_KEY in ' +
        'backend/.env and restart. This endpoint reports unavailable rather than ' +
        'answering from a template, because a fabricated answer is worse than none.',
    model: activeModel(),
    readable_relations: READABLE_RELATIONS,
    max_rows: MAX_ROWS,
    statement_timeout_ms: STATEMENT_TIMEOUT_MS,
  };
}
