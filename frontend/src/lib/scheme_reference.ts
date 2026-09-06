/**
 * Published MPLADS scheme aggregates — display reference.
 *
 * Mirrors REFERENCE_AGGREGATES in `backend/src/services/calibration.ts`, which is
 * the authority. Duplicated here only so a static label can name the benchmark
 * without a round trip; anything comparing a measured corpus against it must read
 * the figures off `GET /api/insight/calibration`, not from this file.
 *
 * The rates are derived from the underlying figures rather than written as
 * literals, so a benchmark can never drift away from the numbers it claims to come
 * from. Amounts are ₹ crore.
 */
export const SCHEME_REFERENCE = {
  period_start: '2023-04-01',
  period_end: '2026-01-22',
  source: 'Standing Committee on Rural Development — MPLADS review',
  sanctioned_cr: 6680.29,
  completed_cr: 3387.38,
  works_sanctioned: 111600,
  works_completed: 69061,
} as const;

/** 50.71% by value. Not interchangeable with the by-count figure below. */
export const BENCHMARK_PCT_BY_VALUE =
  (SCHEME_REFERENCE.completed_cr / SCHEME_REFERENCE.sanctioned_cr) * 100;

/** 61.88% by count. Differs from by-value by over eleven points. */
export const BENCHMARK_PCT_BY_COUNT =
  (SCHEME_REFERENCE.works_completed / SCHEME_REFERENCE.works_sanctioned) * 100;
