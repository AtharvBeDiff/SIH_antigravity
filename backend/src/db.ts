/**
 * MPLADS Platform — Database Layer
 *
 * Wraps @supabase/supabase-js with the service-role key for backend use.
 *
 * Exports: `getDb`, `all`, `get`, `insert`, `insertMany`, `upsert`, `upsertMany`,
 * `update`, `del`, `count`, `truncateAll`, and the storage helpers. The header used
 * to advertise `run`, `scalar`, `exec` and `tx` — of those, only `exec` was ever
 * written, and it has now been removed (see below); `run`, `scalar` and `tx` never
 * existed, so a reader looking for transaction support found a promise of it here
 * and nothing in the file. There is no transaction helper: Supabase's REST interface
 * does not expose one, so multi-statement atomicity is not available through this
 * layer.
 *
 * **Service role bypasses RLS.** Every row-level security policy in
 * `supabase/full_schema.sql` is inert for requests the API makes. "The backend is
 * the trust boundary" was the previous line here, and it is only true if the backend
 * checks something — it does not: there is no authentication and no authorisation on
 * any endpoint. See `docs/API_CONTRACT.md` §11 and `actorOf` in `http.ts`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

export const SCHEMA_VERSION = '1.0.0';

// ─── Singleton client ────────────────────────────────────────

let _client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!_client) {
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !key) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. ' +
        'Copy backend/env.example to backend/.env and fill in your Supabase project credentials.'
      );
    }
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// ─── Query helpers ───────────────────────────────────────────
//
// Everything goes through the Supabase query builder. Where a query needs more than
// these helpers give — a join, an aggregate, a head-count — call `getDb()` directly
// and build it with the builder's own methods, as `routers/dashboard.ts` does.
//
// This block used to promise a `raw_sql` Postgres function for "complex queries that
// don't map to the query builder", described as executing "parameterised SQL". It
// parameterised nothing: it interpolated the query text into an `EXECUTE format`
// under `SECURITY DEFINER`. Removed, along with the `exec()` wrapper nothing called.
//
// ## Why the row generic is `T extends object` and not `Record<string, unknown>`
//
// It was `Record<string, unknown>` and produced 44 of this project's typecheck errors —
// every `all<Work>`, `get<Alert>`, `insert<Inspection>` call in the codebase. The cause is
// not the call sites: TypeScript gives an *implicit index signature* to type aliases only,
// never to an `interface`. Every row type in `types.ts` is an interface, so none of them
// satisfy `Record<string, unknown>` however well-formed they are.
//
// The constraint also bought nothing. `T` appears in exactly one place in each helper — the
// cast on the returned rows — so it constrains no argument and enables no property access.
// It was a shape assertion on the caller's type declaration style, which is why the fix is
// to drop it rather than to add `[key: string]: unknown` to twenty interfaces or convert
// them all to type aliases.
//
// `object` still rejects the primitive mistakes (`all<string>`, `all<number>`) while accepting an
// interface. It does not reject `all<number[]>` — an array is an `object` in TypeScript — so what
// survives is a guard against primitives, not a check that `T` is row-shaped. Nothing in the type
// system will stop a caller asking for a shape the table cannot return.
//
// The `as unknown as T` casts below are the honest consequence: what
// PostgREST returns is unvalidated at runtime either way, and the previous single-step cast
// only compiled because the constraint made the two types look related. Nothing here
// verifies the database's columns match the interface — that is what the migrations are for.
// ─────────────────────────────────────────────────────────────

/**
 * SELECT multiple rows from a table with optional filters.
 *
 * An unbounded call returns the whole table, paging as needed.
 *
 * PostgREST caps an unbounded SELECT at 1,000 rows and reports the cap only in
 * the Content-Range header, which this client discards. So a single request
 * returned 1,000 of 2,200 works and looked like a complete answer, and
 * everything downstream inherited the truncation in silence: `runAnalyze`
 * evaluated the first thousand works and reported the run as covering the
 * corpus, while the 1,511-row `alerts` fetch it uses to preserve officer
 * reviews came back 511 rows short, so those alerts were treated as new. Being
 * handed a fresh primary key is what made the upsert try to rewrite the id of
 * an alert a `review_action` already referenced, which is where this surfaced —
 * a foreign-key error, three layers from the cause.
 *
 * A caller that asked for a specific page still gets exactly that page. Only an
 * unbounded request pages, because only an unbounded request asks for
 * everything.
 */
export async function all<T extends object>(
  table: string,
  options?: {
    where?: Record<string, unknown>;
    orderBy?: string;
    ascending?: boolean;
    limit?: number;
    offset?: number;
    select?: string;
    /**
     * Column that makes the page order total. Defaults to `id`.
     *
     * `audit_events` has no `id` — its primary key is `seq` — so the default
     * tiebreaker would ask PostgREST to order by a column that does not exist
     * and fail the read outright. A caller whose table is keyed differently
     * names its key here.
     */
    tiebreakOn?: string;
  },
): Promise<T[]> {
  const db = getDb();

  // Rebuilt per request: a PostgREST builder carries the range it was last
  // given, so paging has to start from a clean one each time.
  const build = (tiebreak: boolean) => {
    let query = db.from(table).select(options?.select ?? '*');

    if (options?.where) {
      for (const [col, val] of Object.entries(options.where)) {
        query = val === null ? query.is(col, null) : query.eq(col, val);
      }
    }
    if (options?.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? true });
    }
    // Paging a query with no total order can repeat one row across two pages
    // and skip another entirely, because nothing obliges Postgres to return
    // the same sequence twice. `id` is the default tiebreaker: unique on every
    // table this is called for except `rule_probation`, which is keyed by
    // rule_id and holds one row per rule, so it can never reach a second page
    // and never takes this path. `tiebreakOn` overrides it for a table keyed on
    // something else.
    if (tiebreak) query = query.order(options?.tiebreakOn ?? 'id', { ascending: true });
    return query;
  };

  if (options?.limit || options?.offset) {
    let query = build(false);
    if (options.limit) query = query.limit(options.limit);
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit ?? 1000) - 1);
    }
    const { data, error } = await query;
    if (error) throw new Error(`DB all(${table}): ${error.message}`);
    return (data ?? []) as unknown as T[];
  }

  const PAGE = 1000;
  const first = await build(false).range(0, PAGE - 1);
  if (first.error) throw new Error(`DB all(${table}): ${first.error.message}`);
  const head = (first.data ?? []) as unknown as T[];
  if (head.length < PAGE) return head;

  // A full first page means there is more, and from here the order has to be
  // stable — so the whole read is reissued with the tiebreaker rather than
  // stitching an unordered first page onto ordered ones.
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(true).range(from, from + PAGE - 1);
    if (error) throw new Error(`DB all(${table}): ${error.message}`);
    const batch = (data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/** SELECT a single row by primary key or filters. */
export async function get<T extends object>(
  table: string,
  where: Record<string, unknown>,
  select?: string,
): Promise<T | null> {
  const db = getDb();
  let query = db.from(table).select(select ?? '*');

  for (const [col, val] of Object.entries(where)) {
    if (val === null) {
      query = query.is(col, null);
    } else {
      query = query.eq(col, val);
    }
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error(`DB get(${table}): ${error.message}`);
  return (data as unknown as T) ?? null;
}

/** INSERT a row. Returns the inserted row. */
export async function insert<T extends object>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const db = getDb();
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`DB insert(${table}): ${error.message}`);
  return data as T;
}

/** INSERT multiple rows. Returns inserted rows. */
export async function insertMany<T extends object>(
  table: string,
  rows: Record<string, unknown>[],
): Promise<T[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const { data, error } = await db.from(table).insert(rows).select();
  if (error) throw new Error(`DB insertMany(${table}): ${error.message}`);
  return (data ?? []) as T[];
}

/** UPSERT a row (insert or update on conflict). */
export async function upsert<T extends object>(
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
): Promise<T> {
  const db = getDb();
  const { data, error } = await db
    .from(table)
    .upsert(row, { onConflict })
    .select()
    .single();
  if (error) throw new Error(`DB upsert(${table}): ${error.message}`);
  return data as T;
}

/** UPSERT multiple rows. */
export async function upsertMany<T extends object>(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<T[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const { data, error } = await db
    .from(table)
    .upsert(rows, { onConflict })
    .select();
  if (error) throw new Error(`DB upsertMany(${table}): ${error.message}`);
  return (data ?? []) as T[];
}

/** UPDATE rows matching filters. Returns updated rows. */
export async function update<T extends object>(
  table: string,
  where: Record<string, unknown>,
  updates: Record<string, unknown>,
): Promise<T[]> {
  const db = getDb();
  let query = db.from(table).update(updates);

  for (const [col, val] of Object.entries(where)) {
    if (val === null) {
      query = query.is(col, null);
    } else {
      query = query.eq(col, val);
    }
  }

  const { data, error } = await query.select();
  if (error) throw new Error(`DB update(${table}): ${error.message}`);
  return (data ?? []) as T[];
}

/** DELETE rows matching filters. */
export async function del(
  table: string,
  where: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  let query = db.from(table).delete();

  for (const [col, val] of Object.entries(where)) {
    if (val === null) {
      query = query.is(col, null);
    } else {
      query = query.eq(col, val);
    }
  }

  const { error } = await query;
  if (error) throw new Error(`DB del(${table}): ${error.message}`);
}

/** COUNT rows in a table matching optional filters. */
export async function count(
  table: string,
  where?: Record<string, unknown>,
): Promise<number> {
  const db = getDb();
  let query = db.from(table).select('*', { count: 'exact', head: true });

  if (where) {
    for (const [col, val] of Object.entries(where)) {
      if (val === null) {
        query = query.is(col, null);
      } else {
        query = query.eq(col, val);
      }
    }
  }

  const { count: n, error } = await query;
  if (error) throw new Error(`DB count(${table}): ${error.message}`);
  return n ?? 0;
}

// ─── exec(): removed ─────────────────────────────────────────
//
// There used to be an `exec(sql, params)` here that called a `raw_sql` Postgres
// function over Supabase RPC. That function was `SECURITY DEFINER` around
// `EXECUTE format('... (%s) ...', query)` — arbitrary SQL as the function owner,
// RLS bypassed, reachable over HTTP. Its `params` argument was stringified and
// then ignored on the Postgres side, so the name suggested parameterisation that
// did not exist.
//
// Nothing called it. Not one router, service, detector or generator — the whole
// codebase went through the query builder helpers above. Keeping an unused
// arbitrary-SQL path because it might be convenient someday is how it eventually
// gets used with an interpolated string in it.
//
// If a query genuinely will not fit the builder, add a named Postgres function for
// that query with typed arguments and call it via `getDb().rpc('<name>', {...})`.
// See `supabase/migrations/011_drop_raw_sql.sql`.

/** Truncate all application tables (for reset/seed). */
export async function truncateAll(): Promise<void> {
  const tables = [
    'review_actions', 'inspection_items', 'inspections',
    'evaluation_runs', 'calibration_snapshots', 'digest_history',
    'answer_key', 'rule_probation', 'alerts', 'payments',
    'documents', 'works', 'agencies', 'constituencies', 'districts',
    'audit_events', 'field_sync_queue',
  ];

  const db = getDb();
  for (const table of tables) {
    const { error } = await db.from(table).delete().neq('id', '___never___');
    if (error) {
      // Some tables use seq, not id
      const { error: error2 } = await db.from(table).delete().gte('seq', 0);
      if (error2) {
        console.warn(`Could not truncate ${table}: ${error2.message}`);
      }
    }
  }
}

// ─── Supabase Storage helpers ────────────────────────────────

export async function uploadFile(
  bucket: string,
  path: string,
  data: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const db = getDb();
  const { error } = await db.storage.from(bucket).upload(path, data, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload(${bucket}/${path}): ${error.message}`);
  return path;
}

export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 3600,
): Promise<string> {
  const db = getDb();
  const { data, error } = await db.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  if (error) throw new Error(`Storage signedUrl(${bucket}/${path}): ${error.message}`);
  return data.signedUrl;
}

export async function downloadFile(
  bucket: string,
  path: string,
): Promise<Blob> {
  const db = getDb();
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error) throw new Error(`Storage download(${bucket}/${path}): ${error.message}`);
  return data;
}
