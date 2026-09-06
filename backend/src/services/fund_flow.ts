/**
 * Fund Flow — payment stages and the regime boundaries they sit inside.
 *
 * This is the domain half of the `payments` work: the stage vocabulary, the
 * regime lookup, and pure arithmetic over a work's payment history. Nothing here
 * touches the database; `services/payments.ts` is the write path.
 *
 * The problem this replaces: `works.first_installment` and
 * `works.second_installment` were the whole model of fund flow. Two columns
 * cannot hold an N-stage history, cannot express "no payment for an extended
 * period" (there is no date on either of them), and cannot be reconciled against
 * PFMS, which settles per payment and not per work. The `payments` table has been
 * in the schema since the first migration with zero writers, so the rules that
 * reasoned about money were reading the lossy projection instead of the history.
 *
 * MPLADS payment is stage-wise: the implementing agency raises a bill against
 * measured work, the district authority sanctions a release, money moves. That
 * repeats as often as the work has stages. `installment_number` — an integer that
 * defaulted to 1 — could order those events but could not say what any of them
 * was for, which is the part every rule below actually needs.
 */

import type { Payment, RuleDefinition } from '../types.ts';
import { loadRulesConfig } from './catalogue.ts';

// ─── Payment stages ─────────────────────────────────────────

/**
 * The stage vocabulary. A payment's stage says what the money was *for*, which is
 * what distinguishes a normal advance from an irregular release.
 *
 * `MOBILISATION_ADVANCE` is the one that has to be named separately: it is paid
 * against a bank guarantee *before* any work is measured, so it is money ahead of
 * progress by design. A rule that treats all payments alike flags every work that
 * received one — the normal case — and that is why R-002 excludes it explicitly
 * rather than relying on a threshold to absorb it.
 */
export const PAYMENT_STAGES = [
  'MOBILISATION_ADVANCE',
  'RUNNING_BILL',
  'FINAL_BILL',
  'RETENTION_RELEASE',
] as const;

export type PaymentStage = (typeof PAYMENT_STAGES)[number];

export function isPaymentStage(value: unknown): value is PaymentStage {
  return typeof value === 'string' && (PAYMENT_STAGES as readonly string[]).includes(value);
}

/** Human label for a stage key, for evidence text and the work detail table. */
export const PAYMENT_STAGE_LABELS: Record<PaymentStage, string> = {
  MOBILISATION_ADVANCE: 'Mobilisation advance',
  RUNNING_BILL: 'Running account bill',
  FINAL_BILL: 'Final bill',
  RETENTION_RELEASE: 'Retention release',
};

/**
 * Stages that are only payable against a measurement.
 *
 * Derived from the vocabulary by subtracting the advance, rather than listed
 * separately, so adding a stage above cannot silently omit it from the rules that
 * check whether money moved ahead of measured work.
 */
export const MEASURED_STAGES: readonly PaymentStage[] = PAYMENT_STAGES.filter(
  (s) => s !== 'MOBILISATION_ADVANCE',
);

// ─── Regime boundaries ──────────────────────────────────────

export interface FundFlowRegime {
  id: string;
  name: string;
  /** Inclusive start, 'YYYY-MM-DD'. Null means open-ended in the past. */
  starts: string | null;
  /** Inclusive end, 'YYYY-MM-DD'. Null means current. */
  ends: string | null;
  verification_status?: string;
  notes?: string;
}

/**
 * The regimes, read from `rules/mplads_rules.yaml`.
 *
 * Read from the catalogue rather than hardcoded here for the same reason the
 * delay thresholds are: a boundary date that only exists inside a `.ts` file is
 * invisible on /rules, and a reviewer cannot check a number they cannot see.
 */
export function loadFundFlowRegimes(): FundFlowRegime[] {
  const config = loadRulesConfig() as unknown as { fund_flow_regimes?: FundFlowRegime[] };
  const declared = config.fund_flow_regimes;
  if (!Array.isArray(declared)) return [];
  return declared.filter((r) => r && typeof r.id === 'string');
}

/**
 * The regime a date falls in, or null when the catalogue declares none covering
 * it. Null is a real answer — it means the boundary table does not cover the date
 * — and callers must not substitute the nearest regime for it.
 */
export function regimeFor(dateStr: string | null | undefined): FundFlowRegime | null {
  if (!dateStr) return null;
  const day = dateStr.slice(0, 10);
  for (const r of loadFundFlowRegimes()) {
    if (r.starts && day < r.starts) continue;
    if (r.ends && day > r.ends) continue;
    return r;
  }
  return null;
}

/**
 * True when a span crosses a regime boundary — i.e. a figure covering it is a
 * sum over two different sets of rules about how money moves. Callers that
 * aggregate across a boundary should say so rather than presenting one number.
 */
export function spansRegimeBoundary(fromDate: string, toDate: string): boolean {
  const a = regimeFor(fromDate);
  const b = regimeFor(toDate);
  if (!a || !b) return false;
  return a.id !== b.id;
}

// ─── Payment history arithmetic ─────────────────────────────

export interface PaymentSummary {
  /** Every stage payment, oldest first. */
  ordered: Payment[];
  count: number;
  /** Sum of every payment, whatever its stage. */
  total_paid: number;
  /** Sum of payments that required a measurement — the advance excluded. */
  measured_paid: number;
  /** Count of payments against a measured bill. */
  measured_count: number;
  /** Latest `payment_date`, or null when there are no payments. */
  last_payment_date: string | null;
  /** Stage keys present, in first-payment order. */
  stages: string[];
  /** Regime the most recent payment was made under, or null. */
  latest_regime_id: string | null;
}

/**
 * Summarise one work's payments.
 *
 * Ordering is by `sequence_number` and falls back to `payment_date`: a caller
 * that fetched rows ordered by date must still get a stable sequence, and a
 * caller that fetched them unordered must not get an arbitrary one.
 */
export function summarisePayments(payments: Payment[]): PaymentSummary {
  const ordered = [...payments].sort((a, b) => {
    const seqA = typeof a.sequence_number === 'number' ? a.sequence_number : Number.MAX_SAFE_INTEGER;
    const seqB = typeof b.sequence_number === 'number' ? b.sequence_number : Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;
    return (a.payment_date ?? '').localeCompare(b.payment_date ?? '');
  });

  let total = 0;
  let measured = 0;
  let measuredCount = 0;
  let lastDate: string | null = null;
  const stages: string[] = [];

  for (const p of ordered) {
    const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) ? p.amount : 0;
    total += amount;
    if (p.stage !== 'MOBILISATION_ADVANCE') {
      measured += amount;
      measuredCount += 1;
    }
    if (p.payment_date && (!lastDate || p.payment_date > lastDate)) lastDate = p.payment_date;
    if (p.stage && !stages.includes(p.stage)) stages.push(p.stage);
  }

  return {
    ordered,
    count: ordered.length,
    total_paid: total,
    measured_paid: measured,
    measured_count: measuredCount,
    last_payment_date: lastDate,
    stages,
    latest_regime_id: regimeFor(lastDate)?.id ?? null,
  };
}

/** Group payments by `work_id`, so the analysis pass fetches them once. */
export function groupPaymentsByWork(payments: Payment[]): Map<string, Payment[]> {
  const byWork = new Map<string, Payment[]>();
  for (const p of payments) {
    if (!p.work_id) continue;
    const bucket = byWork.get(p.work_id);
    if (bucket) bucket.push(p);
    else byWork.set(p.work_id, [p]);
  }
  return byWork;
}

/** A rule's numeric param, or the fallback when the catalogue does not set it. */
export function numericParam(
  rule: RuleDefinition | undefined,
  key: string,
  fallback: number,
): number {
  const raw = rule?.params?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/** A rule's string-array param, or the fallback. Used for R-002's stage exclusions. */
export function stageListParam(
  rule: RuleDefinition | undefined,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const raw = rule?.params?.[key];
  if (Array.isArray(raw) && raw.every((v) => typeof v === 'string')) return raw as string[];
  return fallback;
}
