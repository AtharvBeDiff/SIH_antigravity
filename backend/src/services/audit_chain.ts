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
import { getDb } from '../db.ts';
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

export async function appendAudit(
  actor: string,
  action: string,
  entity_type: string,
  entity_id: string,
  payload: Record<string, unknown> = {},
): Promise<AuditEvent> {
  const head = await chainHead();
  const prev_hash = head?.this_hash ?? GENESIS_PREV_HASH;
  const seq = (head?.seq ?? 0) + 1;

  const payload_hash = sha256(canonicalJson(payload));
  const this_hash = sha256(`${seq}|${prev_hash}|${payload_hash}`);

  const row = {
    seq,
    actor,
    action,
    entity_type,
    entity_id,
    payload,
    payload_hash,
    prev_hash,
    this_hash,
    created_at: nowIso(),
  };

  const db = getDb();
  const { data, error } = await db
    .from('audit_events')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`appendAudit: ${error.message}`);
  return rowToAuditEvent(data);
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
  const db = getDb();
  const { data, error } = await db
    .from('audit_events')
    .select('*')
    .order('seq', { ascending: true });

  if (error) throw new Error(`verifyChain: ${error.message}`);
  const rows = (data ?? []).map(rowToAuditEvent);

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
