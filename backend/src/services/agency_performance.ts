/**
 * Agency Performance Profiling
 *
 * Doctrine #3 permits this and is the reason it exists. The doctrine bars aggregating
 * risk to a named Member of Parliament; it says nothing about implementing agencies,
 * because the agency is where execution accountability actually sits. An agency is an
 * institution with a mandate, a payroll and a work queue — attributing a slow build to
 * it is a statement about administration, not about an elected representative's
 * politics. Nothing in this file reads `works.mp_name` or `constituencies.mp_name`.
 *
 * What this replaces: `AgenciesPage.tsx` made zero API calls and rendered four
 * hardcoded rows plus "14.2 Mo" average pacing and "DRDA — 88.4% timely execution".
 * Those numbers described no agency in any database. Every figure below is derived
 * from `works` rows, and every figure whose denominator is empty is returned as `null`.
 *
 * ─── Why raw completion rate is not the ranking ───────────────
 *
 * A league table on completion rate ranks portfolios, not agencies. An agency handed
 * forty ₹2 lakh handpumps will out-complete an agency handed four ₹5 crore bridges
 * every time, and the ranking would say the second agency is failing when it is
 * merely doing harder work. The fix is to compare each agency against what its own
 * mix of work should take, so the comparison is like-for-like:
 *
 *   1. Build an expectation from the **whole corpus**: for each (category, size band)
 *      cell, the median days from sanction to recorded completion across every agency.
 *      This is the corpus's own observed behaviour, not a target anyone set.
 *   2. For each completed work, expected days is its cell's median.
 *   3. An agency's `pacing_index` is its total actual days over its total expected
 *      days. 1.0 means it delivers its own mix at the corpus median; 1.3 means it
 *      takes 30% longer than the same work takes elsewhere; 0.8 means faster.
 *
 * The index is a comparison against peers on comparable work, and that is all it is.
 * It is not a quality measure — a fast build can be a bad build, and nothing here
 * inspects an asset. It is not evidence of wrongdoing. `expectation_basis` on every
 * row records how many works the expectation rested on, because a median over three
 * works is not a benchmark and a caller has to be able to see that.
 *
 * ─── What is deliberately absent ──────────────────────────────
 *
 * There is no "timely execution rate". It would need a per-work deadline to be timely
 * *against*, and `works.completion_target_date` is populated for roughly a fifth of
 * works (`data-gen/generate.ts:788`) and is absent from the CSV ingest contract
 * entirely. Computing timeliness against the flat 12-month R-006 limit instead would
 * be measuring every agency against a deadline that the guidelines let the sanctioning
 * authority extend — and would silently score works whose extension is on record as
 * late. R-006 already reports scheme-timeline breaches as alerts, which is where that
 * finding belongs.
 */

import { getDb } from '../db.ts';
import { daysBetween, median, nowIso } from '../util.ts';
import type { Work } from '../types.ts';

/**
 * Sanctioned-amount bands, in rupees, used to make the pacing expectation
 * size-comparable. Boundaries are ₹5 L, ₹25 L and ₹1 Cr.
 *
 * Bands rather than a fitted cost-duration curve, deliberately. A regression over a
 * few hundred works would produce a coefficient with a confidence interval nobody
 * renders, and a reader would take the fitted value as more authoritative than a
 * median over a handful of rows deserves. A band is legible: "works of this category
 * in this size range took this long, in this corpus, N times".
 */
const SIZE_BANDS = [
  { id: 'UPTO_5L', label: 'up to ₹5 L', max: 5_00_000 },
  { id: 'UPTO_25L', label: '₹5 L – ₹25 L', max: 25_00_000 },
  { id: 'UPTO_1CR', label: '₹25 L – ₹1 Cr', max: 1_00_00_000 },
  { id: 'ABOVE_1CR', label: 'above ₹1 Cr', max: Number.POSITIVE_INFINITY },
] as const;

function sizeBandOf(amount: number): string {
  for (const band of SIZE_BANDS) {
    if (amount <= band.max) return band.id;
  }
  return 'ABOVE_1CR';
}

/**
 * Minimum completed works in a (category, size band) cell before its median is used
 * as an expectation.
 *
 * Three is not a statistical threshold — it is the point below which the median is
 * simply one work's duration wearing a different name. Cells below it fall back to
 * the category-wide median, then to the corpus-wide median, and a work whose duration
 * has no expectation at any level is excluded from the index rather than assigned an
 * invented one.
 */
const MIN_CELL_SIZE = 3;

export interface AgencyProfile {
  agency_id: string;
  agency_name: string;
  agency_type: string;
  district_id: string | null;

  /** Every work attributed to this agency, whatever its status. */
  works_total: number;
  works_completed: number;
  works_in_progress: number;
  works_not_started: number;
  works_on_hold: number;
  works_cancelled: number;

  sanctioned_inr: number;
  expenditure_inr: number;

  /** null when the agency has no works — no denominator, no rate. */
  completion_rate_by_count: number | null;
  /** Completed sanctioned value over total sanctioned value. */
  completion_rate_by_value: number | null;

  /**
   * Median days from sanction to recorded completion, over this agency's completed
   * works. null when it has completed nothing. Descriptive only — comparing it across
   * agencies compares their work mixes, which is what `pacing_index` exists to avoid.
   */
  median_days_to_complete: number | null;

  /**
   * Actual days over expected days across this agency's completed works, where an
   * expectation was available. 1.0 = corpus median for the same mix of work; above
   * 1.0 = slower than peers doing comparable work. null when no completed work of
   * this agency had an expectation to compare against.
   */
  pacing_index: number | null;
  /** Completed works that contributed to `pacing_index`. */
  pacing_works_measured: number;
  /**
   * Completed works excluded from `pacing_index` for want of a usable expectation or
   * a usable pair of dates. A large number here means the index rests on a subset.
   */
  pacing_works_unmeasured: number;

  /** OPEN and BACKLOG alerts on this agency's works. Not a risk score. */
  open_alerts: number;
}

export interface AgencyPerformanceReport {
  agencies: AgencyProfile[];
  /** Agencies with at least one work. */
  agencies_with_works: number;
  /** Agencies present in the table but holding no works at all. */
  agencies_without_works: number;
  /**
   * Works whose `agency_id` is null — real works belonging to no agency, so absent
   * from every row above. Surfaced because the rows would otherwise silently not sum
   * to the corpus.
   */
  works_unattributed: number;
  /** Completed works the expectation model could use at all. */
  expectation_basis_works: number;
  /** (category, size band) cells that met `MIN_CELL_SIZE`. */
  expectation_cells: number;
  /** Corpus-wide median days to complete, the last-resort expectation. null if none. */
  corpus_median_days: number | null;
  min_cell_size: number;
  size_bands: { id: string; label: string }[];
  computed_at: string;
}

type WorkRow = Pick<
  Work,
  | 'id'
  | 'agency_id'
  | 'status'
  | 'category'
  | 'sanctioned_amount'
  | 'expenditure'
  | 'sanction_date'
  | 'actual_completion_date'
>;

type AgencyRow = { id: string; name: string; type: string; district_id: string | null };

/**
 * Days from sanction to recorded completion, or null when the pair is unusable.
 *
 * Negative durations are rejected rather than clamped to zero. A completion date
 * before its sanction date is a data-quality defect, and folding it in as "completed
 * on day zero" would pull the median down and make the corrupt row look like the
 * fastest delivery in the corpus.
 */
function durationDays(w: WorkRow): number | null {
  if (!w.sanction_date || !w.actual_completion_date) return null;
  const days = daysBetween(w.sanction_date, w.actual_completion_date);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** Append to a keyed bucket, creating the bucket on first use. */
function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

export async function computeAgencyPerformance(
  districtId?: string,
): Promise<AgencyPerformanceReport> {
  const db = getDb();

  let agencyQuery = db.from('agencies').select('id, name, type, district_id');
  if (districtId) agencyQuery = agencyQuery.eq('district_id', districtId);
  const { data: agencyData, error: agencyError } = await agencyQuery;
  if (agencyError) throw new Error(`agency performance (agencies): ${agencyError.message}`);
  const agencies = (agencyData ?? []) as AgencyRow[];

  let worksQuery = db
    .from('works')
    .select(
      'id, agency_id, status, category, sanctioned_amount, expenditure, sanction_date, actual_completion_date',
    );
  if (districtId) worksQuery = worksQuery.eq('district_id', districtId);
  const { data: worksData, error: worksError } = await worksQuery;
  if (worksError) throw new Error(`agency performance (works): ${worksError.message}`);
  const works = (worksData ?? []) as WorkRow[];

  // ── Build the expectation from the whole corpus, before splitting by agency ──
  //
  // Corpus-wide on purpose. An expectation computed per agency would compare each
  // agency to itself, which no ranking can come out of: every agency would sit at
  // exactly 1.0 by construction.
  const cellDurations = new Map<string, number[]>();
  const categoryDurations = new Map<string, number[]>();
  const allDurations: number[] = [];

  for (const w of works) {
    if (w.status !== 'COMPLETED') continue;
    const days = durationDays(w);
    if (days === null) continue;
    const cat = w.category ?? 'OTHER';
    const cell = `${cat}::${sizeBandOf(Number(w.sanctioned_amount ?? 0))}`;
    pushInto(cellDurations, cell, days);
    pushInto(categoryDurations, cat, days);
    allDurations.push(days);
  }

  const cellMedians = new Map<string, number>();
  for (const [cell, durations] of cellDurations) {
    if (durations.length >= MIN_CELL_SIZE) cellMedians.set(cell, median(durations));
  }
  const categoryMedians = new Map<string, number>();
  for (const [cat, durations] of categoryDurations) {
    if (durations.length >= MIN_CELL_SIZE) categoryMedians.set(cat, median(durations));
  }
  const corpusMedian = allDurations.length >= MIN_CELL_SIZE ? median(allDurations) : null;

  /**
   * Expected days for one work: its cell's median, else its category's, else the
   * corpus's, else null.
   *
   * Returning null rather than a number is the point. A work in a category the corpus
   * has never completed has no basis for an expectation, and inventing one would put
   * a figure in the numerator of an agency's index that rests on nothing.
   */
  function expectedDays(w: WorkRow): number | null {
    const cat = w.category ?? 'OTHER';
    const cell = `${cat}::${sizeBandOf(Number(w.sanctioned_amount ?? 0))}`;
    return cellMedians.get(cell) ?? categoryMedians.get(cat) ?? corpusMedian ?? null;
  }

  // ── Open/backlog alert counts, keyed by work ──
  //
  // OPEN and BACKLOG together: a BACKLOG alert is a finding the district's alert
  // budget pushed out of the queue, not a finding that was reviewed and closed.
  // Counting only OPEN would let a district with a full budget appear to have fewer
  // problems than one with room to spare.
  const workIds = new Set(works.map((w) => w.id));
  const alertsByWork = new Map<string, number>();
  const { data: alertData, error: alertError } = await db
    .from('alerts')
    .select('work_id, status')
    .in('status', ['OPEN', 'BACKLOG']);
  if (alertError) throw new Error(`agency performance (alerts): ${alertError.message}`);
  for (const a of (alertData ?? []) as { work_id: string }[]) {
    if (!workIds.has(a.work_id)) continue;
    alertsByWork.set(a.work_id, (alertsByWork.get(a.work_id) ?? 0) + 1);
  }

  // ── Aggregate per agency ──
  const grouped = new Map<string, WorkRow[]>();
  let unattributed = 0;
  for (const w of works) {
    if (!w.agency_id) {
      unattributed++;
      continue;
    }
    pushInto(grouped, w.agency_id, w);
  }

  const profiles: AgencyProfile[] = agencies.map((a) => {
    const own = grouped.get(a.id) ?? [];

    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let onHold = 0;
    let cancelled = 0;
    let sanctioned = 0;
    let expenditure = 0;
    let completedValue = 0;
    let actualSum = 0;
    let expectedSum = 0;
    let measured = 0;
    let unmeasured = 0;
    let openAlerts = 0;
    const completedDurations: number[] = [];

    for (const w of own) {
      const amount = Number(w.sanctioned_amount ?? 0);
      sanctioned += Number.isFinite(amount) ? amount : 0;
      const spent = Number(w.expenditure ?? 0);
      expenditure += Number.isFinite(spent) ? spent : 0;
      openAlerts += alertsByWork.get(w.id) ?? 0;

      switch (w.status) {
        case 'COMPLETED': completed++; break;
        case 'IN_PROGRESS': inProgress++; break;
        case 'NOT_STARTED': notStarted++; break;
        case 'ON_HOLD': onHold++; break;
        case 'CANCELLED': cancelled++; break;
      }

      if (w.status !== 'COMPLETED') continue;
      completedValue += Number.isFinite(amount) ? amount : 0;

      const actual = durationDays(w);
      const expected = expectedDays(w);
      // Both halves must exist, and the expectation must be positive: dividing by a
      // zero expectation would produce Infinity and take the whole index with it.
      if (actual === null || expected === null || expected <= 0) {
        unmeasured++;
        continue;
      }
      completedDurations.push(actual);
      actualSum += actual;
      expectedSum += expected;
      measured++;
    }

    return {
      agency_id: a.id,
      agency_name: a.name,
      agency_type: a.type,
      district_id: a.district_id,
      works_total: own.length,
      works_completed: completed,
      works_in_progress: inProgress,
      works_not_started: notStarted,
      works_on_hold: onHold,
      works_cancelled: cancelled,
      sanctioned_inr: sanctioned,
      expenditure_inr: expenditure,
      completion_rate_by_count: own.length > 0 ? completed / own.length : null,
      completion_rate_by_value: sanctioned > 0 ? completedValue / sanctioned : null,
      median_days_to_complete: completedDurations.length > 0 ? median(completedDurations) : null,
      pacing_index: expectedSum > 0 ? actualSum / expectedSum : null,
      pacing_works_measured: measured,
      pacing_works_unmeasured: unmeasured,
      open_alerts: openAlerts,
    };
  });

  // Sorted by pacing index, slowest first, with unmeasured agencies last. An agency
  // with no measurable pacing is not "the fastest" and must not sort as though it
  // were — a null sorting to the top of an ascending list is exactly how an agency
  // that has completed nothing ends up presented as the best performer.
  profiles.sort((x, y) => {
    if (x.pacing_index === null && y.pacing_index === null) {
      return y.works_total - x.works_total;
    }
    if (x.pacing_index === null) return 1;
    if (y.pacing_index === null) return -1;
    return y.pacing_index - x.pacing_index;
  });

  return {
    agencies: profiles,
    agencies_with_works: profiles.filter((p) => p.works_total > 0).length,
    agencies_without_works: profiles.filter((p) => p.works_total === 0).length,
    works_unattributed: unattributed,
    expectation_basis_works: allDurations.length,
    expectation_cells: cellMedians.size,
    corpus_median_days: corpusMedian,
    min_cell_size: MIN_CELL_SIZE,
    size_bands: SIZE_BANDS.map((b) => ({ id: b.id, label: b.label })),
    computed_at: nowIso(),
  };
}
