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

import { all, getDb, upsertMany } from '../db.ts';
import type { Payment } from '../types.ts';
import { isPaymentStage, type PaymentStage } from './fund_flow.ts';
import { newId, nowIso } from '../util.ts';

/**
 * How many work ids may travel in one PostgREST `in` filter.
 *
 * The filter is serialised into the query string, so the bound is the URL length
 * the server accepts, not a row count. 200 ids of 36 characters leaves the URL
 * comfortably under 8 KB with the rest of the query.
 */
const WORK_ID_CHUNK = 200;

/**
 * How many payment rows may travel in one upsert body.
 *
 * A body is not a URL and Postgres is happy with far more, but the response
 * carries every written row back — `upsertMany` calls `.select()` — so an
 * unbounded batch means a multi-megabyte round trip in both directions.
 */
const PAYMENT_WRITE_CHUNK = 500;

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
  //
  // Chunked because a PostgREST `in` filter travels in the URL. Unbounded, an
  // ingest of the 2,000-row reference export put 2,000 ids into a single query
  // string — roughly 74 KB, past what the server will accept — so the lookup
  // failed outright and the whole import with it.
  const existingRows: Array<{ id: string; work_id: string; sequence_number: number | null }> = [];
  for (let i = 0; i < workIds.length; i += WORK_ID_CHUNK) {
    const { data, error } = await db
      .from('payments')
      .select('id, work_id, sequence_number')
      .in('work_id', workIds.slice(i, i + WORK_ID_CHUNK));
    if (error) throw error;
    existingRows.push(...((data ?? []) as typeof existingRows));
  }

  const existingIdBySlot = new Map<string, string>();
  const nextSeq = new Map<string, number>();
  for (const row of existingRows) {
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
  for (let i = 0; i < rows.length; i += PAYMENT_WRITE_CHUNK) {
    const batch = rows.slice(i, i + PAYMENT_WRITE_CHUNK);
    await upsertMany('payments', batch as unknown as Record<string, unknown>[], 'id');
  }
  await refreshLastPaymentDates(workIds);

  return { written: rows.length, works_touched: workIds.length, rejected };
}

/**
 * Recompute `works.last_payment_date` from the payment rows for the given works.
 *
 * Delegated to `drishti_refresh_last_payment_dates` (migration 019), which does
 * it as a single UPDATE ... FROM. This function used to read the payments back,
 * reduce them to a maximum per work in TypeScript, and then issue one UPDATE per
 * work in a sequential loop — 2,000 serial round trips for the reference export,
 * inside the ingest request that had already written the works. Grouping the
 * works by date first was measured and only takes that to 880, because the
 * corpus holds 878 distinct last-payment dates. The derivation is
 * `MAX(payment_date)` per work; SQL does it in one statement.
 *
 * The maximum is still computed from the rows on disk rather than from the batch
 * just written: a work may already have later payments than the batch, and the
 * column has to reflect the whole history or it is worse than absent — R-007
 * would report a stall that ended two payments ago.
 *
 * A work with no payments is set to null, not left alone. Deleting the last
 * payment must clear the field; leaving a stale date would keep a work looking
 * active on the strength of a payment that no longer exists.
 *
 * Returns the number of works whose stored value actually changed, which is not
 * the number supplied — a work already carrying the right date is not rewritten,
 * so re-ingesting an unchanged file does not restamp `updated_at` across the
 * corpus.
 */
export async function refreshLastPaymentDates(workIds: string[]): Promise<number> {
  if (workIds.length === 0) return 0;
  const db = getDb();

  // Chunked for the same reason as the lookup above: the array is sent as a JSON
  // body here rather than in the URL, but keeping one bound for "how many work
  // ids travel at once" means there is one number to reason about.
  let changed = 0;
  for (let i = 0; i < workIds.length; i += WORK_ID_CHUNK) {
    const { data, error } = await db.rpc('drishti_refresh_last_payment_dates', {
      work_ids: workIds.slice(i, i + WORK_ID_CHUNK),
    });
    if (error) throw error;
    changed += typeof data === 'number' ? data : 0;
  }
  return changed;
}

/** Every payment in the corpus, for the analysis pass. */
export async function allPayments(): Promise<Payment[]> {
  // Via `all()` because it pages. A direct `.select()` is capped at 1,000 rows
  // by PostgREST, and this feeds the rule engine: R-002, R-012 and R-014 all
  // read a work's payment history, and a work missing from the result is not
  // distinguishable from a work that was never paid. Against 7,469 payments the
  // cap returned the first ~300 works' history and nothing for the rest, so
  // R-014 raised 539 "no payment in 90 days" alerts where 75 works qualify and
  // R-012 raised 130 where 29 do. Every one of the surplus was the fetch limit
  // being reported as a finding about a contractor.
  //
  // Sorted here rather than in the query: `all()` pages with an `id` tiebreaker
  // to keep the sequence stable across requests, so the ordering has to be
  // reimposed once the whole set is in hand.
  const rows = await all<Payment>('payments');
  return rows.sort((a, b) =>
    a.work_id === b.work_id
      ? (a.sequence_number ?? 0) - (b.sequence_number ?? 0)
      : String(a.work_id).localeCompare(String(b.work_id)),
  );
}
