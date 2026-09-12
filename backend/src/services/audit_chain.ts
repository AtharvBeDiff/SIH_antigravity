/**
 * MPLADS Platform — Tamper-Evident Audit Chain
 *
 * Append-only hash-chained log. Every state mutation calls appendAudit().
 *
 * Chain formula (load-bearing, matched byte-for-byte by tests):
 *   payload_hash = sha256(canonicalJson(payload))
 *   this_hash    = sha256(`${seq}|${prev_hash}|${payload_hash}`)
 *   genesis prev_hash = '0'.repeat(64)
 *
 * Honest claim: retroactive edits cannot be silent — NOT
 * "blockchain-grade immutability."
 */

import { canonicalJson, sha256, nowIso } from '../util.ts';
import { all, getDb } from '../db.ts';
import type { AuditEvent } from '../types.ts';

const GENESIS_PREV_HASH = '0'.repeat(64);

// ─── Read ────────────────────────────────────────────────────

export async function chainHead(): Promise<{ seq: number; this_hash: string } | null> {
  const db = getDb();
  const { data, error } = await db
    .from('audit_events')
    .select('seq, this_hash')
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`chainHead: ${error.message}`);
  if (!data) return null;
  return { seq: data.seq, this_hash: data.this_hash };
}

export async function readAudit(options?: {
  entity_type?: string;
  entity_id?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditEvent[]> {
  const db = getDb();
  let query = db.from('audit_events').select('*');

  if (options?.entity_type) query = query.eq('entity_type', options.entity_type);
  if (options?.entity_id) query = query.eq('entity_id', options.entity_id);

  query = query.order('seq', { ascending: true });

  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) {
    const lim = options.limit ?? 100;
    query = query.range(options.offset, options.offset + lim - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error(`readAudit: ${error.message}`);
  return (data ?? []).map(rowToAuditEvent);
}

// ─── Write ───────────────────────────────────────────────────

/**
 * Append one event to the chain.
 *
 * Read-then-insert, and `seq` is the primary key, so two appends that read the
 * same head both compute the same `seq` and one of them loses on the unique
 * index. That is not hypothetical: the analysis pipeline appends, every review
 * action appends, and ingest appends — two officers clicking at once, or the
 * test files the runner executes in parallel against the same database, is
 * enough. It surfaced as `duplicate key value violates unique constraint
 * "audit_events_pkey"` and took the whole request down with it.
 *
 * The loser retries from a freshly read head rather than being given a gap to
 * fill. That keeps the chain doing what it exists to do: `seq` stays contiguous
 * and each `prev_hash` still names the row actually before it, which is what
 * `verifyChain` checks. Recomputation is required, not optional — `this_hash`
 * commits to both `seq` and `prev_hash`, so reusing the first attempt's hash
 * under a new `seq` would write a row that fails verification.
 *
 * A bounded number of attempts, because a retry loop that never gives up turns
 * contention into a hang. Exhausting them throws, and the caller sees a failed
 * append instead of an event silently missing from the log.
 *
 * This does not make concurrent appends correct in general — the window between
 * the read and the insert is still there, and under sustained write pressure the
 * honest fix is to have the database allocate `seq`. It makes the collision
 * recoverable rather than fatal.
 */
export async function appendAudit(
  actor: string,
  action: string,
  entity_type: string,
  entity_id: string,
  payload: Record<string, unknown> = {},
): Promise<AuditEvent> {
  const db = getDb();
  // Hashed once: the payload is the same on every attempt, only its position in
  // the chain changes.
  const payload_hash = sha256(canonicalJson(payload));

  const MAX_ATTEMPTS = 6;
  // Per-writer backoff offset, derived from who is writing what.
  //
  // Two writers need *different* delays or they simply re-collide in lockstep on
  // every attempt. The usual source of that difference is random jitter, and
  // `Math.random()` is banned here — the determinism claim in
  // `docs/ARCHITECTURE.md` is absolute and worth more than the convenience. This
  // spreads them apart using a value they already differ on: the actor, the
  // action and the payload digest.
  const jitterMs = parseInt(sha256(`${actor}|${action}|${entity_id}|${payload_hash}`).slice(0, 2), 16) % 40;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const head = await chainHead();
    const prev_hash = head?.this_hash ?? GENESIS_PREV_HASH;
    const seq = (head?.seq ?? 0) + 1;

    const row = {
      seq,
      actor,
      action,
      entity_type,
      entity_id,
      payload,
      payload_hash,
      prev_hash,
      this_hash: sha256(`${seq}|${prev_hash}|${payload_hash}`),
      created_at: nowIso(),
    };

    const { data, error } = await db
      .from('audit_events')
      .insert(row)
      .select()
      .single();

    if (!error) return rowToAuditEvent(data);

    // 23505 is Postgres' unique_violation. Only that one is retried: any other
    // failure is not a race, and retrying it would hide the real cause behind
    // six identical attempts.
    if (error.code !== '23505' || attempt === MAX_ATTEMPTS) {
      throw new Error(`appendAudit: ${error.message}`);
    }
    lastError = error.message;

    // Backoff grows with the attempt so sustained contention thins out, offset
    // per writer so colliding writers do not line up again.
    await new Promise((resolve) => setTimeout(resolve, attempt * 25 + jitterMs));
  }

  // Unreachable: the loop either returns or throws. Present so the function has
  // no implicit fall-through if MAX_ATTEMPTS is ever edited to zero.
  throw new Error(`appendAudit: exhausted ${MAX_ATTEMPTS} attempts (${lastError})`);
}

export async function appendAuditMany(
  events: Array<{
    actor: string;
    action: string;
    entity_type: string;
    entity_id: string;
    payload?: Record<string, unknown>;
  }>,
): Promise<AuditEvent[]> {
  if (events.length === 0) return [];

  const results: AuditEvent[] = [];
  for (const evt of events) {
    const result = await appendAudit(
      evt.actor,
      evt.action,
      evt.entity_type,
      evt.entity_id,
      evt.payload ?? {},
    );
    results.push(result);
  }
  return results;
}

// ─── Verification ────────────────────────────────────────────

export interface ChainVerification {
  valid: boolean;
  checked: number;
  first_break: {
    seq: number;
    expected_hash: string;
    actual_hash: string;
    reason: string;
  } | null;
}

export async function verifyChain(): Promise<ChainVerification> {
  // Via `all()` because it pages, with `seq` as the tiebreaker — `audit_events`
  // has no `id` column.
  //
  // The direct `.select()` this replaced stopped at PostgREST's 1,000-row
  // default, so verification covered the first thousand entries and reported
  // `valid: true` over them. The endpoint's whole claim is that the log is
  // tamper-evident; a verifier that silently stops a thousand rows in gives the
  // answer "nothing has been altered" about a prefix, while presenting it as an
  // answer about the chain. Everything after the cap was unexamined, and the
  // `checked` count was the only hint — a figure no reader has a reason to
  // compare against the table's size.
  const rows = await all<Record<string, unknown>>('audit_events', {
    orderBy: 'seq',
    ascending: true,
    tiebreakOn: 'seq',
  }).then((data) => data.map(rowToAuditEvent));

  if (rows.length === 0) {
    return { valid: true, checked: 0, first_break: null };
  }

  let prev_hash = GENESIS_PREV_HASH;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const expectedSeq = i + 1;

    // Check seq continuity
    if (row.seq !== expectedSeq) {
      return {
        valid: false,
        checked: i,
        first_break: {
          seq: row.seq,
          expected_hash: `seq should be ${expectedSeq}`,
          actual_hash: `seq is ${row.seq}`,
          reason: 'SEQUENCE_GAP',
        },
      };
    }

    // Check prev_hash linkage
    if (row.prev_hash !== prev_hash) {
      return {
        valid: false,
        checked: i,
        first_break: {
          seq: row.seq,
          expected_hash: prev_hash,
          actual_hash: row.prev_hash,
          reason: 'PREV_HASH_MISMATCH',
        },
      };
    }

    // Recompute payload hash
    const expected_payload_hash = sha256(canonicalJson(row.payload));
    if (row.payload_hash !== expected_payload_hash) {
      return {
        valid: false,
        checked: i,
        first_break: {
          seq: row.seq,
          expected_hash: expected_payload_hash,
          actual_hash: row.payload_hash,
          reason: 'PAYLOAD_TAMPERED',
        },
      };
    }

    // Recompute this_hash
    const expected_this_hash = sha256(`${row.seq}|${row.prev_hash}|${row.payload_hash}`);
    if (row.this_hash !== expected_this_hash) {
      return {
        valid: false,
        checked: i,
        first_break: {
          seq: row.seq,
          expected_hash: expected_this_hash,
          actual_hash: row.this_hash,
          reason: 'HASH_MISMATCH',
        },
      };
    }

    prev_hash = row.this_hash;
  }

  return { valid: true, checked: rows.length, first_break: null };
}

// ─── Demo tamper/restore (DEMO_MODE only) ────────────────────

export async function demoTamper(seq: number): Promise<void> {
  if (process.env['DEMO_MODE'] !== 'true') {
    throw new Error('demoTamper is only available in DEMO_MODE');
  }

  const db = getDb();
  const { data, error } = await db
    .from('audit_events')
    .select('*')
    .eq('seq', seq)
    .single();

  if (error || !data) throw new Error(`No audit event at seq ${seq}`);

  // Tamper the payload
  const tamperedPayload = { ...(data.payload as Record<string, unknown>), _tampered: true };

  await db
    .from('audit_events')
    .update({ payload: tamperedPayload })
    .eq('seq', seq);
}

export async function demoRestore(seq: number): Promise<void> {
  if (process.env['DEMO_MODE'] !== 'true') {
    throw new Error('demoRestore is only available in DEMO_MODE');
  }

  const db = getDb();
  const { data, error } = await db
    .from('audit_events')
    .select('*')
    .eq('seq', seq)
    .single();

  if (error || !data) throw new Error(`No audit event at seq ${seq}`);

  // Restore by removing the tamper flag
  const payload = { ...(data.payload as Record<string, unknown>) };
  delete payload['_tampered'];

  // Recompute hashes
  const payload_hash = sha256(canonicalJson(payload));

  await db
    .from('audit_events')
    .update({ payload, payload_hash })
    .eq('seq', seq);
}

// ─── Helpers ─────────────────────────────────────────────────

function rowToAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    seq: row['seq'] as number,
    actor: row['actor'] as string,
    action: row['action'] as string,
    entity_type: row['entity_type'] as string,
    entity_id: row['entity_id'] as string,
    payload: (row['payload'] ?? {}) as Record<string, unknown>,
    payload_hash: row['payload_hash'] as string,
    prev_hash: row['prev_hash'] as string,
    this_hash: row['this_hash'] as string,
    created_at: row['created_at'] as string,
  };
}
