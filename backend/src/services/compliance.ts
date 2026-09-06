/**
 * Statutory Compliance Statistics (R-016 SC/ST reservation, R-017 inspection coverage)
 *
 * Doctrine #3 applies with force here. These are **compliance statistics, not risk**.
 * The reservation mandate is written as an obligation on a Member of Parliament, and
 * this module deliberately does not reproduce that framing: it aggregates by
 * constituency and financial year, which is the unit the entitlement is denominated
 * in, and never by a named person. No output of this file carries an MP's name, and
 * nothing here may be fed into a ranking.
 *
 * Both figures were previously not computed at all. `/compliance` rendered four
 * hardcoded numbers — 16.4%, 8.1%, "65 assets", "38 assets (58.5%)", "TARGET MET" —
 * and `grep -rn "coverage|inspected" backend/src` returned nothing. Every number this
 * module returns is derived from rows, and anything with an empty denominator is
 * returned as `null` rather than as a plausible-looking number.
 */

import { getDb } from '../db.ts';
import type { RuleDefinition, Work } from '../types.ts';
import { nowIso } from '../util.ts';
import { loadRulesConfig } from './rule_engine.ts';

// ─── Scheme constants ────────────────────────────────────────

/**
 * Thresholds come from `rules/mplads_rules.yaml`, not from literals here, for the
 * same reason the delay detector's do: a rule catalogue whose numbers the code
 * ignores documents behaviour the system does not have. The values below are
 * fallbacks for a rule missing from the catalogue entirely.
 */
const DEFAULT_SC_MIN_PCT = 15.0;
const DEFAULT_ST_MIN_PCT = 7.5;
const DEFAULT_TARGET_COVERAGE_PCT = 10.0;

function numericParam(rule: RuleDefinition | undefined, key: string, fallback: number): number {
  const raw = rule?.params?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function ruleById(id: string): RuleDefinition | undefined {
  return loadRulesConfig().rules.find((r) => r.id === id);
}

/**
 * The MPLADS annual entitlement, in rupees. ₹5 crore per Member of Parliament per
 * financial year.
 *
 * This is the denominator the reservation mandate is actually written against, and
 * getting it wrong is the whole of F-10: the previous implementation divided by the
 * district's own total sanctioned value, which is a ratio of the portfolio to itself
 * and answers a different question. A district that recommended almost nothing could
 * score 20% on that test while sitting at 8% of what the guidelines require.
 */
export const ANNUAL_ENTITLEMENT_INR = 5_00_00_000;

/** Indian financial year runs 1 April → 31 March. */
function financialYearOf(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// ─── R-016: SC/ST reservation ────────────────────────────────

export interface ReservationCompliance {
  /** Sum of recommended work value flagged SCSP, in rupees. */
  scsp_recommended_inr: number;
  tsp_recommended_inr: number;
  /** (constituency × financial year) pairs present in the data, each worth one entitlement. */
  entitlement_periods: number;
  /** `entitlement_periods × ANNUAL_ENTITLEMENT_INR`, the guideline's denominator. */
  entitlement_inr: number;
  /** null when no entitlement period could be established — unmeasured, not zero. */
  scsp_pct: number | null;
  tsp_pct: number | null;
  scsp_target_pct: number;
  tsp_target_pct: number;
  scsp_meets_target: boolean | null;
  tsp_meets_target: boolean | null;
  /** Works counted in the numerator. */
  works_counted: number;
  /**
   * Works excluded because `recommended_date` is null, so they cannot be attributed
   * to a financial year. Doctrine #6 — a null field is a data-quality finding, never
   * evidence. A non-zero count here means the percentages understate reality.
   */
  works_missing_recommended_date: number;
  financial_years: string[];
  constituencies_counted: number;
  computed_at: string;
}

/**
 * Computes SC/ST reservation compliance as the guidelines define it: recommended
 * work value as a share of the annual entitlement.
 *
 * Two judgement calls worth knowing about, both made explicit in the return value
 * rather than hidden:
 *
 * 1. **Recommended, not sanctioned.** The mandate binds the act of recommending, so
 *    every work with a `recommended_date` counts, including works still awaiting a
 *    sanction decision and works later cancelled. The previous code excluded
 *    CANCELLED works, which lets a portfolio pass the test by having its
 *    non-reserved recommendations cancelled.
 *
 * 2. **Value is `sanctioned_amount`.** The schema has no separate recommended-cost
 *    column; for an unsanctioned work this field holds the estimate. That is the
 *    best available proxy and is not the same thing as the recommended cost.
 *
 * The denominator is (distinct constituency × financial year) × ₹5 Cr. That is an
 * approximation of "each MP's annual entitlement": it assumes one MP per
 * constituency per year, and it can only see years the corpus actually contains, so
 * a year in which a constituency recommended nothing at all is invisible to it and
 * the true denominator would be larger. `financial_years` and
 * `constituencies_counted` are returned so a reader can see the shape of that
 * assumption instead of taking the percentage on faith.
 */
export async function computeReservationCompliance(
  districtId?: string,
): Promise<ReservationCompliance> {
  const db = getDb();
  let query = db
    .from('works')
    .select('sanctioned_amount, is_scsp, is_tsp, recommended_date, constituency_id');
  if (districtId) query = query.eq('district_id', districtId);

  const { data, error } = await query;
  if (error) throw new Error(`reservation compliance: ${error.message}`);

  const works = (data ?? []) as Pick<
    Work,
    'sanctioned_amount' | 'is_scsp' | 'is_tsp' | 'recommended_date' | 'constituency_id'
  >[];

  let scsp = 0;
  let tsp = 0;
  let counted = 0;
  let missingDate = 0;
  const periods = new Set<string>();
  const years = new Set<string>();
  const constituencies = new Set<string>();

  for (const w of works) {
    const fy = w.recommended_date ? financialYearOf(w.recommended_date) : null;
    if (!fy) {
      missingDate++;
      continue;
    }
    const amount = Number(w.sanctioned_amount ?? 0);
    if (!Number.isFinite(amount)) {
      missingDate++;
      continue;
    }

    counted++;
    years.add(fy);
    if (w.constituency_id) {
      constituencies.add(w.constituency_id);
      periods.add(`${w.constituency_id}::${fy}`);
    }
    if (w.is_scsp) scsp += amount;
    if (w.is_tsp) tsp += amount;
  }

  const entitlementPeriods = periods.size;
  const entitlement = entitlementPeriods * ANNUAL_ENTITLEMENT_INR;
  // No entitlement period means nothing to measure against. Returning 0% here would
  // read as "this district reserved nothing", which is a finding; the truth is that
  // no finding is available.
  const scspPct = entitlement > 0 ? (scsp / entitlement) * 100 : null;
  const tspPct = entitlement > 0 ? (tsp / entitlement) * 100 : null;

  const r016 = ruleById('R-016');
  const scTarget = numericParam(r016, 'sc_min_pct', DEFAULT_SC_MIN_PCT);
  const stTarget = numericParam(r016, 'st_min_pct', DEFAULT_ST_MIN_PCT);

  return {
    scsp_recommended_inr: scsp,
    tsp_recommended_inr: tsp,
    entitlement_periods: entitlementPeriods,
    entitlement_inr: entitlement,
    scsp_pct: scspPct,
    tsp_pct: tspPct,
    scsp_target_pct: scTarget,
    tsp_target_pct: stTarget,
    scsp_meets_target: scspPct === null ? null : scspPct >= scTarget,
    tsp_meets_target: tspPct === null ? null : tspPct >= stTarget,
    works_counted: counted,
    works_missing_recommended_date: missingDate,
    financial_years: [...years].sort(),
    constituencies_counted: constituencies.size,
    computed_at: nowIso(),
  };
}

// ─── R-017: inspection coverage ──────────────────────────────

/** The mandate is annual, so the window is the trailing 365 days. */
const COVERAGE_WINDOW_DAYS = 365;

export interface InspectionCoverage {
  /** Works under implementation — the population the mandate names. */
  works_under_implementation: number;
  /** Distinct such works with at least one inspection inside the window. */
  works_inspected: number;
  /** null when nothing is under implementation — no denominator, no coverage. */
  coverage_pct: number | null;
  target_pct: number;
  meets_target: boolean | null;
  window_start: string;
  window_end: string;
  /**
   * Inspections recorded in the window against works that are NOT under
   * implementation (completed assets, cancelled works). Real inspection effort, but
   * it does not count toward this mandate, and surfacing it stops the number
   * reading as though that work was never done.
   */
  inspections_outside_population: number;
  computed_at: string;
}

/**
 * Computes physical inspection coverage against works **under implementation**.
 *
 * The population is the correction. R-017 was written against COMPLETED works, which
 * inverts the point of the mandate: inspecting an asset after it is finished cannot
 * change how it gets built. The guidelines direct inspection at works in progress,
 * where a finding can still affect the outcome — and the target is correspondingly
 * lower (10%, not 50%), because inspecting in-flight works is a sampling regime, not
 * a sign-off queue.
 */
export async function computeInspectionCoverage(
  districtId?: string,
): Promise<InspectionCoverage> {
  const db = getDb();
  const today = nowIso().slice(0, 10);
  const windowStartDate = new Date(today + 'T00:00:00Z');
  windowStartDate.setUTCDate(windowStartDate.getUTCDate() - COVERAGE_WINDOW_DAYS);
  const windowStart = windowStartDate.toISOString().slice(0, 10);

  let worksQuery = db.from('works').select('id, status');
  if (districtId) worksQuery = worksQuery.eq('district_id', districtId);
  const { data: worksData, error: worksError } = await worksQuery;
  if (worksError) throw new Error(`inspection coverage (works): ${worksError.message}`);

  const underImplementation = new Set<string>();
  const inScope = new Set<string>();
  for (const w of (worksData ?? []) as Pick<Work, 'id' | 'status'>[]) {
    inScope.add(w.id);
    if (w.status === 'IN_PROGRESS') underImplementation.add(w.id);
  }

  const { data: inspectionData, error: inspectionError } = await db
    .from('inspections')
    .select('work_id, inspection_date')
    .gte('inspection_date', windowStart)
    .lte('inspection_date', today);
  if (inspectionError) {
    throw new Error(`inspection coverage (inspections): ${inspectionError.message}`);
  }

  const inspectedInPopulation = new Set<string>();
  let outsidePopulation = 0;
  for (const row of (inspectionData ?? []) as { work_id: string }[]) {
    // District scoping is applied through the works set: an inspection whose work is
    // not in scope belongs to another district and is not this district's business.
    if (!inScope.has(row.work_id)) continue;
    if (underImplementation.has(row.work_id)) inspectedInPopulation.add(row.work_id);
    else outsidePopulation++;
  }

  const denominator = underImplementation.size;
  const coveragePct = denominator > 0 ? (inspectedInPopulation.size / denominator) * 100 : null;
  const targetPct = numericParam(ruleById('R-017'), 'target_coverage_pct', DEFAULT_TARGET_COVERAGE_PCT);

  return {
    works_under_implementation: denominator,
    works_inspected: inspectedInPopulation.size,
    coverage_pct: coveragePct,
    target_pct: targetPct,
    meets_target: coveragePct === null ? null : coveragePct >= targetPct,
    window_start: windowStart,
    window_end: today,
    inspections_outside_population: outsidePopulation,
    computed_at: nowIso(),
  };
}
