/**
 * MPLADS Platform — Database Layer
 *
 * Wraps @supabase/supabase-js with service role key for backend use.
 * Provides query helpers that match the HANDOFF contract signatures
 * (all, get, run, exec, scalar, count, tx) so routers/services
 * are DB-agnostic.
 *
 * Service role bypasses RLS — the backend is the trust boundary.
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
        'Copy .env.example to .env and fill in your Supabase project credentials.'
      );
    }
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// ─── Raw SQL via Supabase rpc (pg functions) ─────────────────
//
// For complex queries that don't map to the Supabase query builder,
// we use a Postgres function `raw_sql` that executes parameterised SQL.
// This function must be created in the migration.
//
// For simple CRUD, we use the Supabase query builder directly.
// ─────────────────────────────────────────────────────────────

/** SELECT multiple rows from a table with optional filters. */
export async function all<T extends Record<string, unknown>>(
  table: string,
  options?: {
    where?: Record<string, unknown>;
    orderBy?: string;
    ascending?: boolean;
    limit?: number;
    offset?: number;
    select?: string;
  },
): Promise<T[]> {
  const db = getDb();
  let query = db.from(table).select(options?.select ?? '*');

  if (options?.where) {
    for (const [col, val] of Object.entries(options.where)) {
      if (val === null) {
        query = query.is(col, null);
      } else {
        query = query.eq(col, val);
      }
    }
  }

  if (options?.orderBy) {
    query = query.order(options.orderBy, {
      ascending: options.ascending ?? true,
    });
  }

  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.range(
    options.offset,
    options.offset + (options.limit ?? 1000) - 1,
  );

  const { data, error } = await query;
  if (error) throw new Error(`DB all(${table}): ${error.message}`);
  return (data ?? []) as T[];
}

/** SELECT a single row by primary key or filters. */
export async function get<T extends Record<string, unknown>>(
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
  return (data as T) ?? null;
}

/** INSERT a row. Returns the inserted row. */
export async function insert<T extends Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const db = getDb();
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`DB insert(${table}): ${error.message}`);
  return data as T;
}

/** INSERT multiple rows. Returns inserted rows. */
export async function insertMany<T extends Record<string, unknown>>(
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
export async function upsert<T extends Record<string, unknown>>(
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
export async function upsertMany<T extends Record<string, unknown>>(
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
export async function update<T extends Record<string, unknown>>(
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

/** Execute raw SQL via Supabase RPC. Requires `raw_sql` function in DB. */
export async function exec<T = unknown>(
  sql: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const db = getDb();
  const { data, error } = await db.rpc('raw_sql', {
    query: sql,
    params: JSON.stringify(params),
  });
  if (error) throw new Error(`DB exec: ${error.message}\nSQL: ${sql}`);
  return (data ?? []) as T[];
}

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
