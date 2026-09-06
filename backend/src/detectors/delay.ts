/**
 * Delay & Stall Detectors (R-006, R-007, R-015, R-018, R-019)
 *
 * Every threshold in this file is read from `rules/mplads_rules.yaml` by
 * `delayParamsFromRules`, which `services/alerts.ts` calls before invoking the
 * detector. Until now they were hardcoded here and the YAML's `params` blocks were
 * dead config: an operator could edit the catalogue, see the change on `/rules`,
 * and get no change in behaviour whatsoever. A rule catalogue whose numbers are
 * ignored is worse than no catalogue, because it documents thresholds the system
 * does not actually use.
 *
 * The constants below are fallbacks for the case where a rule is missing from the
 * catalogue entirely. They are not the source of truth — the YAML is.
 *
 * None of these five rules is predictive. Every one of them subtracts two dates, or
 * divides an elapsed interval by a schedule, and compares the result to a threshold
 * from the catalogue. R-018 carried the name "Predictive Delay Velocity" and the
 * reason code `DELAY_PREDICTED`; there is no model behind either, and describing a
 * division as a forecast invites a question about methodology that has no answer.
 * The findings stand on their own — a work at 20% after nine months of a twelve-month
 * schedule is behind, and saying so needs no claim about the future.
 */

import type { RuleDefinition, Work } from '../types.ts';
import type { AnomalyCandidate } from './cost_outlier.ts';
import { daysBetween, monthsBetween, nowIso } from '../util.ts';

/**
 * R-006 — the scheme's completion deadline, in months from sanction.
 *
 * MPLADS guidance is that a sanctioned work should be completed within about one
 * year of the date of sanction. This was 24 months, which is not a figure the
 * guidelines support; every work between 12 and 24 months overdue was silently
 * treated as on time.
 */
const DEFAULT_TIMELINE_LIMIT_MONTHS = 12;

/**
 * R-018 — the straight-line schedule pacing is measured against, in months. This
 * is the denominator in "how far along should this work be by now?".
 *
 * A separate constant from the R-006 limit above, deliberately, and the two must
 * stay separate even though they hold the same number today. They answer different
 * questions — R-006 asks *has the deadline passed*, R-018 asks *is this work
 * tracking to its deadline* — and they were wrong independently. Fixing the R-006
 * breach threshold does nothing for R-018: with a 24-month horizon against a real
 * 12-month deadline, R-018 expected a work to be half as far along as it should be,
 * so it under-reported every genuinely slow work by a factor of two. Whoever next
 * changes one of these should change it alone and think about the other separately.
 */
const DEFAULT_PACING_HORIZON_MONTHS = 12;

/** R-018 — minimum elapsed months before pacing is judged at all. */
const DEFAULT_MIN_ELAPSED_MONTHS = 6;
/** R-018 — fire when actual progress is below this fraction of expected progress. */
const DEFAULT_MIN_VELOCITY_RATIO = 0.5;
/** R-007 — days without payment or progress before a work counts as stalled. */
const DEFAULT_STALL_DAYS = 180;
/** R-015 — days a work may sit ON_HOLD before it is reported. */
const DEFAULT_MAX_HOLD_DAYS = 120;
/** R-019 — the mandated health-report cadence, and the grace period on top of it. */
const DEFAULT_REPORT_INTERVAL_DAYS = 10;
const DEFAULT_GRACE_PERIOD_DAYS = 5;

/**
 * Thresholds for the five delay rules, as read from the rule catalogue.
 *
 * `timelineLimitMonths` and `pacingHorizonMonths` are separate fields on purpose —
 * see the constants above. Collapsing them into one "months" field is exactly the
 * mistake that let R-018 stay broken while R-006 looked fixed.
 */
export interface DelayDetectorParams {
  /** R-006 breach threshold: months from sanction after which an open work is late. */
  timelineLimitMonths: number;
  /** R-018 pacing denominator: the schedule progress is measured against. */
  pacingHorizonMonths: number;
  minElapsedMonths: number;
  minVelocityRatio: number;
  stallDays: number;
  maxHoldDays: number;
  /** R-019: cadence + grace, summed into the age at which a report counts as missing. */
  reportIntervalDays: number;
  gracePeriodDays: number;
}

export const DEFAULT_DELAY_PARAMS: DelayDetectorParams = {
  timelineLimitMonths: DEFAULT_TIMELINE_LIMIT_MONTHS,
  pacingHorizonMonths: DEFAULT_PACING_HORIZON_MONTHS,
  minElapsedMonths: DEFAULT_MIN_ELAPSED_MONTHS,
  minVelocityRatio: DEFAULT_MIN_VELOCITY_RATIO,
  stallDays: DEFAULT_STALL_DAYS,
  maxHoldDays: DEFAULT_MAX_HOLD_DAYS,
  reportIntervalDays: DEFAULT_REPORT_INTERVAL_DAYS,
  gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
};

function numericParam(rule: RuleDefinition | undefined, key: string, fallback: number): number {
  const raw = rule?.params?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Maps the catalogue's `params` blocks onto {@link DelayDetectorParams}.
 *
 * The YAML key knowledge lives here, next to the detector that owns these rules,
 * rather than in `alerts.ts`. R-006's threshold is `max_months` and R-018's is
 * `pacing_horizon_months` — distinct names for distinct meanings. They were both
 * called `max_months`, and that shared name is how the two came to be treated as
 * one number. There is deliberately no fallback from one to the other.
 */
export function delayParamsFromRules(rules: RuleDefinition[]): DelayDetectorParams {
  const byId = new Map<string, RuleDefinition>(rules.map((r) => [r.id, r]));
  const r006 = byId.get('R-006');
  const r007 = byId.get('R-007');
  const r015 = byId.get('R-015');
  const r018 = byId.get('R-018');
  const r019 = byId.get('R-019');

  return {
    timelineLimitMonths: numericParam(r006, 'max_months', DEFAULT_TIMELINE_LIMIT_MONTHS),
    pacingHorizonMonths: numericParam(r018, 'pacing_horizon_months', DEFAULT_PACING_HORIZON_MONTHS),
    minElapsedMonths: numericParam(r018, 'min_elapsed_months', DEFAULT_MIN_ELAPSED_MONTHS),
    minVelocityRatio: numericParam(r018, 'min_velocity_ratio', DEFAULT_MIN_VELOCITY_RATIO),
    stallDays: numericParam(r007, 'stall_days', DEFAULT_STALL_DAYS),
    maxHoldDays: numericParam(r015, 'max_hold_days', DEFAULT_MAX_HOLD_DAYS),
    reportIntervalDays: numericParam(r019, 'report_interval_days', DEFAULT_REPORT_INTERVAL_DAYS),
    gracePeriodDays: numericParam(r019, 'grace_period_days', DEFAULT_GRACE_PERIOD_DAYS),
  };
}

/**
 * The deadline a work is actually held to, in months from sanction.
 *
 * The exceptional-extension provision: the guidelines allow the sanctioning
 * authority to extend a work's completion date, so a work inside a granted
 * extension is behind the standard timeline but is *not* in breach of the scheme.
 * Where an extended target date is on record, that date is the deadline.
 *
 * An extension only ever moves the deadline later. A `completion_target_date`
 * earlier than the standard limit is an internal target, not a scheme deadline, and
 * must not manufacture a breach that the guidelines would not.
 *
 * Data note: `completion_target_date` is populated for a minority of works and is
 * absent from the CSV ingest contract entirely. The synthetic generator emits it for
 * roughly a fifth of works (`data-gen/generate.ts:788`), so this provision does take
 * effect on part of the corpus and returns the standard limit for the rest. Coverage
 * that thin is why no coverage-wide metric is derived from this column anywhere — see
 * the "no timely execution rate" note in `services/agency_performance.ts`.
 */
function effectiveLimitMonths(w: Work, standardLimitMonths: number): number {
  if (!w.sanction_date || !w.completion_target_date) return standardLimitMonths;
  const extended = monthsBetween(w.sanction_date, w.completion_target_date);
  return extended > standardLimitMonths ? extended : standardLimitMonths;
}

export function detectDelays(
  works: Work[],
  params: DelayDetectorParams = DEFAULT_DELAY_PARAMS,
  /**
   * Newest health-report date per work, from `services/health_reports.ts`.
   *
   * R-019's only valid input. Omitting it disables R-019 rather than falling back
   * to `works.updated_at`: that column means *this row changed*, and
   * `services/payments.ts` touches it on every payment refresh, so measuring
   * cadence from it reset the clock on any write and reported a work as compliant
   * because something unrelated about it had been edited. A rule that fires on the
   * wrong column is worse than one that does not fire, because its silence reads
   * as compliance.
   */
  lastReportDate?: Map<string, string>,
): AnomalyCandidate[] {
  const candidates: AnomalyCandidate[] = [];
  const today = nowIso().slice(0, 10);
  const missingReportDays = params.reportIntervalDays + params.gracePeriodDays;

  for (const w of works) {
    // 1. R-006: Delayed beyond the scheme completion timeline.
    if (w.sanction_date && ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD'].includes(w.status)) {
      const months = monthsBetween(w.sanction_date, today);
      const limit = effectiveLimitMonths(w, params.timelineLimitMonths);
      const extended = limit > params.timelineLimitMonths;
      if (months > limit) {
        candidates.push({
          work_id: w.id,
          rule_id: 'R-006',
          origin_id: `delayed_${w.id}`,
          severity: 'HIGH',
          severity_rank: 2,
          reason_code: 'DELAYED_BEYOND_TIMELINE',
          evidence_text: extended
            ? `Work sanctioned on ${w.sanction_date}, now ${months} months elapsed. Deadline extended to ${w.completion_target_date} (${limit} months from sanction); still overdue against that extension. Status: ${w.status}.`
            : `Work sanctioned on ${w.sanction_date}, now ${months} months elapsed (scheme limit: ${limit} months, no extension on record). Status: ${w.status}.`,
          // Confidence rises with the overrun beyond whichever deadline applies. It
          // has to key off `limit`, not a literal: against a hardcoded 24 this went
          // negative for every work between 12 and 24 months late.
          confidence: Math.min(1.0, 0.6 + (months - limit) * 0.05),
        });
      }
    }

    // 2. R-007: Stalled — no progress or payment activity.
    if (['IN_PROGRESS', 'NOT_STARTED'].includes(w.status)) {
      const referenceDate = w.last_payment_date ?? w.sanction_date;
      if (referenceDate) {
        const days = daysBetween(referenceDate, today);
        if (days >= params.stallDays && (w.physical_progress_pct ?? 0) < 100) {
          candidates.push({
            work_id: w.id,
            rule_id: 'R-007',
            origin_id: `stalled_${w.id}`,
            severity: 'HIGH',
            severity_rank: 2,
            reason_code: 'STALLED_NO_PROGRESS',
            evidence_text: `No payment or progress recorded in ${days} days (threshold: ${params.stallDays} days). Last activity date: ${referenceDate}. Progress: ${w.physical_progress_pct ?? 0}%.`,
            confidence: Math.min(1.0, 0.5 + (days / 365) * 0.5),
          });
        }
      }
    }

    // 3. R-015: Work on hold too long.
    if (w.status === 'ON_HOLD') {
      const refDate = w.updated_at ? w.updated_at.slice(0, 10) : w.sanction_date;
      if (refDate) {
        const holdDays = daysBetween(refDate, today);
        if (holdDays >= params.maxHoldDays) {
          candidates.push({
            work_id: w.id,
            rule_id: 'R-015',
            origin_id: `on_hold_${w.id}`,
            severity: 'MEDIUM',
            severity_rank: 3,
            reason_code: 'ON_HOLD_TOO_LONG',
            evidence_text: `Work has been on hold for ${holdDays} days (threshold: ${params.maxHoldDays} days).`,
            confidence: Math.min(1.0, 0.5 + (holdDays / 200) * 0.5),
          });
        }
      }
    }

    // 4. R-018: Pacing — is this work as far along as a uniform schedule expects?
    //
    // This is arithmetic, not prediction. `expectedProgress` is elapsed months over
    // the horizon; the rule fires when reported progress is below half of it. There
    // is no model, no fitted trend and no extrapolation of the work's own history —
    // two works at the same elapsed time and the same progress get the same answer
    // regardless of how they got there. It was called "predictive delay velocity"
    // and its reason code was `DELAY_PREDICTED`, which claims a forecast: a reader
    // would reasonably expect a completion-date estimate behind it, and an evaluator
    // asking to see the model would find a division.
    //
    // What it does say is worth saying — a work at 20% after nine months of a
    // twelve-month schedule is behind, and that is actionable. It just has to be
    // named for what it measures.
    if (w.status === 'IN_PROGRESS' && w.sanction_date) {
      const months = monthsBetween(w.sanction_date, today);
      // Pacing is judged against the deadline this work is actually held to, so a
      // granted extension relaxes the expected curve instead of flagging a work for
      // failing to meet a schedule nobody holds it to. Past the horizon there is
      // nothing left for pacing to say — the work is already overdue and R-006 owns
      // it.
      const horizon = effectiveLimitMonths(w, params.pacingHorizonMonths);

      if (months >= params.minElapsedMonths && months < horizon) {
        const expectedProgress = Math.min((months / horizon) * 100, 100);
        const actualProgress = w.physical_progress_pct ?? 0;
        const velocityRatio = expectedProgress > 0 ? actualProgress / expectedProgress : 1;

        if (velocityRatio < params.minVelocityRatio) {
          candidates.push({
            work_id: w.id,
            rule_id: 'R-018',
            // Left as `velocity_` deliberately. This is half of the
            // UNIQUE(work_id, origin_id) key the alert upsert matches on, not a
            // label anyone reads — renaming it would fail to match the existing row
            // and raise a second alert for the same finding, discarding whatever
            // review an officer had already recorded against the first.
            origin_id: `velocity_${w.id}`,
            severity: 'HIGH',
            severity_rank: 2,
            reason_code: 'BEHIND_SCHEDULE_PACE',
            evidence_text: `Work sanctioned on ${w.sanction_date} (${months.toFixed(1)} months ago). On a uniform ${horizon}-month schedule, ${expectedProgress.toFixed(1)}% progress would be due by now; reported progress is ${actualProgress.toFixed(1)}% (${(velocityRatio * 100).toFixed(0)}% of the expected figure, threshold: ${(params.minVelocityRatio * 100).toFixed(0)}%). This is a comparison against a straight-line schedule, not a forecast of the completion date.`,
            // Confidence scales with the size of the shortfall — how far below the
            // straight line this work sits, not how likely it is to finish late.
            confidence: Math.min(1.0, 0.4 + (1 - velocityRatio)),
          });
        }
      }
    }

    // 5. R-019: Missing health report.
    //
    // Measured from the `health_reports` table, which is the record of the
    // check-in the cadence is about. Without that map the rule does not fire at
    // all — see the `lastReportDate` parameter above for why no fallback column
    // will do.
    //
    // Two cases, and they carry different evidence rather than one averaged
    // sentence. A work that has been reported on has a last report date, and the
    // gap is measured from it. A work that has *never* been reported on has no
    // report date to subtract, so the clock runs from `sanction_date` — the point
    // the reporting obligation begins. That is an interval the record supports;
    // it is not a stand-in for a report that does not exist, and the evidence text
    // says which of the two it is.
    if (lastReportDate && w.status === 'IN_PROGRESS' && (w.physical_progress_pct ?? 0) < 100) {
      const reported = lastReportDate.get(w.id);
      const refDate = reported ?? w.sanction_date;
      if (refDate) {
        const daysSinceReport = daysBetween(refDate, today);
        if (daysSinceReport >= missingReportDays) {
          candidates.push({
            work_id: w.id,
            rule_id: 'R-019',
            origin_id: `missing_report_${w.id}`,
            severity: 'MEDIUM',
            severity_rank: 3,
            reason_code: 'MISSING_HEALTH_REPORT',
            evidence_text: reported
              ? `Last ${params.reportIntervalDays}-day health report was filed on ${reported}, ${daysSinceReport} days ago (cadence ${params.reportIntervalDays} days plus ${params.gracePeriodDays}-day grace period).`
              : `No ${params.reportIntervalDays}-day health report has ever been filed for this work. Sanctioned ${daysSinceReport} days ago on ${w.sanction_date} (cadence ${params.reportIntervalDays} days plus ${params.gracePeriodDays}-day grace period).`,
            confidence: 0.9,
          });
        }
      }
    }
  }

  return candidates;
}
