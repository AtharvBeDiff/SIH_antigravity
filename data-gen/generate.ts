/**
 * Data Generator — MPLADS Synthetic Dataset
 *
 * Generates reproducible synthetic data via a seeded PRNG. Three outputs, all
 * derived from one in-memory corpus so they cannot disagree:
 *
 *   - `supabase/seed.sql`            — works, payments and the answer key
 *   - `drishti_works_dataset.csv`    — the same corpus in e-SAKSHI ingest format
 *   - the console summary            — what was planted, so a silent shortfall
 *                                      cannot pass as a deliberate sample size
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** This module's directory, for resolving sibling paths on both platforms. */
const MODULE_DIR = (() => {
  const p = new URL('.', import.meta.url).pathname;
  return process.platform === 'win32' ? p.substring(1).replace(/\//g, '\\') : p;
})();

/**
 * Every rule ID in the catalogue, read from the catalogue itself.
 *
 * Read rather than hardcoded because the whole point of the coverage check below is
 * to catch drift, and a hardcoded list of 21 IDs drifts in exactly the way the check
 * is meant to detect: add R-022 to the YAML, forget to add it here, and the check
 * reports full coverage of a catalogue it no longer describes.
 *
 * `backend/src/rules/mplads_rules.yaml` is the only place a rule ID may be minted,
 * so it is the only defensible source for "what rules exist".
 */
const CATALOGUE_RULE_IDS: string[] = (() => {
  const path = resolve(MODULE_DIR, '../backend/src/rules/mplads_rules.yaml');
  const parsed = parseYaml(readFileSync(path, 'utf8')) as { rules?: Array<{ id?: string }> };
  return (parsed.rules ?? []).map((r) => r.id).filter((id): id is string => typeof id === 'string');
})();

// Seeded PRNG (Mulberry32)
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Global fixed seed for reproducibility
const SEED = 12345;
const random = mulberry32(SEED);

/**
 * The date the generated corpus is presented as current at.
 *
 * A constant, not `new Date()`: with a wall-clock anchor the same seed produced a
 * different corpus on every run, so a diff in the seed file could not be told from
 * a diff in this generator. Bump it deliberately when the corpus should move
 * forward.
 */
const CORPUS_AS_OF = '2026-09-05';

/** Shift an ISO date by whole days. Negative moves backwards. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function randInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function randElement<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)] as T;
}

function newId(): string {
  const chars = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[randInt(0, 15)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

// Data Sets
const DISTRICTS = [
  { name: 'North District', code: 'DIST_101', state: 'Delhi' },
  { name: 'South District', code: 'DIST_102', state: 'Delhi' },
  { name: 'East District', code: 'DIST_103', state: 'Delhi' },
  { name: 'West District', code: 'DIST_104', state: 'Delhi' },
];

// Doctrine 3 bars MP-level risk aggregation, so no constituency here carries an
// MP name or party. Naming individuals — even fictitiously — in a corpus that
// also carries alerts is the attribution this platform must not make, and
// synthetic names read as real ones once they are on a screenshot.
const CONSTITUENCIES = [
  { name: 'North Assembly', lgd_code: '201' },
  { name: 'South Assembly', lgd_code: '202' },
  { name: 'East Assembly', lgd_code: '203' },
  { name: 'West Assembly', lgd_code: '204' },
];

const AGENCIES = [
  { name: 'Public Works Department (PWD)', type: 'State PWD' },
  { name: 'Rural Development Agency (DRDA)', type: 'DRDA' },
  { name: 'Municipal Corporation', type: 'Urban Local Body' },
  { name: 'Irrigation & Flood Control Dept', type: 'Line Department' }
];

/**
 * Canonical work categories, a subset of `WORK_CATEGORIES` in
 * `backend/src/types.ts`.
 *
 * This list held 'ROADS' and 'WATER', which are ingest *aliases*, not canonical
 * values — the enum spells them ROADS_BRIDGES and DRINKING_WATER. A corpus built
 * from the aliases put category values into `works.category` that no
 * category-scoped rule and no eligibility list could match, so R-001's
 * per-category medians were computed over categories the rest of the system did
 * not recognise.
 */
const CATEGORIES = [
  'EDUCATION', 'HEALTH', 'ROADS_BRIDGES', 'DRINKING_WATER', 'SANITATION', 'OTHER',
];

/**
 * Canonical work statuses — exactly `WORK_STATUSES` from `backend/src/types.ts` —
 * with the share of the corpus each one takes.
 *
 * This list held 'PROPOSED' and 'APPROVED', neither of which is in the enum. Both
 * were carrying one real distinction — whether the district authority has taken a
 * sanction decision yet — which is expressed properly by the presence or absence
 * of `sanction_date`, and that is exactly what the 45-day SLA measures. See
 * `awaitingDecision` below.
 *
 * The weights are the second half of that fix. Status was drawn *uniformly*, so
 * one work in five completed and the corpus sat at a ~16% completion rate against
 * a published 61.88%. That is a 74% deviation, and it was an artefact of the draw
 * rather than a finding about anything: `/calibration` exists to compare the
 * corpus against the published figures, and it was measuring the generator's
 * `randElement` call.
 *
 * COMPLETED is pinned to the published by-count rate. The rest are apportioned
 * across the remaining 38.12% — most of what has not completed is still being
 * built, a minority is awaiting a start or held, and outright cancellation is
 * rare. Those four splits are a modelling judgement, not a published figure;
 * only the COMPLETED share is calibrated. See `sanctionedAmountFor` for the
 * by-value half.
 */
const STATUS_MIX: Array<{ status: string; share: number }> = [
  { status: 'COMPLETED', share: 0.6188 },
  { status: 'IN_PROGRESS', share: 0.2400 },
  { status: 'NOT_STARTED', share: 0.0800 },
  { status: 'ON_HOLD', share: 0.0400 },
  { status: 'CANCELLED', share: 0.0212 },
];

/** Draw a status against `STATUS_MIX`. Shares sum to 1. */
function randStatus(): string {
  let r = random();
  for (const { status, share } of STATUS_MIX) {
    if (r < share) return status;
    r -= share;
  }
  return STATUS_MIX[STATUS_MIX.length - 1]!.status;
}

/**
 * The published completion rate is **50.71% by value** against **61.88% by
 * count** — an eleven-point spread, because the works that complete are
 * systematically cheaper than the works that stall. `services/calibration.ts`
 * reports both separately for exactly that reason.
 *
 * Drawing every amount from one range collapses the spread: with completion at
 * the by-count rate, the by-value rate lands on it too, and the corpus asserts
 * that the two benchmarks are interchangeable — the one thing the calibration
 * screen exists to disprove. Completed works are drawn from a lower range so the
 * spread survives.
 *
 * The ceiling is derived rather than tuned by hand. For a completed share `c` by
 * count and a target `v` by value, the completed mean must be
 * `Mc = Mn · v(1−c) / (c(1−v))` of the non-completed mean `Mn`; for a uniform
 * draw on [lo, hi] the mean is (lo+hi)/2, which gives the ceiling below.
 */
const AMOUNT_FLOOR = 100_000;
const AMOUNT_CEILING = 5_000_000;

function completedAmountCeiling(): number {
  const c = 0.6188;                       // published completion rate by count
  const v = 0.5071;                       // published completion rate by value
  const nonCompletedMean = (AMOUNT_FLOOR + AMOUNT_CEILING) / 2;
  const completedMean = (nonCompletedMean * v * (1 - c)) / (c * (1 - v));
  return Math.round(2 * completedMean - AMOUNT_FLOOR);
}

const COMPLETED_AMOUNT_CEILING = completedAmountCeiling();

function sanctionedAmountFor(status: string): number {
  return status === 'COMPLETED'
    ? randInt(AMOUNT_FLOOR, COMPLETED_AMOUNT_CEILING)
    : randInt(AMOUNT_FLOOR, AMOUNT_CEILING);
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

// ─── Planted anomalies and the answer key ───────────────────────────────────
//
// `/evaluation` measures precision and recall against `answer_key`. That table
// had no writer anywhere in the repo, so it was empty, every metric had a zero
// denominator, and the screen could only report `—`. This is the writer.
//
// **What the answer key is, and what it is not.** It records the conditions this
// generator *knows* it put into the corpus, restated here independently of the
// rule engine. Recall therefore measures pipeline fidelity — whether a condition
// known to be present survives the trip through the rules, the status filters,
// the probation service and the alert store — and not real-world detection
// accuracy. A rule that is disabled, gated on the wrong status, or reading a
// column nothing writes shows up here as a miss. A rule that would fail against
// genuine procurement fraud does not: no synthetic corpus can measure that, and
// the evaluation screen must not be read as claiming otherwise.
//
// Ground truth is **derived from the finished corpus**, not recorded at the
// moment of planting. Deliberate planting only guarantees each type has a
// population; conditions that arise from the ordinary draws — the ~12% of works
// left unpaid, the ~30% of completed works with no UC — are equally true of the
// corpus and are labelled the same way. Labelling only what was planted on
// purpose would leave organically-anomalous works unlabelled, and every alert on
// one of them would then be scored as a false positive.

type PlantKind =
  | 'COST_OVERRUN'
  | 'COMPLETED_LOW_PROGRESS'
  | 'MISSING_UC'
  | 'ZERO_EXPENDITURE'
  | 'RELEASE_OVERRUN'
  | 'NEVER_PAID'
  | 'ADVANCE_ONLY'
  | 'HOLD_TOO_LONG'
  | 'SLA_BREACH'
  | 'INELIGIBLE_CATEGORY'
  | 'REPORTING_LAPSED';

/** R-019: the reporting cadence, plus the grace period on top of it. */
const REPORT_INTERVAL_DAYS = 10;
const REPORT_GRACE_DAYS = 5;
const REPORT_OVERDUE_DAYS = REPORT_INTERVAL_DAYS + REPORT_GRACE_DAYS;

/** Facts about a finished work that the ground-truth predicates read. */
interface WorkFacts {
  released: number;
  measuredPaymentCount: number;
  paymentCount: number;
  /** Newest health-report date, or null when the work has never been reported on. */
  lastReportDate: string | null;
}

/**
 * One anomaly type: the rule expected to catch it, and the physical condition.
 *
 * Each `holds` is a restatement of the rule's own test against the generator's
 * data — deliberately written out rather than imported, so the two are
 * independent and a drift between the YAML thresholds and the engine shows up as
 * a recall miss instead of cancelling out.
 */
interface GroundTruth {
  type: string;
  ruleId: string;
  holds: (w: GeneratedWork, f: WorkFacts) => boolean;
  describe: (w: GeneratedWork, f: WorkFacts) => string;
}

const GROUND_TRUTH: GroundTruth[] = [
  {
    type: 'MISSING_UC',
    ruleId: 'R-003',
    // rule_engine.ts:125 — COMPLETED, has a completion date, no UC, >90 days past.
    holds: (w) =>
      w.status === 'COMPLETED' &&
      w.completionDateStr !== null &&
      !w.hasUc &&
      daysBetween(w.completionDateStr, CORPUS_AS_OF) > 90,
    describe: (w) =>
      `Completed ${w.completionDateStr} (${daysBetween(w.completionDateStr!, CORPUS_AS_OF)} days ago) with no utilisation certificate filed.`,
  },
  {
    type: 'COST_OVERRUN',
    ruleId: 'R-004',
    // rule_engine.ts:152 — expenditure over sanctioned by more than 10%.
    holds: (w) =>
      w.sanctioned_amount > 0 &&
      ((w.expenditure - w.sanctioned_amount) / w.sanctioned_amount) * 100 > 10,
    describe: (w) =>
      `Expenditure ${w.expenditure} against a sanction of ${w.sanctioned_amount} — an overrun of ` +
      `${(((w.expenditure - w.sanctioned_amount) / w.sanctioned_amount) * 100).toFixed(1)}%.`,
  },
  {
    type: 'ZERO_EXPENDITURE_IN_PROGRESS',
    ruleId: 'R-005',
    // rule_engine.ts:171 — IN_PROGRESS, at least 10% built, nothing spent.
    holds: (w) => w.status === 'IN_PROGRESS' && w.progressPct >= 10 && w.expenditure === 0,
    describe: (w) => `Reports ${w.progressPct}% physical progress with zero expenditure recorded.`,
  },
  {
    type: 'COMPLETED_LOW_PROGRESS',
    ruleId: 'R-008',
    // rule_engine.ts:193 — COMPLETED with progress under 80%.
    holds: (w) => w.status === 'COMPLETED' && w.progressPct < 80,
    describe: (w) => `Status is COMPLETED but physical progress is recorded as ${w.progressPct}%.`,
  },
  {
    type: 'STAGE_PAYMENT_STALLED',
    ruleId: 'R-012',
    // rule_engine.ts:243 — high-value, past half-built, no measured bill paid.
    // `measured_count` excludes the mobilisation advance (fund_flow.ts:169).
    holds: (w, f) =>
      w.sanctioned_amount >= 2_500_000 && w.progressPct >= 50 && f.measuredPaymentCount === 0,
    describe: (w, f) =>
      `High-value work at ${w.progressPct}% progress with ${f.paymentCount} payment(s) and no measured bill.`,
  },
  {
    type: 'RELEASE_OVERRUN',
    ruleId: 'R-013',
    // rule_engine.ts:271 — released over sanctioned by more than 5%.
    holds: (w, f) =>
      w.sanctioned_amount > 0 &&
      ((f.released - w.sanctioned_amount) / w.sanctioned_amount) * 100 > 5,
    describe: (w, f) =>
      `Released ${f.released} against a sanction of ${w.sanctioned_amount} — ` +
      `${(((f.released - w.sanctioned_amount) / w.sanctioned_amount) * 100).toFixed(1)}% over.`,
  },
  {
    type: 'NO_PAYMENT_SINCE_SANCTION',
    ruleId: 'R-014',
    // rule_engine.ts:298, gated to NOT_STARTED / IN_PROGRESS by applies_to_status.
    holds: (w, f) =>
      (w.status === 'NOT_STARTED' || w.status === 'IN_PROGRESS') &&
      w.sanctionDateStr !== null &&
      f.paymentCount === 0 &&
      daysBetween(w.sanctionDateStr, CORPUS_AS_OF) > 90,
    describe: (w) =>
      `Sanctioned ${w.sanctionDateStr} (${daysBetween(w.sanctionDateStr!, CORPUS_AS_OF)} days ago) with no payment of any stage.`,
  },
  {
    type: 'ON_HOLD_TOO_LONG',
    ruleId: 'R-015',
    // detectors/delay.ts:202 — held at least 120 days, measured from updated_at.
    holds: (w) => w.status === 'ON_HOLD' && daysBetween(w.updatedAt, CORPUS_AS_OF) >= 120,
    describe: (w) => `On hold for ${daysBetween(w.updatedAt, CORPUS_AS_OF)} days without resolution.`,
  },
  {
    type: 'INELIGIBLE_CATEGORY',
    ruleId: 'R-011',
    // rule_engine.ts:212 — category is in the ineligible list, canonical or upstream
    // spelling. `applies_to_status: null`, so every status is in scope.
    holds: (w) => w.category === 'RELIGIOUS_HERITAGE',
    describe: (w) =>
      `Categorised '${w.category}', which is not eligible for MPLADS funding under the scheme guidelines.`,
  },
  {
    type: 'MISSING_HEALTH_REPORT',
    ruleId: 'R-019',
    // detectors/delay.ts — IN_PROGRESS, under 100%, and the newest health report is
    // older than the cadence plus grace. A work never reported on measures from
    // `sanction_date`, which is where the obligation begins; the detector makes the
    // same distinction and says which case it is in its evidence text.
    holds: (w, f) => {
      if (w.status !== 'IN_PROGRESS' || w.progressPct >= 100) return false;
      const ref = f.lastReportDate ?? w.sanctionDateStr;
      return ref !== null && daysBetween(ref, CORPUS_AS_OF) >= REPORT_OVERDUE_DAYS;
    },
    describe: (w, f) =>
      f.lastReportDate
        ? `Last ${REPORT_INTERVAL_DAYS}-day health report filed ${f.lastReportDate}, ` +
          `${daysBetween(f.lastReportDate, CORPUS_AS_OF)} days ago.`
        : `No ${REPORT_INTERVAL_DAYS}-day health report has ever been filed; sanctioned ` +
          `${daysBetween(w.sanctionDateStr!, CORPUS_AS_OF)} days ago.`,
  },
  {
    type: 'SANCTION_SLA_BREACHED',
    ruleId: 'R-020',
    // services/sla_engine.ts — no decision taken, past the 45-day limit. CANCELLED
    // is out of scope: a rejection is a decision.
    holds: (w) =>
      w.sanctionDateStr === null &&
      w.status !== 'CANCELLED' &&
      daysBetween(w.recDateStr, CORPUS_AS_OF) > 45,
    describe: (w) =>
      `Recommended ${w.recDateStr}, still awaiting a sanction decision after ${daysBetween(w.recDateStr, CORPUS_AS_OF)} days.`,
  },
];

/**
 * Rules deliberately left out of the answer key, and why.
 *
 * Recorded here rather than merely omitted: `services/evaluation.ts` treats the
 * distinct `expected_rule_id` values in the key as the covered set and scores
 * nothing outside it, so an omission silently narrows what precision means. A
 * reader deciding whether to trust a precision figure needs to know what it did
 * not count.
 *
 *  - R-001 (cost outlier) and R-009 (duplicate work) are *emergent*: whether a
 *    work is a z>3 outlier in its category, or textually near another, is a
 *    property of the whole corpus that this generator would have to reimplement
 *    the detector to know. A restatement that reimplements the detector tests
 *    nothing.
 *  - R-002, R-006, R-007, R-018 depend on progress-versus-payment curves the
 *    generator draws without a ground-truth intent behind them.
 *  - R-010 (photo reuse) needs images, which are not generated.
 *  - R-016 and R-017 are compliance statistics, not alerts (doctrine #3).
 *  - R-021 (sanction SLA *at risk*) is the one entry here that is not blocked by
 *    anything: it is the same recommended-but-unsanctioned window R-020 uses, read
 *    at 35 days instead of 45, and `GROUND_TRUTH` could state it in three lines.
 *    It is uncovered because nobody has written it, not because it cannot be
 *    written. Saying so is the point of this list — an unwritten label and an
 *    unwritable one both produce `unscored_alerts`, and only one of them is a
 *    limitation of the corpus.
 *
 * The two lists must together account for every rule in the catalogue. R-019 moved
 * out of this list when the generator started emitting health reports; R-021 was
 * in neither list until then, so `answer_key` covered 10 rules, this list named 9,
 * and the 21st was simply unaccounted for.
 */
const UNCOVERED_RULES = [
  'R-001', 'R-002', 'R-006', 'R-007', 'R-009',
  'R-010', 'R-016', 'R-017', 'R-018', 'R-021',
];

/**
 * How many works to deliberately push into each anomalous condition.
 *
 * A floor, not a total. Several of these conditions also arise from the ordinary
 * draws — roughly 12% of sanctioned works are left unpaid, roughly 30% of
 * completed works never file a UC — and the answer key labels those too. What
 * planting buys is a guarantee: three of the conditions below (`COST_OVERRUN`,
 * `ZERO_EXPENDITURE`, `COMPLETED_LOW_PROGRESS`) are *impossible* under the
 * ordinary draws, because expenditure is capped at the sanction and completed
 * works are pinned to 100% progress. Without planting, those three rules would
 * have an empty population and their recall would be permanently unmeasurable.
 */
const PLANT_QUOTAS: Array<{ kind: PlantKind; count: number; eligible: (w: GeneratedWork) => boolean }> = [
  // Impossible organically — expenditure never exceeds the sanction.
  { kind: 'COST_OVERRUN', count: 22, eligible: (w) => w.status === 'COMPLETED' || w.status === 'IN_PROGRESS' },
  // Impossible organically — completed works are pinned to 100%.
  { kind: 'COMPLETED_LOW_PROGRESS', count: 16, eligible: (w) => w.status === 'COMPLETED' },
  // Impossible organically — an in-progress work always has some expenditure.
  { kind: 'ZERO_EXPENDITURE', count: 16, eligible: (w) => w.status === 'IN_PROGRESS' && w.progressPct >= 10 },
  // Impossible organically — `CATEGORIES` holds no ineligible value, so a work can
  // only carry one by being put there. Recommended works only: an ineligible work
  // that was sanctioned anyway is a different and stronger claim than one that was
  // merely proposed, and the corpus should not assert the stronger one by accident.
  { kind: 'INELIGIBLE_CATEGORY', count: 11, eligible: (w) => w.status !== 'CANCELLED' },
  // Possible organically; planted to keep the population from depending on a draw.
  { kind: 'MISSING_UC', count: 18, eligible: (w) =>
      w.status === 'COMPLETED' && w.completionDateStr !== null && daysBetween(w.completionDateStr, CORPUS_AS_OF) > 90 },
  { kind: 'RELEASE_OVERRUN', count: 14, eligible: (w) => w.sanctionDateStr !== null && w.status !== 'CANCELLED' },
  { kind: 'NEVER_PAID', count: 14, eligible: (w) =>
      (w.status === 'NOT_STARTED' || w.status === 'IN_PROGRESS') &&
      w.sanctionDateStr !== null && daysBetween(w.sanctionDateStr, CORPUS_AS_OF) > 90 },
  { kind: 'ADVANCE_ONLY', count: 12, eligible: (w) => w.status === 'IN_PROGRESS' && w.sanctionDateStr !== null },
  { kind: 'HOLD_TOO_LONG', count: 12, eligible: (w) => w.status === 'ON_HOLD' && w.sanctionDateStr !== null },
  { kind: 'SLA_BREACH', count: 10, eligible: (w) => w.status === 'NOT_STARTED' && w.sanctionDateStr === null },
  // Reporting lapsed: an in-progress work whose check-ins stop well short of the
  // as-of date. Possible organically — the health-report pass leaves a share of
  // works with a stale last report — and planted so the population does not depend
  // on that draw. Expressed by the health-report pass, which reads `plant`.
  { kind: 'REPORTING_LAPSED', count: 14, eligible: (w) =>
      w.status === 'IN_PROGRESS' && w.progressPct < 100 && w.sanctionDateStr !== null },
];

/**
 * Push a bounded number of works into each anomalous condition.
 *
 * Runs after the works are built and before the payment pass, because three of
 * the plants are expressed in payments rather than on the work row: `NEVER_PAID`
 * and `ADVANCE_ONLY` change what the payment pass emits, and `RELEASE_OVERRUN`
 * changes how much.
 *
 * `plant` marks the work so the payment pass can honour it and so a work is not
 * pulled into two conflicting conditions. It is deliberately *not* what the
 * answer key is built from — see `deriveAnswerKey`.
 */
function plantAnomalies(works: GeneratedWork[]): void {
  for (const quota of PLANT_QUOTAS) {
    let placed = 0;
    for (const w of works) {
      if (placed >= quota.count) break;
      if (w.plant !== null) continue;
      if (!quota.eligible(w)) continue;

      switch (quota.kind) {
        case 'COST_OVERRUN':
          // 15–45% over. Above R-004's 10% variance threshold with room to spare,
          // so the finding does not turn on a rounding decision.
          w.expenditure = Math.round(w.sanctioned_amount * (1.15 + random() * 0.3));
          break;
        case 'COMPLETED_LOW_PROGRESS':
          w.progressPct = randInt(35, 78);
          break;
        case 'ZERO_EXPENDITURE':
          w.expenditure = 0;
          break;
        case 'INELIGIBLE_CATEGORY':
          // The canonical spelling, not an upstream alias: a work already inside the
          // system carries a `WORK_CATEGORIES` value. The alias branch of R-011 is
          // for data arriving through ingest, which this corpus does not model.
          w.category = 'RELIGIOUS_HERITAGE';
          break;
        case 'MISSING_UC':
          w.hasUc = false;
          w.ucDateStr = null;
          break;
        case 'HOLD_TOO_LONG':
          // At least 120 days held, and never before the sanction that started it.
          w.updatedAt = addDays(CORPUS_AS_OF, -randInt(140, 400));
          if (w.updatedAt < w.sanctionDateStr!) w.updatedAt = w.sanctionDateStr!;
          if (daysBetween(w.updatedAt, CORPUS_AS_OF) < 120) continue;  // sanctioned too recently
          break;
        case 'SLA_BREACH':
          w.recDateStr = addDays(CORPUS_AS_OF, -randInt(46, 150));
          w.updatedAt = w.recDateStr;
          break;
        case 'ADVANCE_ONLY':
          // R-012 only looks at high-value works past the halfway mark, so the
          // condition has to be put there before the payment pass can express it.
          w.sanctioned_amount = randInt(2_600_000, AMOUNT_CEILING);
          w.progressPct = randInt(55, 95);
          w.expenditure = Math.min(w.expenditure, w.sanctioned_amount);
          break;
        case 'RELEASE_OVERRUN':
        case 'NEVER_PAID':
          break;   // expressed by the payment pass, which reads `plant`
        case 'REPORTING_LAPSED':
          break;   // expressed by the health-report pass, which reads `plant`
      }

      w.plant = quota.kind;
      placed += 1;
    }
    if (placed < quota.count) {
      // Say so rather than quietly under-planting: a type with fewer works than
      // intended has a smaller recall denominator, and a silent shortfall reads
      // as a deliberate sample size.
      console.warn(`  ! planted only ${placed} of ${quota.count} ${quota.kind} (ran out of eligible works)`);
    }
  }
}

/**
 * Build the answer key by evaluating every ground-truth predicate over the
 * finished corpus.
 *
 * Derived, not recorded: a work planted as `COST_OVERRUN` that also happens to
 * have filed no UC is anomalous in both ways, and both belong in the key. The
 * `plant` marks guarantee each population is non-empty; this pass decides what is
 * actually true.
 */
function deriveAnswerKey(works: GeneratedWork[]): Array<{
  workId: string;
  type: string;
  ruleId: string;
  description: string;
}> {
  const rows: Array<{ workId: string; type: string; ruleId: string; description: string }> = [];
  for (const w of works) {
    const facts: WorkFacts = {
      released: w.payments.reduce((s, p) => s + p.amount, 0),
      measuredPaymentCount: w.payments.filter((p) => p.stage !== 'MOBILISATION_ADVANCE').length,
      paymentCount: w.payments.length,
      // The newest report, computed rather than assumed to be last in the array —
      // the same max() the service derives, so the key and the detector read the
      // same date.
      lastReportDate: w.healthReports.reduce<string | null>(
        (latest, hr) => (latest === null || hr.date > latest ? hr.date : latest),
        null,
      ),
    };
    for (const gt of GROUND_TRUTH) {
      if (gt.holds(w, facts)) {
        rows.push({ workId: w.id, type: gt.type, ruleId: gt.ruleId, description: gt.describe(w, facts) });
      }
    }
  }
  return rows;
}

/**
 * One generated work, held in memory until both outputs are written.
 *
 * The SQL seed and the demo CSV are two renderings of the same corpus, so both
 * are emitted from these objects rather than each being built by its own script
 * against its own date window.
 */
interface GeneratedWork {
  id: string;
  esakshiId: string;
  dId: string;
  cId: string;
  districtCode: string;
  constituencyCode: string;
  agencyId: string;
  agencyName: string;
  category: string;
  status: string;
  title: string;
  locationName: string;
  progressPct: number;
  sanctioned_amount: number;
  expenditure: number;
  recDateStr: string;
  sanctionDateStr: string | null;
  completionDateStr: string | null;
  /** Extended deadline, where one was granted. Null means the standard limit. */
  completionTargetDateStr: string | null;
  hasUc: boolean;
  ucDateStr: string | null;
  /**
   * Last time the row changed, as the source system would report it.
   *
   * Not decoration: `detectors/delay.ts:203` measures how long an ON_HOLD work
   * has been held from `updated_at`, falling back to `sanction_date`. Left unset
   * the column takes its `DEFAULT NOW()`, every seeded work reads as touched
   * today, and R-015 measures a hold of zero days on a corpus built to contain
   * long-held works.
   */
  updatedAt: string;
  latitude: number;
  longitude: number;
  isScsp: boolean;
  isTsp: boolean;
  /** Deliberately planted anomaly, or null. See `plantAnomalies`. */
  plant: PlantKind | null;
  /** Filled by the payment pass. */
  payments: Array<{ stage: string; date: string; amount: number; purpose: string }>;
  /**
   * 10-day progress check-ins, oldest first. Filled by the health-report pass.
   *
   * R-019's only input. Before `health_reports` existed the detector measured
   * `works.updated_at` instead, so the rule sat in `UNCOVERED_RULES` and its recall
   * was unmeasurable rather than zero.
   */
  healthReports: Array<{ date: string; progressPct: number; remarks: string | null }>;
}

function generateData() {
  console.log('Generating synthetic data...');
  const statements: string[] = [];
  statements.push('-- Auto-generated by data-gen/generate.ts');
  statements.push('-- Seed: ' + SEED);
  statements.push('');

  // 1. Districts
  const dIds: Record<string, string> = {};
  for (const d of DISTRICTS) {
    const id = newId();
    dIds[d.name] = id;
    statements.push(`INSERT INTO districts (id, name, state, code, lgd_code) VALUES ('${id}', '${escapeSql(d.name)}', '${escapeSql(d.state)}', '${d.code}', '${d.code}') ON CONFLICT (code) DO NOTHING;`);
  }
  statements.push('');

  // 2. Agencies
  const agencyIds: string[] = [];
  for (const a of AGENCIES) {
    const id = newId();
    agencyIds.push(id);
    const dId = dIds[DISTRICTS[0]!.name]!;
    statements.push(`INSERT INTO agencies (id, district_id, name, type) VALUES ('${id}', '${dId}', '${escapeSql(a.name)}', '${escapeSql(a.type)}') ON CONFLICT (id) DO NOTHING;`);
  }
  statements.push('');

  // 3. Constituencies
  const cIds: Record<string, string> = {};
  for (let idx = 0; idx < CONSTITUENCIES.length; idx++) {
    const c = CONSTITUENCIES[idx]!;
    const id = newId();
    cIds[c.name] = id;
    const dName = DISTRICTS[idx % DISTRICTS.length]!.name;
    const dId = dIds[dName]!;
    statements.push(`INSERT INTO constituencies (id, district_id, name, lgd_code) VALUES ('${id}', '${dId}', '${escapeSql(c.name)}', '${c.lgd_code}') ON CONFLICT (id) DO NOTHING;`);
  }
  statements.push('');

  // 4. Works
  //
  // Built into objects first and emitted afterwards, because `released_amount` is
  // the sum of the work's stage payments and the payments are not known until the
  // payment pass below has run. Emitting the INSERT here and the payments later is
  // how the two came to disagree: the SQL seed left `released_amount` unwritten
  // entirely, so R-013 and R-002's fallback had nothing to read.
  const numWorks = 2000;
  const works: GeneratedWork[] = [];
  for (let i = 0; i < numWorks; i++) {
    const id = newId();
    const district = randElement(DISTRICTS)!;
    const constituency = randElement(CONSTITUENCIES)!;
    const dId = dIds[district.name]!;
    const cId = cIds[constituency.name]!;
    const agencyIdx = randInt(0, AGENCIES.length - 1);
    const agencyId = agencyIds[agencyIdx]!;
    const agencyName = AGENCIES[agencyIdx]!.name;

    const category = randElement(CATEGORIES);
    const status = randStatus();

    /**
     * Whether this work is still awaiting a sanction decision.
     *
     * Work cannot begin, complete, or be held before it is sanctioned, so only
     * two statuses can be in this state: NOT_STARTED (recommended, no decision
     * yet) and CANCELLED (rejected at the recommendation stage, as opposed to
     * abandoned after sanction). This is the distinction the retired 'PROPOSED'
     * and 'APPROVED' statuses were standing in for.
     *
     * Without works in this state the sanction-decision SLA has nothing to
     * measure and R-020/R-021 cannot fire on the demo corpus at all.
     */
    const awaitingDecision =
      (status === 'NOT_STARTED' || status === 'CANCELLED') && random() < 0.45;

    const sanctioned_amount = sanctionedAmountFor(status);
    const expenditure = status === 'COMPLETED' ? sanctioned_amount : (status === 'IN_PROGRESS' ? randInt(10000, sanctioned_amount) : 0);
    const title = `Work ${i+1}: ${category} Project at Location ${i}`;

    // Dates.
    //
    // This drew the recommendation date from `new Date()`, which made the corpus
    // non-reproducible — the same seed produced different dates on every run — and
    // squeezed every work into the ten weeks before whenever the generator last
    // ran. Two consequences: the sanction date, being the recommendation plus
    // 5–50 days, could land *in the future*, and no threshold measured in months
    // could ever fire. R-003's 90-day UC grace, R-014's 90-day no-payment window,
    // R-016's financial-year buckets and the fund-flow regime boundaries recorded
    // in the rule catalogue were all untestable against the seeded data.
    //
    // Anchored to a fixed as-of date instead, with a window wide enough to cross
    // both regime boundaries (1 Apr 2023 and 1 Apr 2025), so a rule that reasons
    // about elapsed time has something to reason about.
    //
    // Works still awaiting a decision get a much shorter window. Drawn from the
    // 90–1500 day range they would every one of them be past the 45-day limit,
    // and the SLA screen would show a 100% breach rate — technically derived from
    // the data, and useless as a demonstration. 3–120 days populates all three
    // outcomes.
    const recAgeDays = awaitingDecision ? randInt(3, 120) : randInt(90, 1500);
    const recDateStr = addDays(CORPUS_AS_OF, -recAgeDays);

    // A sanction date exists precisely when the decision has been taken. Capped
    // at the as-of date: a work cannot be sanctioned in the future, and a future
    // sanction date makes every interval measured from it negative.
    let sanctionDay: string | null = null;
    if (!awaitingDecision) {
        const lag = Math.min(randInt(5, 50), recAgeDays);
        sanctionDay = addDays(recDateStr, lag);
    }

    // A completion date only for a work that reports completion, and only after
    // its sanction. `has_uc` is then the 90-day UC question R-003 asks: most
    // completed works have filed one, a minority have not, and a work that is not
    // complete has nothing to file for.
    let completionDay: string | null = null;
    if (status === 'COMPLETED' && sanctionDay) {
      const built = Math.min(randInt(120, 700), daysBetween(sanctionDay, CORPUS_AS_OF));
      if (built > 0) completionDay = addDays(sanctionDay, built);
    }
    const hasUc = completionDay ? random() < 0.7 : false;

    // A UC is filed after the work it certifies, within the 90-day grace period.
    // Nothing reads `uc_date` today, but a `has_uc` with no date is a row that
    // contradicts itself, and R-003's grace window is the obvious next reader.
    const ucDate = hasUc && completionDay
      ? addDays(completionDay, Math.min(randInt(10, 85), daysBetween(completionDay, CORPUS_AS_OF)))
      : null;

    // An extended deadline for a minority of sanctioned works. `detectors/delay.ts`
    // reads `completion_target_date` as an extension to R-006's standard limit and
    // notes at :135 that nothing populates it — so the extension branch, and the
    // "still overdue against that extension" evidence line, were unreachable.
    // Only ever later than the standard limit: an extension that shortens the
    // deadline is not an extension.
    const completionTargetDay = sanctionDay && random() < 0.2
      ? addDays(sanctionDay, randInt(550, 900))
      : null;

    /**
     * When the source system last touched this row.
     *
     * For an ON_HOLD work this is when the hold began, which is what R-015
     * measures against. For everything else it is the latest thing that happened
     * to the work, so the column does not assert an edit that never took place.
     */
    const updatedAt =
      status === 'ON_HOLD' && sanctionDay
        ? addDays(sanctionDay, Math.floor(daysBetween(sanctionDay, CORPUS_AS_OF) * (0.1 + random() * 0.5)))
        : completionDay ?? sanctionDay ?? recDateStr;

    works.push({
      id,
      esakshiId: `ESK-${1000 + i}`,
      dId,
      cId,
      districtCode: district.code,
      constituencyCode: constituency.lgd_code,
      agencyId,
      agencyName,
      category,
      status,
      title,
      locationName: `Location ${i}`,
      // A work that has not started has no physical progress. This drew
      // `randInt(0, 99)` for every non-complete status, so NOT_STARTED works were
      // emitted reporting up to 99% built — a contradiction on the face of the
      // row, and one that fed R-002's money-against-progress comparison with a
      // progress figure the status says cannot exist.
      progressPct:
        status === 'COMPLETED' ? 100
        : status === 'NOT_STARTED' || status === 'CANCELLED' ? 0
        : randInt(1, 99),
      sanctioned_amount,
      expenditure,
      recDateStr,
      sanctionDateStr: sanctionDay,
      completionDateStr: completionDay,
      completionTargetDateStr: completionTargetDay,
      hasUc,
      ucDateStr: ucDate,
      updatedAt,
      // Scattered around a Delhi centroid. Coordinates are synthetic; the ingest's
      // own fallback for an absent pair is called out in the readiness checklist.
      latitude: 28.5 + random() * 0.25,
      longitude: 77.15 + random() * 0.25,
      isScsp: random() < 0.18,
      isTsp: random() < 0.09,
      plant: null,
      payments: [],
      healthReports: [],
    });
  }

  plantAnomalies(works);

  // 5. Payments — stage-wise, one row per vendor bill.
  //
  // `payments` sat in the schema from migration 001 with zero writers, so every
  // rule that reasoned about money read `works.first_installment` /
  // `second_installment` instead — and this generator never wrote those either,
  // which is why R-012 and R-014 fired on the entire corpus: they tested a
  // column that was null on every row. Emitting real payment rows is what makes
  // those rules answerable, and what gives `works.last_payment_date` a value so
  // R-007 measures a stall from the last payment rather than from sanction.
  //
  // The shape follows the regime: an advance paid soon after sanction, then
  // running bills tracking physical progress, then a final bill on completion.
  // Deliberately not uniform — a corpus where every work is paid correctly
  // exercises none of the rules, so a share of works are left with an advance
  // and no measured bill (R-012) and a share sanctioned long ago are left
  // entirely unpaid (R-014).
  //
  // Accumulated onto the work objects rather than straight into SQL, so the works
  // INSERT below can set `released_amount` to the sum and the CSV can carry the
  // same history in its `payment_history` cell. One derivation, three outputs.
  let worksPaid = 0;
  for (const w of works) {
    if (!w.sanctionDateStr) continue;      // nothing to pay against yet
    if (w.status === 'CANCELLED') continue;

    // Planted as sanctioned-but-never-paid. Checked before the random skip below
    // so the plant is a guarantee rather than another roll of the dice.
    if (w.plant === 'NEVER_PAID') continue;

    // ~12% of sanctioned works are never paid. Past the 90-day threshold these
    // are R-014's population.
    if (random() < 0.12) continue;

    const window = daysBetween(w.sanctionDateStr, CORPUS_AS_OF);
    if (window < 7) continue;   // nothing is paid the week a work is sanctioned

    /**
     * Record one stage payment at `offsetDays` after sanction.
     *
     * Returns false and records nothing when the offset would land after
     * `CORPUS_AS_OF`. A payment dated in the future is not data, and it makes
     * every stall interval measured from `last_payment_date` negative — the
     * interval this whole change exists to make measurable.
     */
    const push = (stage: string, offsetDays: number, amount: number, purpose: string): boolean => {
      if (offsetDays > window) return false;
      w.payments.push({
        stage,
        date: addDays(w.sanctionDateStr!, offsetDays),
        amount: Math.round(amount),
        purpose,
      });
      return true;
    };

    // Mobilisation advance: paid against a bank guarantee before any
    // measurement, which is why R-002 excludes it from the money-ahead test.
    push('MOBILISATION_ADVANCE', randInt(10, Math.min(45, window)), w.sanctioned_amount * 0.15, 'Mobilisation advance against bank guarantee');

    // ~18% stop there. Above the high-value threshold and past 50% progress,
    // these are R-012's population: the site moved, the money did not. A work
    // planted as `ADVANCE_ONLY` stops there unconditionally.
    if (w.plant !== 'ADVANCE_ONLY' && random() >= 0.18) {
      const bills = w.status === 'COMPLETED' ? randInt(2, 4) : randInt(1, 3);

      // The running bills share a budget rather than each drawing an independent
      // 20–35% of the sanction.
      //
      // Drawn independently, four bills averaging 27.5% came to 110% of the
      // sanction before the final bill and retention were added, so nearly a third
      // of paid works released more than was sanctioned — R-013's exceptional
      // finding, true of 30% of the corpus. Releases cannot exceed the sanction
      // without a revised estimate; that case is planted deliberately below.
      //
      // A completed work has paid out its whole sanction: 15% advance, 70% across
      // the running bills, 10% final, 5% retention. One still being built has
      // released against what has actually been measured, so its share of that 70%
      // tracks physical progress.
      const RUNNING_BILL_SHARE = 0.70;
      const runningBudget =
        w.status === 'COMPLETED'
          ? RUNNING_BILL_SHARE
          : RUNNING_BILL_SHARE * (w.progressPct / 100);
      const perBill = (w.sanctioned_amount * runningBudget) / bills;

      let offset = 60;
      for (let b = 1; b <= bills; b++) {
        offset += randInt(45, 90);
        // Stop at the first bill that would fall after the as-of date rather than
        // skipping it and continuing: a history with a gap in the middle would say
        // a stage was never paid when the truth is the corpus ends first.
        if (!push('RUNNING_BILL', offset, perBill, `Running account bill ${b}`)) break;
      }
      if (w.status === 'COMPLETED') {
        // Retention is released after the defect-liability period, so it only
        // exists on a work whose final bill has been paid and whose liability
        // window has since closed.
        if (push('FINAL_BILL', offset + 75, w.sanctioned_amount * 0.1, 'Final bill on completion')) {
          push('RETENTION_RELEASE', offset + 75 + 180, w.sanctioned_amount * 0.05, 'Retention released after defect liability period');
        }
      }
    }

    // Planted as released-over-sanctioned. Topped up at the end of the window
    // rather than by inflating a bill above, so the overrun is the *cumulative*
    // release exceeding the sanction — which is what R-013 tests — instead of one
    // implausibly large stage payment.
    if (w.plant === 'RELEASE_OVERRUN') {
      const paid = w.payments.reduce((s, p) => s + p.amount, 0);
      const target = w.sanctioned_amount * (1.08 + random() * 0.17);
      if (target > paid) {
        push('RUNNING_BILL', window, target - paid, 'Revised estimate — cumulative release exceeds sanction');
      }
    }

    if (w.payments.length > 0) worksPaid += 1;
  }

  // 5b. Health reports — the 10-day progress check-in.
  //
  // `health_reports` was DROPped by the schema and never created, so nothing wrote
  // it and R-019 measured `works.updated_at` instead — a column that means "this
  // row changed", touched on every payment refresh, so any write reset the
  // reporting clock. With a real table the rule needs a real reporting history, and
  // without one R-019 stays in `UNCOVERED_RULES` with recall that is unmeasurable
  // rather than zero.
  //
  // Only IN_PROGRESS works are reported on: the cadence is a construction-period
  // obligation, so a completed or not-yet-started work has nothing to check in on
  // and an absent report for it is not a lapse. Reports run from sanction to a
  // per-work cutoff, and the cutoff is what decides whether R-019 fires:
  //
  //   * most works report up to the as-of date and are compliant;
  //   * a share stop early and are R-019's organic population;
  //   * works planted `REPORTING_LAPSED` always stop early;
  //   * a share have never been reported on at all, which is the case the detector
  //     describes differently — no report date to subtract, so the clock runs from
  //     sanction.
  let worksReported = 0;
  let reportCount = 0;
  let neverReported = 0;
  for (const w of works) {
    if (w.status !== 'IN_PROGRESS' || !w.sanctionDateStr) continue;

    const window = daysBetween(w.sanctionDateStr, CORPUS_AS_OF);
    if (window < REPORT_INTERVAL_DAYS) continue;   // obligation has not come due yet

    // ~8% have never been reported on. Not the same condition as a stale report,
    // and the detector says which of the two it found.
    if (w.plant !== 'REPORTING_LAPSED' && random() < 0.08) {
      neverReported += 1;
      continue;
    }

    // How far short of today the reporting stops.
    //
    // A planted lapse always ends well outside the grace period. Otherwise ~14%
    // lapse organically, and the rest report up to within one cadence of today —
    // which is inside the grace period and therefore compliant.
    let lapseDays: number;
    if (w.plant === 'REPORTING_LAPSED') {
      lapseDays = randInt(REPORT_OVERDUE_DAYS + 5, Math.max(REPORT_OVERDUE_DAYS + 6, Math.min(240, window)));
    } else if (random() < 0.14) {
      lapseDays = randInt(REPORT_OVERDUE_DAYS + 1, Math.max(REPORT_OVERDUE_DAYS + 2, Math.min(120, window)));
    } else {
      lapseDays = randInt(0, REPORT_INTERVAL_DAYS);
    }

    const lastOffset = window - lapseDays;
    if (lastOffset < REPORT_INTERVAL_DAYS) {
      // The lapse would swallow the whole window, which is the never-reported case
      // rather than a short reporting history. Counted as such instead of emitting
      // a single report dated at sanction.
      neverReported += 1;
      continue;
    }

    // Progress is interpolated linearly from 0 to the work's current figure across
    // the reported period, so each check-in is consistent with the one before it and
    // the newest matches `works.physical_progress_pct`. A report that disagreed with
    // the column it feeds would make the work's own history contradict its row.
    const reportOffsets: number[] = [];
    for (let d = REPORT_INTERVAL_DAYS; d <= lastOffset; d += REPORT_INTERVAL_DAYS) {
      reportOffsets.push(d);
    }
    if (reportOffsets.length === 0) continue;

    reportOffsets.forEach((offset, idx) => {
      const share = (idx + 1) / reportOffsets.length;
      w.healthReports.push({
        date: addDays(w.sanctionDateStr!, offset),
        progressPct: Math.round(w.progressPct * share),
        remarks: null,
      });
    });
    reportCount += w.healthReports.length;
    worksReported += 1;
  }
  console.log(
    `  ${reportCount} health reports across ${worksReported} works ` +
      `(${neverReported} in-progress works never reported on)`,
  );

  /** A work's released total is the sum of what was actually paid against it. */
  const releasedOf = (w: GeneratedWork) => w.payments.reduce((s, p) => s + p.amount, 0);

  // Emit works now that `released_amount` is known.
  //
  // `mp_name` is deliberately absent and takes its column default: doctrine #3
  // bars MP-level attribution, and a generated name on a row that also carries
  // alerts is exactly that attribution. `first_installment` and
  // `second_installment` are absent because they are RETIRED (DATA_CONTRACT §1.2).
  statements.push('-- Works');
  for (const w of works) {
    statements.push(
      `INSERT INTO works (id, esakshi_work_id, district_id, constituency_id, agency_id, title, description, category, location_name, status, physical_progress_pct, sanctioned_amount, released_amount, expenditure, recommended_date, sanction_date, completion_target_date, actual_completion_date, has_uc, uc_date, latitude, longitude, is_scsp, is_tsp, updated_at) VALUES (` +
        `'${w.id}', '${w.esakshiId}', '${w.dId}', '${w.cId}', '${w.agencyId}', '${escapeSql(w.title)}', 'Synthetic work description', '${w.category}', '${w.locationName}', '${w.status}', ${w.progressPct}, ${w.sanctioned_amount}, ${releasedOf(w)}, ${w.expenditure}, '${w.recDateStr}', ${w.sanctionDateStr ? `'${w.sanctionDateStr}'` : 'NULL'}, ${w.completionTargetDateStr ? `'${w.completionTargetDateStr}'` : 'NULL'}, ${w.completionDateStr ? `'${w.completionDateStr}'` : 'NULL'}, ${w.hasUc}, ${w.ucDateStr ? `'${w.ucDateStr}'` : 'NULL'}, ${w.latitude.toFixed(6)}, ${w.longitude.toFixed(6)}, ${w.isScsp}, ${w.isTsp}, '${w.updatedAt}'` +
      `) ON CONFLICT (id) DO NOTHING;`,
    );
  }
  statements.push('');

  statements.push('-- Payments (stage-wise)');
  let paymentCount = 0;
  for (const w of works) {
    w.payments.forEach((p, idx) => {
      paymentCount += 1;
      statements.push(
        `INSERT INTO payments (id, work_id, amount, payment_date, stage, sequence_number, purpose) VALUES ('${newId()}', '${w.id}', ${p.amount}, '${p.date}', '${p.stage}', ${idx + 1}, '${escapeSql(p.purpose)}') ON CONFLICT (work_id, sequence_number) DO NOTHING;`,
      );
    });
  }
  statements.push('');

  // Health reports. Emitted after works for the foreign key, and after payments
  // only for readability — there is no dependency between the two.
  statements.push('-- Health reports (10-day progress check-ins) — R-019 measures cadence from these');
  let healthReportRows = 0;
  for (const w of works) {
    for (const hr of w.healthReports) {
      healthReportRows += 1;
      statements.push(
        `INSERT INTO health_reports (id, work_id, reported_by, report_date, progress_pct, remarks) VALUES (` +
          `'${newId()}', '${w.id}', 'Field Inspector', '${hr.date}', ${hr.progressPct}, ` +
          `${hr.remarks ? `'${escapeSql(hr.remarks)}'` : 'NULL'}` +
          // `evidence_image_key` is deliberately absent rather than invented. Nothing
          // writes to the evidence bucket, so a key here would name an object that
          // does not exist — and R-010's photo-reuse detector would then be handed a
          // hash input that is really a filename pattern.
          `) ON CONFLICT (work_id, report_date) DO NOTHING;`,
      );
    }
  }
  statements.push('');

  // `works.last_payment_date` is derived, never authored. The seed loads SQL
  // directly rather than going through `services/payments.ts`, so the derivation
  // is written out here as the same max(payment_date) that service computes —
  // rather than each work carrying an independently-invented date that could
  // disagree with its own payment rows.
  statements.push('-- Derive works.last_payment_date from the rows above');
  statements.push(
    'UPDATE works w SET last_payment_date = p.last_date FROM (' +
      'SELECT work_id, MAX(payment_date) AS last_date FROM payments GROUP BY work_id' +
      ') p WHERE p.work_id = w.id;',
  );
  statements.push('');
  console.log(`  ${paymentCount} stage payments across ${worksPaid} of ${works.length} works`);

  // 6. Alerts — deliberately none.
  //
  // Alerts are the *output* of the rule engine and detectors, not seed input.
  // This generator used to emit 50 of them by drawing a rule ID, a severity and
  // a work at random, independently of each other, with a single canned
  // evidence string. None of the four rule IDs it drew existed in
  // `backend/src/rules/mplads_rules.yaml`, so the rows rendered in the triage
  // queue but could not be opened on /rules, put on probation, or shown with a
  // verification_status. Worse, they would have counted as false positives
  // against any answer key, corrupting /evaluation.
  //
  // The triage queue is populated by `POST /api/analyze`, which runs the
  // catalogued rules and the detectors over these works and derives each
  // alert's rule, severity and evidence text from the rule that fired.

  // 7. Answer key — the ground truth `/evaluation` scores those alerts against.
  const answers = deriveAnswerKey(works);
  statements.push('-- Answer key (ground truth for /evaluation)');
  statements.push(`-- Covered rules: ${[...new Set(answers.map((a) => a.ruleId))].sort().join(', ')}`);
  // "Not scored", not "not derivable". R-021's ground truth is perfectly derivable
  // here and simply has not been written — see UNCOVERED_RULES. A blanket
  // "no ground truth derivable" would have told a reader of this seed file that the
  // corpus cannot express it, which is false for one of the ten.
  statements.push(`-- Not scored (see UNCOVERED_RULES in data-gen/generate.ts): ${UNCOVERED_RULES.join(', ')}`);
  for (const a of answers) {
    statements.push(
      `INSERT INTO answer_key (id, work_id, anomaly_type, description, expected_rule_id) VALUES ` +
        `('${newId()}', '${a.workId}', '${a.type}', '${escapeSql(a.description)}', '${a.ruleId}') ON CONFLICT (id) DO NOTHING;`,
    );
  }
  statements.push('');

  // Every catalogued rule must be either covered by the key or listed as uncovered.
  //
  // A rule in neither list is the failure this guards: it produces `unscored_alerts`
  // on /evaluation exactly like a declared-uncovered rule, so nothing in the UI
  // distinguishes "we decided not to score this" from "we forgot this exists".
  // R-021 sat in that gap — the key covered 10 rules, UNCOVERED_RULES named 9, and
  // the catalogue had 21. Cheap to check at generation time, invisible otherwise.
  const covered = new Set(answers.map((a) => a.ruleId));
  const accounted = new Set([...covered, ...UNCOVERED_RULES]);
  const unaccounted = CATALOGUE_RULE_IDS.filter((id) => !accounted.has(id));
  const doubleCounted = UNCOVERED_RULES.filter((id) => covered.has(id));
  if (unaccounted.length > 0) {
    console.warn(
      `  WARNING: ${unaccounted.length} catalogued rule(s) in neither the answer key ` +
        `nor UNCOVERED_RULES: ${unaccounted.join(', ')}. ` +
        `Add ground truth to GROUND_TRUTH or record the omission in UNCOVERED_RULES.`,
    );
  }
  if (doubleCounted.length > 0) {
    console.warn(
      `  WARNING: ${doubleCounted.join(', ')} listed as uncovered but present in the ` +
        `answer key. Remove from UNCOVERED_RULES — the seed header contradicts itself.`,
    );
  }

  const byType = new Map<string, number>();
  for (const a of answers) byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
  console.log(`  ${answers.length} answer-key rows across ${byType.size} anomaly types:`);
  for (const [type, n] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(n).padStart(4)}  ${type}`);
  }

  // Written to `supabase/seed.sql`, not to a file under `supabase/migrations/`.
  //
  // This used to overwrite `004_seed_data.sql`, so every run rewrote a
  // version-controlled migration: applied schema history became a build artifact
  // of a data generator, and the diff of a migration could not be told apart from
  // the diff of a corpus. Migrations are history — ordered, applied once, and
  // never rewritten. A seed is current-state data, regenerated whenever the corpus
  // should change. They are different things and now live in different files.
  const sqlFile = resolve(MODULE_DIR, '../supabase/seed.sql');
  writeFileSync(sqlFile, statements.join('\n'));
  console.log(`Generated ${sqlFile} successfully.`);

  writeCsv(works, resolve(MODULE_DIR, '../drishti_works_dataset.csv'));
}

/** Quote a CSV cell only when it needs it, and escape any embedded quote. */
function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Emit the demo corpus an evaluator uploads on /ingest.
 *
 * Written from the same `GeneratedWork` objects as the SQL seed rather than by a
 * separate script, because the two artifacts describe the same corpus and had
 * drifted: the CSV was generated at a different wall-clock time from a different
 * date window, so a work's payment history in the file disagreed with the payment
 * rows in the seed for a work of the same name. One derivation, two outputs.
 *
 * The column set is what `backend/src/routers/ingest.ts` actually reads — 22
 * columns, including `recommended_date` and `location_name`. Both were previously
 * absent, so the ingest fell back: `recommended_date` to `sanction_date`
 * (ingest.ts:242), which made the recommendation-to-sanction lag exactly zero on
 * every work in the corpus and the sanctioning SLA unmeasurable, and
 * `location_name` to the literal 'Main Site'.
 */
function writeCsv(works: GeneratedWork[], csvPath: string): void {
  const headers = [
    'work_id', 'district_lgd', 'constituency_code', 'work_title', 'work_description',
    'category', 'sanctioned_amount', 'released_amount', 'expenditure', 'recommended_date',
    'sanction_date', 'completion_date', 'status', 'physical_progress_pct', 'has_uc',
    'agency_name', 'location_name', 'latitude', 'longitude', 'is_scsp', 'is_tsp',
    'payment_history',
  ];

  const lines = [headers.join(',')];
  let latestPayment = '';

  for (const w of works) {
    // `STAGE:YYYY-MM-DD:AMOUNT`, pipe-separated, in payment order — position in
    // the cell becomes payments.sequence_number. See docs/DATA_CONTRACT.md §1.1.
    const history = w.payments.map((p) => `${p.stage}:${p.date}:${p.amount}`).join('|');
    for (const p of w.payments) if (p.date > latestPayment) latestPayment = p.date;

    lines.push([
      w.esakshiId,
      w.districtCode,
      w.constituencyCode,
      csvCell(w.title),
      'Synthetic work description for demo data import',
      w.category,
      String(w.sanctioned_amount),
      String(w.payments.reduce((s, p) => s + p.amount, 0)),
      String(w.expenditure),
      w.recDateStr,
      w.sanctionDateStr ?? '',
      w.completionDateStr ?? '',
      w.status,
      String(w.progressPct),
      String(w.hasUc),
      csvCell(w.agencyName),
      csvCell(w.locationName),
      w.latitude.toFixed(6),
      w.longitude.toFixed(6),
      String(w.isScsp),
      String(w.isTsp),
      history,
    ].join(','));
  }

  writeFileSync(csvPath, lines.join('\n'));

  // A payment dated after the as-of date is not data: it makes every interval
  // measured from last_payment_date negative, which is the arithmetic the stage
  // history exists to make measurable. Throw rather than write a file that would
  // have to be caught by eye downstream.
  if (latestPayment && latestPayment > CORPUS_AS_OF) {
    throw new Error(`BUG: emitted a payment dated ${latestPayment}, after the as-of date ${CORPUS_AS_OF}`);
  }
  console.log(`Generated ${csvPath} (${works.length} works, latest payment ${latestPayment || 'n/a'}).`);
}

generateData();
