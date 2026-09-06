/**
 * Payments — the write path for the stage-payment history.
 *
 * `payments` has been in the schema since migration 001 with **zero writers**.
 * Every consumer that needed a payment history got the two-column projection on
 * `works` instead, and `works.last_payment_date` — declared, read by R-007's
 * stall detector, never written — meant that "no payment activity in N days"
 * silently measured from `sanction_date`. A work could receive four stage
 * payments and still be reported as stalled since sanction, because nothing had
 * ever told the row otherwise.
 *
 * This module is the only writer. `last_payment_date` is derived here on every
 * write rather than set by callers, so the field and the rows it summarises
 * cannot disagree — the failure mode a denormalised column exists to trade
 * against, and worth avoiding by having exactly one place that maintains it.
 */

import { getDb, upsertMany } from '../db.ts';
import type { Payment } from '../types.ts';
import { isPaymentStage, type PaymentStage } from './fund_flow.ts';
import { newId, nowIso } from '../util.ts';

/** A payment as supplied by a caller, before ids and ordering are assigned. */
export interface PaymentInput {
  work_id: string;
  amount: number;
  payment_date: string;
  stage: PaymentStage | string;
  /** Optional: assigned from the work's existing history when omitted. */
  sequence_number?: number;
  pfms_reference?: string | null;
  purpose?: string | null;
}

export interface PaymentWriteResult {
  written: number;
  works_touched: number;
  /** Inputs rejected, with the reason. Never silently dropped. */
  rejected: Array<{ input: PaymentInput; reason: string }>;
}

/**
 * Validate one payment input.
 *
 * Returns a reason string when the input cannot be written, or null when it can.
 * A rejected payment is reported to the caller rather than skipped: a payment
 * that vanishes on the way in is a work that looks unfunded, which is exactly the
 * finding R-014 would then report — a fabricated one.
 */
function rejectionReason(p: PaymentInput): string | null {
  if (!p.work_id) return 'no work_id';
  if (typeof p.amount !== 'number' || !Number.isFinite(p.amount)) return 'amount is not a number';
  if (p.amount <= 0) return 'amount must be positive';
  if (!p.payment_date || !/^\d{4}-\d{2}-\d{2}/.test(p.payment_date)) {
    return 'payment_date must be YYYY-MM-DD';
  }
  if (!isPaymentStage(p.stage)) return `unknown stage '${p.stage}'`;
  return null;
}

/**
 * Write stage payments and refresh `works.last_payment_date` for every work
 * touched.
 *
 * A payment is identified by its `(work_id, sequence_number)` slot: the slot is
 * resolved against the existing history first and the row is then written under
 * whatever id already occupies it, so re-ingesting the same payment file updates
 * stage 3 rather than appending a second copy of it. Sequence numbers are assigned
 * from the work's existing history when the caller does not supply one, which is
 * the common case for an append.
 */
export async function writePayments(inputs: PaymentInput[]): Promise<PaymentWriteResult> {
  const rejected: Array<{ input: PaymentInput; reason: string }> = [];
  const accepted: PaymentInput[] = [];

  for (const p of inputs) {
    const reason = rejectionReason(p);
    if (reason) rejected.push({ input: p, reason });
    else accepted.push(p);
  }

  if (accepted.length === 0) {
    return { written: 0, works_touched: 0, rejected };
  }

  const db = getDb();
  const workIds = [...new Set(accepted.map((p) => p.work_id))];

  // Existing rows, so an append continues the sequence instead of colliding with
  // it and so an upsert can reuse the row's id rather than orphaning it.
  const { data: existingRows, error: existingErr } = await db
    .from('payments')
    .select('id, work_id, sequence_number')
    .in('work_id', workIds);
  if (existingErr) throw existingErr;

  const existingIdBySlot = new Map<string, string>();
  const nextSeq = new Map<string, number>();
  for (const row of existingRows ?? []) {
    existingIdBySlot.set(`${row.work_id}::${row.sequence_number}`, row.id);
    const current = nextSeq.get(row.work_id) ?? 0;
    if (typeof row.sequence_number === 'number' && row.sequence_number > current) {
      nextSeq.set(row.work_id, row.sequence_number);
    }
  }

  const rows: Payment[] = [];
  for (const p of accepted) {
    let seq = p.sequence_number;
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 1) {
      seq = (nextSeq.get(p.work_id) ?? 0) + 1;
      nextSeq.set(p.work_id, seq);
    }
    const slot = `${p.work_id}::${seq}`;
    rows.push({
      id: existingIdBySlot.get(slot) ?? newId(),
      work_id: p.work_id,
      amount: p.amount,
      payment_date: p.payment_date.slice(0, 10),
      stage: p.stage as string,
      sequence_number: seq,
      pfms_reference: p.pfms_reference ?? null,
      purpose: p.purpose ?? null,
      created_at: nowIso(),
    });
  }

  // `upsertMany` constrains its rows to `Record<string, unknown>`, which none of
  // the domain interfaces in `types.ts` declare an index signature for — the same
  // mismatch behind most of this package's pre-existing type errors. Widened at
  // this single call site so `rows` stays checked against `Payment` where it is
  // built, which is where a mistyped column name would actually originate.
  await upsertMany('payments', rows as unknown as Record<string, unknown>[], 'id');
  await refreshLastPaymentDates(workIds);

  return { written: rows.length, works_touched: workIds.length, rejected };
}

/**
 * Recompute `works.last_payment_date` from the payment rows for the given works.
 *
 * Reads back rather than using the values just written: a work may already have
 * later payments than the batch being written, and the column has to reflect the
 * whole history or it is worse than absent — R-007 would report a stall that
 * ended two payments ago.
 *
 * A work with no payments is set to null, not left alone. Deleting the last
 * payment must clear the field; leaving a stale date would keep a work looking
 * active on the strength of a payment that no longer exists.
 */
export async function refreshLastPaymentDates(workIds: string[]): Promise<number> {
  if (workIds.length === 0) return 0;
  const db = getDb();

  const { data: rows, error } = await db
    .from('payments')
    .select('work_id, payment_date')
    .in('work_id', workIds);
  if (error) throw error;

  const latest = new Map<string, string>();
  for (const row of rows ?? []) {
    if (!row.work_id || !row.payment_date) continue;
    const current = latest.get(row.work_id);
    if (!current || row.payment_date > current) latest.set(row.work_id, row.payment_date);
  }

  let updated = 0;
  for (const workId of workIds) {
    const { error: updErr } = await db
      .from('works')
      .update({ last_payment_date: latest.get(workId) ?? null, updated_at: nowIso() })
      .eq('id', workId);
    if (updErr) throw updErr;
    updated += 1;
  }
  return updated;
}

/** Every payment in the corpus, for the analysis pass. */
export async function allPayments(): Promise<Payment[]> {
  const db = getDb();
  const { data, error } = await db
    .from('payments')
    .select('*')
    .order('work_id')
    .order('sequence_number');
  if (error) throw error;
  return (data ?? []) as Payment[];
}
