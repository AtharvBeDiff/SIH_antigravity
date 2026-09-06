/**
 * Calibration Service
 *
 * Compares corpus aggregates against the published MPLADS completion figures.
 *
 * There are two benchmarks, not one, and they are not interchangeable: completion
 * by value and completion by count differ by more than eleven points, because the
 * works that complete are systematically cheaper than the works that stall. A
 * single "completion rate" is therefore ambiguous, and quoting one figure against
 * the other's denominator is a category error. Both are computed and reported
 * separately below, each against its own reference.
 */

import { all, insert } from '../db.ts';
import { daysBetween, newId, nowIso } from '../util.ts';
import type { Work, CalibrationSnapshot } from '../types.ts';

/**
 * Published MPLADS aggregates for 1 Apr 2023 – 22 Jan 2026, as placed before the
 * Standing Committee on Rural Development.
 *
 * The rates are derived from these figures rather than written as literals, so the
 * arithmetic is checkable and a benchmark can never drift away from the numbers it
 * claims to come from. Amounts are ₹ crore.
 */
export const REFERENCE_AGGREGATES = {
  period_start: '2023-04-01',
  period_end: '2026-01-22',
  source: 'Standing Committee on Rural Development — MPLADS review',
  sanctioned_cr: 6680.29,
  completed_cr: 3387.38,
  works_sanctioned: 111600,
  works_completed: 69061,
} as const;

/** 50.71% — ₹3,387.38 Cr completed of ₹6,680.29 Cr sanctioned. */
export const BENCHMARK_BY_VALUE =
  REFERENCE_AGGREGATES.completed_cr / REFERENCE_AGGREGATES.sanctioned_cr;

/** 61.88% — 69,061 works completed of 1,11,600 sanctioned. */
export const BENCHMARK_BY_COUNT =
  REFERENCE_AGGREGATES.works_completed / REFERENCE_AGGREGATES.works_sanctioned;

// ─── Vintage adjustment ──────────────────────────────────────

/**
 * The scheme's completion deadline, in days. One year from sanction, as R-006 reads
 * it from the catalogue — kept as a local constant here because this is arithmetic on
 * a published aggregate, not a rule evaluation over works.
 */
const COMPLETION_DEADLINE_DAYS = 365;

/**
 * The published 50.71% understates delivery, and the reason is a denominator problem
 * rather than a data problem.
 *
 * ₹6,680.29 Cr was sanctioned across 1 Apr 2023 – 22 Jan 2026. A work sanctioned in
 * December 2025 has a completion deadline in December 2026 — it is not late, it is
 * young, and it cannot have completed inside the window. Dividing completions by
 * *everything* sanctioned charges those works as failures against a deadline that has
 * not arrived. What the number then measures is partly the shape of the sanction
 * curve, not delivery performance, and it moves whenever sanctioning accelerates.
 *
 * The adjustment restricts the denominator to sanctioned value whose deadline has
 * passed: value sanctioned on or before `period_end − 365 days`. Against that
 * denominator the rate is ~78.66%, and the shortfall is ~₹919 Cr — money on works
 * that *are* past their deadline and are not recorded complete. That figure is the
 * one worth acting on: it is a smaller headline gap and a larger, more defensible
 * accusation.
 *
 * **The assumption, stated because it is load-bearing:** sanctioning is assumed
 * uniform across the window, so the matured share of value is the matured share of
 * days. The published aggregates are period totals with no month-by-month split, so
 * there is no way to compute the true figure from them — this is an estimate, and it
 * is wrong to the extent that sanctioning was front- or back-loaded. Back-loaded
 * sanctioning (the likelier case, as scheme spending tends to accelerate) means less
 * value has matured than assumed, so the true adjusted rate is *higher* than 78.66%
 * and the true overdue amount *lower* than ₹919 Cr. Anyone quoting this must quote
 * the assumption with it.
 *
 * **By value only.** On the count basis the same adjustment gives ~96%, which is not
 * a finding about MPLADS but an artefact: 61.88% is close enough to the 64.46% matured
 * share that the ratio approaches 1 and saturates. A near-100% figure would read as
 * "the scheme delivers almost everything on time", the opposite of what the data
 * supports. It is computed nowhere and rendered nowhere.
 */
export const MATURED_VALUE_FRACTION = (() => {
  const windowDays = daysBetween(
    REFERENCE_AGGREGATES.period_start,
    REFERENCE_AGGREGATES.period_end,
  );
  return (windowDays - COMPLETION_DEADLINE_DAYS) / windowDays;
})();

/** ₹ crore sanctioned whose one-year deadline has passed. ~₹4,306 Cr. */
export const MATURED_SANCTIONED_CR =
  REFERENCE_AGGREGATES.sanctioned_cr * MATURED_VALUE_FRACTION;

/** ~78.66% — completions against matured value only. */
export const BENCHMARK_BY_VALUE_VINTAGE_ADJUSTED =
  REFERENCE_AGGREGATES.completed_cr / MATURED_SANCTIONED_CR;

/** ~₹919 Cr — matured value not recorded complete. Genuinely overdue. */
export const OVERDUE_VALUE_CR =
  MATURED_SANCTIONED_CR - REFERENCE_AGGREGATES.completed_cr;

/**
 * The vintage-adjusted view of the published figures, as served on
 * `GET /api/insight/calibration`.
 *
 * Everything here is arithmetic over `REFERENCE_AGGREGATES` — it says nothing about
 * the corpus. It is reported alongside the corpus comparison because the headline
 * 50.71% is the number a reader arrives with, and the adjustment is what makes the
 * gap actionable rather than merely large.
 */
export interface VintageAdjustment {
  /** Share of the window whose sanctions have reached their deadline. ~0.6446. */
  matured_fraction: number;
  /** ₹ crore sanctioned on or before period_end − 365 days. */
  matured_sanctioned_cr: number;
  /** ₹ crore recorded complete — the published figure, unadjusted. */
  completed_cr: number;
  /** Completions over matured value. ~0.7866. */
  adjusted_rate_by_value: number;
  /** The unadjusted published rate, for contrast. ~0.5071. */
  unadjusted_rate_by_value: number;
  /** ₹ crore past deadline and not complete. ~919. */
  overdue_cr: number;
  /** The deadline the maturity test uses, in days. */
  deadline_days: number;
  /**
   * The uniform-accrual assumption in words, carried with the numbers so a client
   * cannot render the rate without it.
   */
  assumption: string;
  /** Why the count basis is absent rather than merely unshown. */
  count_basis_note: string;
}

export function computeVintageAdjustment(): VintageAdjustment {
  return {
    matured_fraction: MATURED_VALUE_FRACTION,
    matured_sanctioned_cr: MATURED_SANCTIONED_CR,
    completed_cr: REFERENCE_AGGREGATES.completed_cr,
    adjusted_rate_by_value: BENCHMARK_BY_VALUE_VINTAGE_ADJUSTED,
    unadjusted_rate_by_value: BENCHMARK_BY_VALUE,
    overdue_cr: OVERDUE_VALUE_CR,
    deadline_days: COMPLETION_DEADLINE_DAYS,
    assumption:
      'Assumes sanctioning was uniform across 1 Apr 2023 – 22 Jan 2026: the matured ' +
      'share of value is taken to equal the matured share of days, because the ' +
      'published aggregates are period totals with no monthly split. Back-loaded ' +
      'sanctioning would mean less value has matured than assumed, so the true ' +
      'adjusted rate would be higher and the overdue amount lower. This is an ' +
      'estimate derived from published totals, not a measurement.',
    count_basis_note:
      'Deliberately by value only. The same adjustment on the count basis gives ' +
      'about 96%, which is saturation rather than a finding — 61.88% is close to the ' +
      '64.46% matured share, so the ratio approaches 1. Reporting it would read as ' +
      '"almost everything completes on time".',
  };
}

/**
 * Relative deviation of a corpus rate from its benchmark, as a percentage.
 * null when the corpus rate is unmeasured — there is no deviation from a
 * benchmark you have not measured against.
 */
function deviationFrom(benchmark: number, corpusRate: number | null): number | null {
  if (corpusRate === null) return null;
  return (Math.abs(corpusRate - benchmark) / benchmark) * 100;
}

export async function computeCalibration(): Promise<CalibrationSnapshot> {
  const works = await all<Work>('works');

  const totalSanctioned = works.reduce((sum, w) => sum + (w.sanctioned_amount ?? 0), 0);
  const completedSanctioned = works
    .filter((w) => w.status === 'COMPLETED')
    .reduce((sum, w) => sum + (w.sanctioned_amount ?? 0), 0);

  const completedCount = works.filter((w) => w.status === 'COMPLETED').length;

  // An empty corpus has no completion rate. It must NOT fall back to the
  // benchmark: that yields a deviation of exactly 0 and renders an empty database
  // as perfectly calibrated. Unmeasured is reported as unmeasured.
  const corpusRateByValue = totalSanctioned > 0 ? completedSanctioned / totalSanctioned : null;
  const corpusRateByCount = works.length > 0 ? completedCount / works.length : null;

  // Breakdown by category, in the shape CalibrationSnapshot declares: the corpus
  // percentage, and the reference percentage to compare it against.
  //
  // reference_pct is null for every category because the published aggregates are
  // scheme-wide totals with no category split. A per-category reference would have
  // to be invented, so it is left explicitly absent rather than filled with the
  // scheme-wide figure — which would imply every category completes at the same
  // rate, the very assumption this page exists to test.
  const counts: Record<string, { total: number; completed: number }> = {};
  for (const w of works) {
    const cat = w.category ?? 'OTHER';
    const entry = counts[cat] ?? { total: 0, completed: 0 };
    entry.total++;
    if (w.status === 'COMPLETED') entry.completed++;
    counts[cat] = entry;
  }

  const byCategory: Record<string, { corpus_pct: number; reference_pct: number | null }> = {};
  for (const [cat, c] of Object.entries(counts)) {
    byCategory[cat] = {
      corpus_pct: c.total > 0 ? (c.completed / c.total) * 100 : 0,
      reference_pct: null,
    };
  }

  const snapshot: CalibrationSnapshot = {
    id: newId(),
    run_at: nowIso(),
    corpus_completion_rate: corpusRateByValue,
    corpus_completion_rate_by_count: corpusRateByCount,
    target_completion_rate: BENCHMARK_BY_VALUE,
    target_completion_rate_by_count: BENCHMARK_BY_COUNT,
    deviation_pct: deviationFrom(BENCHMARK_BY_VALUE, corpusRateByValue),
    deviation_pct_by_count: deviationFrom(BENCHMARK_BY_COUNT, corpusRateByCount),
    reference: {
      period_start: REFERENCE_AGGREGATES.period_start,
      period_end: REFERENCE_AGGREGATES.period_end,
      source: REFERENCE_AGGREGATES.source,
    },
    by_category: byCategory,
    by_state: {},
  };

  try {
    await insert('calibration_snapshots', snapshot as unknown as Record<string, unknown>);
  } catch (err: any) {
    console.warn('Could not persist calibration_snapshot:', err.message);
  }

  return snapshot;
}
