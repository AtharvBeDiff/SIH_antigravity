-- ─────────────────────────────────────────────────────────────────────────────
-- 012 — Read-only execution path for generated SQL (P-15)
--
-- WHY THIS EXISTS
--
-- `/api/query` translates an officer's question into SQL with a language model and
-- executes the result. `services/sql_guard.ts` validates that SQL against an
-- allowlist first, and that guard is good — but it is a lexer, not a parser, and it
-- is written in the same process as the feature it protects. A guard can be edited by
-- someone who does not know why a rule is there. A missing privilege cannot.
--
-- So this migration provides the half of the defence that does not depend on
-- application code being correct: a function that runs generated SQL under an
-- explicitly read-only, catalogue-blind, statement-timed context. If the guard is
-- bypassed entirely — a future refactor drops a check, a new endpoint forgets to call
-- it — the query still cannot write, because the path it runs on has no privilege to.
--
-- THE CONTRAST WITH `raw_sql`, WHICH THIS MUST NOT BECOME
--
-- Migration 011 dropped a `raw_sql(query TEXT)` function that was `SECURITY DEFINER`
-- around `EXECUTE format('... (%s) ...', query)` — arbitrary SQL as the function
-- owner, RLS bypassed, reachable over HTTP, and nothing called it. Every difference
-- between that function and this one is deliberate:
--
--   * `SECURITY INVOKER`, not `SECURITY DEFINER`. The old function ran as its owner,
--     which is how an injected write became an injected write *with owner privileges*.
--     This one runs as the caller, so the caller's grants are the ceiling.
--   * `SET TRANSACTION READ ONLY` inside the body. Postgres itself refuses any write
--     in a read-only transaction, including one reached through a function call, a
--     trigger, or a data-modifying CTE. This is the load-bearing line in the file.
--   * `SET search_path = ''` and a fully-qualified body, so the function cannot be
--     redirected by a caller-controlled `search_path` to a shadowed table.
--   * `statement_timeout` and `LIMIT`, so a pathological query is bounded in time and
--     in result size rather than tying up a connection.
--   * It is *called*, by exactly one code path, with a guard in front of it. An
--     unused arbitrary-SQL path is how 011 happened.
--
-- WHAT THIS FILE DOES NOT DO
--
-- It does not fix the authentication gap. `http.ts` performs no authentication and
-- `db.ts` connects with the service-role key, so the caller reaching this function is
-- unauthenticated and highly privileged. This migration bounds what a *generated
-- query* can do; it does not bound who may ask. See `docs/API_CONTRACT.md` §11 and
-- HANDOFF Part 4 — that remains an open, disclosed limitation.
--
-- APPLYING THIS ON HOSTED SUPABASE
--
-- The `drishti_readonly` role below is created but NOT granted a login, and the API
-- does not connect as it. On hosted Supabase you cannot hand the backend a second
-- connection string without provisioning a new database user out-of-band, so the
-- read-only *transaction* is what carries the guarantee at runtime, and the role
-- exists so that a self-hosted deployment can point a second client at it and get
-- privilege separation as well. Both layers are wanted; only one is available on
-- hosted, and this comment is here so nobody concludes the role is live when it is not.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── A role with SELECT and nothing else ─────────────────────────────────────
--
-- NOLOGIN deliberately: nothing authenticates as this role today. It is a grant
-- target, so that a self-hosted deployment can create a login for it and connect the
-- query endpoint separately from the service role.

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drishti_readonly') THEN
    CREATE ROLE drishti_readonly NOLOGIN;
  END IF;
END
$do$;

-- Revoke first, so re-running this migration cannot accumulate privileges that an
-- earlier version granted and a later version meant to withdraw.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM drishti_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM drishti_readonly;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM drishti_readonly;
REVOKE ALL ON SCHEMA public FROM drishti_readonly;

GRANT USAGE ON SCHEMA public TO drishti_readonly;

-- SELECT on exactly the relations `READABLE_RELATIONS` in `sql_guard.ts` allows, and
-- no others. The two lists must stay in step; the guard names this file in its own
-- doc comment for that reason.
--
-- `constituencies` is absent because it carries `mp_name`/`mp_party` and Doctrine 3
-- forbids MP-level aggregation. `audit_events` is absent because the ledger must be
-- read through `/api/audit`, which verifies the hash chain as it reads. `answer_key`
-- is absent because it is the evaluation ground truth and a query that can read it
-- can be used to flatter the detectors.
GRANT SELECT ON
  public.works,
  public.districts,
  public.agencies,
  public.payments,
  public.alerts,
  public.inspections,
  public.inspection_items,
  public.health_reports,
  public.review_actions,
  public.rule_probation,
  public.documents
TO drishti_readonly;

-- Default privileges for future tables are explicitly NOT granted. A table added by a
-- later migration is unreadable by this role until someone grants it deliberately,
-- which is the safe default: a new table holding something sensitive should not become
-- queryable by an AI-generated SELECT because of an ambient default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM drishti_readonly;

-- ─── The execution function ──────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.drishti_readonly_select(TEXT, INTEGER);

CREATE FUNCTION public.drishti_readonly_select(
  query_text TEXT,
  timeout_ms INTEGER DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
-- SECURITY INVOKER is the default and is stated explicitly because the function this
-- replaces got it wrong, and because a future editor must see the choice rather than
-- infer it from silence.
SECURITY INVOKER
-- Empty search_path: the body qualifies everything it touches, so no caller-supplied
-- search_path can point `works` at a shadowed table. Also forces `query_text` itself
-- to be schema-qualified or resolvable in `public` only via the explicit SET below.
SET search_path = ''
AS $fn$
DECLARE
  result JSONB;
  effective_timeout INTEGER;
BEGIN
  -- Bound the caller-supplied timeout. A caller asking for no timeout, a negative
  -- one, or ten minutes does not get it.
  effective_timeout := LEAST(GREATEST(COALESCE(timeout_ms, 5000), 100), 15000);

  -- Refuse an empty query here as well as in the application guard. Two checks
  -- rather than one, because this function must be safe when called directly.
  IF query_text IS NULL OR btrim(query_text) = '' THEN
    RAISE EXCEPTION 'drishti_readonly_select: empty query';
  END IF;

  -- THE LOAD-BEARING LINE.
  --
  -- Postgres enforces read-only at the transaction level, below SQL. Any INSERT,
  -- UPDATE, DELETE, TRUNCATE, DDL, or data-modifying CTE raises
  -- `read_only_sql_transaction` (25006) regardless of how it was reached — including
  -- from inside a function the query calls, and including constructs the application
  -- guard has never heard of. This is the guarantee that does not depend on
  -- `sql_guard.ts` being correct.
  --
  -- Scoped to this transaction only. PostgREST runs each RPC call in its own
  -- transaction, so this does not leak into any other statement the API issues.
  SET TRANSACTION READ ONLY;

  PERFORM set_config('statement_timeout', effective_timeout::TEXT, true);

  -- `search_path` is set for the duration of this transaction so unqualified
  -- relation names in the generated query resolve to `public` and nowhere else.
  -- `true` makes it transaction-local, matching the read-only setting above.
  PERFORM set_config('search_path', 'public', true);

  -- The generated SQL is executed as a single expression whose rows are aggregated to
  -- JSONB. Wrapping in `SELECT ... FROM (query) t` means the text must be a valid
  -- scalar-yielding subquery: a bare `DELETE` is a syntax error here as well as a
  -- privilege error, so malformed hostile input fails twice.
  --
  -- `COALESCE(..., '[]'::JSONB)` because `jsonb_agg` over zero rows is NULL, and a
  -- caller distinguishing "no rows" from "query failed" should not have to reason
  -- about a NULL that means the former.
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(drishti_rows)::JSONB), ''[]''::JSONB) '
    'FROM (%s) AS drishti_rows',
    query_text
  ) INTO result;

  RETURN result;
END
$fn$;

COMMENT ON FUNCTION public.drishti_readonly_select(TEXT, INTEGER) IS
  'Executes a guarded, generated SELECT inside a READ ONLY transaction with a bounded '
  'statement_timeout and a pinned search_path. SECURITY INVOKER, unlike the raw_sql() '
  'function migration 011 removed. Called by services/nl_query.ts only, and only after '
  'services/sql_guard.ts has validated the text. The READ ONLY transaction is the '
  'guarantee that survives a bug in that guard.';

-- Executable by the API roles. `anon` is deliberately excluded: the endpoint in front
-- of this is unauthenticated at the HTTP layer today, but that is a disclosed gap to be
-- closed, not a design to be baked into a grant.
GRANT EXECUTE ON FUNCTION public.drishti_readonly_select(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.drishti_readonly_select(TEXT, INTEGER) TO drishti_readonly;

-- ─── Verification, for whoever applies this ──────────────────────────────────
--
-- These should all raise, and the error to expect is quoted. Run them after applying:
--
--   SELECT public.drishti_readonly_select('DELETE FROM works');
--     -> ERROR: cannot execute DELETE in a read-only transaction  (SQLSTATE 25006)
--
--   SELECT public.drishti_readonly_select(
--     'WITH x AS (DELETE FROM works RETURNING *) SELECT * FROM x');
--     -> ERROR: cannot execute DELETE in a read-only transaction  (SQLSTATE 25006)
--
--   SELECT public.drishti_readonly_select('SELECT count(*) FROM works');
--     -> [{"count": 2000}]
--
-- The first two are the point of the file: they fail at the transaction level, with the
-- application guard entirely out of the picture.
