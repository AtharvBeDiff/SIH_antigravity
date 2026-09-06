/**
 * Rule Engine Service
 *
 * Evaluates the per-work rules from `rules/mplads_rules.yaml`. Rules that need
 * the whole corpus (cost outliers, delays, duplicates, photo reuse) live in
 * `detectors/`, and the sanction-decision SLA in `services/sla_engine.ts`.
 *
 * Photo reuse is in that list because the detector exists, not because it runs to
 * effect: nothing writes `works.evidence_image_key`, so R-010 is dormant and carries
 * `dormant_reason` in the YAML. See `detectors/photo_reuse.ts`.
 *
 * Not every catalogued rule has a branch in the switch below. Follows Doctrine
 * #6: Null-Field Rule — a rule must NEVER fire on a null field.
 */

import type { Work, Payment } from '../types.ts';
import { INELIGIBLE_CATEGORIES as CANONICAL_INELIGIBLE_CATEGORIES } from '../types.ts';
import type { AnomalyCandidate } from '../detectors/cost_outlier.ts';
import { isRuleSuspended } from './probation.ts';
import { numericParam, stageListParam, summarisePayments } from './fund_flow.ts';
import { fmtINR, daysBetween, nowIso } from '../util.ts';

/**
 * Re-exported from `./catalogue.ts`, which is where the loader now lives. Kept
 * here so the existing importers keep working; new code should import it from
 * the catalogue module directly.
 */
export { loadRulesConfig } from './catalogue.ts';
import { loadRulesConfig } from './catalogue.ts';

/**
 * Categories R-011 treats as ineligible for MPLADS funding.
 *
 * Two vocabularies, both live, which is why this is not just the canonical list:
 *
 *   - `INELIGIBLE_CATEGORIES` from `types.ts` holds the canonical value
 *     (`RELIGIOUS_HERITAGE`) that the generator writes and that `WORK_CATEGORIES`
 *     admits.
 *   - The rest are upstream spellings. `routers/ingest.ts:234` passes `category`
 *     through verbatim, so a real e-SAKSHI file carrying `RELIGIOUS` or
 *     `COMMERCIAL` lands in the column with that spelling and never matches a
 *     canonical value.
 *
 * The previous list held only the seven upstream spellings and shared no value with
 * the 15 categories the system accepts, so `includes` could not return true by any
 * code path and R-011 was dead while marked `VERIFIED` in the catalogue. The
 * canonical values were declared in `types.ts` with zero importers. Both sets are
 * now tested, and the import is the one that keeps the two files from drifting.
 */
const INELIGIBLE_CATEGORY_VALUES: string[] = [
  ...CANONICAL_INELIGIBLE_CATEGORIES,
  // Upstream spellings accepted verbatim on ingest.
  'RELIGIOUS', 'COMMERCIAL', 'OFFICE_BUILDING', 'PRIVATE_PROPERTY',
  'CLUB_HOUSE', 'ACQUISITION', 'MEMORIAL',
];

export async function evaluateWorkRules(
  work: Work,
  suspendedRuleIds?: Set<string>,
  /**
   * The work's stage payments. Optional so a caller evaluating a single work
   * need not fetch them, but R-002, R-012 and R-014 all read money movement, and
   * an omitted history is treated as *unknown*, not as zero — a work with no
   * payment record must not be reported as a work that was never paid.
   */
  payments?: Payment[],
): Promise<AnomalyCandidate[]> {
  const config = loadRulesConfig();
  const candidates: AnomalyCandidate[] = [];
  const today = nowIso().slice(0, 10);
  const history = payments ? summarisePayments(payments) : null;

  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    
    // Check probation suspension
    if (suspendedRuleIds) {
      if (suspendedRuleIds.has(rule.id)) continue;
    } else {
      if (await isRuleSuspended(rule.id)) continue;
    }

    // Check status applicability
    if (rule.applies_to_status && !rule.applies_to_status.includes(work.status as any)) {
      continue;
    }

    switch (rule.id) {
      case 'R-002': {
        // Payment released ahead of verified progress.
        //
        // Reads the payment history rather than `works.released_amount`. Under a
        // stage-payment regime each release follows a measurement, so the
        // question is whether *measured-bill* money has outrun measured progress
        // — and the mobilisation advance has to come out of that total first,
        // because it is paid against a bank guarantee before anything is
        // measured. Counting it flags every work that received one, which is the
        // normal case, not a finding.
        //
        // Falls back to `released_amount` when no payment history is loaded. The
        // fallback is the old, coarser question and the evidence text says so; it
        // is not silently presented as the stage-aware answer.
        const gapThreshold = numericParam(rule, 'release_progress_gap', 40);
        const minReleased = numericParam(rule, 'min_released', 100000);
        const excluded = stageListParam(rule, 'exclude_stages', ['MOBILISATION_ADVANCE']);

        if (
          typeof work.sanctioned_amount === 'number' &&
          work.sanctioned_amount > 0 &&
          typeof work.physical_progress_pct === 'number'
        ) {
          let paidAgainstMeasurement: number | null = null;
          let basis = '';

          if (history) {
            paidAgainstMeasurement = history.ordered
              .filter((p) => !excluded.includes(p.stage))
              .reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0);
            const advance = history.total_paid - paidAgainstMeasurement;
            basis =
              advance > 0
                ? ` (measured-bill payments only; ${fmtINR(advance)} mobilisation advance excluded)`
                : ' (measured-bill payments)';
          } else if (typeof work.released_amount === 'number') {
            paidAgainstMeasurement = work.released_amount;
            basis = ' (total released; no stage payment history on record, so a mobilisation advance cannot be separated out)';
          }

          if (paidAgainstMeasurement !== null && paidAgainstMeasurement >= minReleased) {
            const releasePct = (paidAgainstMeasurement / work.sanctioned_amount) * 100;
            const gap = releasePct - work.physical_progress_pct;
            if (gap >= gapThreshold) {
              candidates.push({
                work_id: work.id,
                rule_id: 'R-002',
                origin_id: `release_progress_gap_${work.id}`,
                severity: 'HIGH',
                severity_rank: 2,
                reason_code: 'FUNDS_AHEAD_OF_PROGRESS',
                evidence_text: `Paid ${fmtINR(paidAgainstMeasurement)}${basis} — ${releasePct.toFixed(0)}% of sanctioned — but physical progress is only ${work.physical_progress_pct}%. Gap: ${gap.toFixed(0)} percentage points (threshold: ${gapThreshold}).`,
                confidence: 0.85,
              });
            }
          }
        }
        break;
      }

      case 'R-003': {
        // Missing Utilisation Certificate for completed work
        if (work.status === 'COMPLETED' && work.actual_completion_date) {
          if (!work.has_uc) {
            const daysSinceCompletion = daysBetween(work.actual_completion_date, today);
            if (daysSinceCompletion > 90) {
              candidates.push({
                work_id: work.id,
                rule_id: 'R-003',
                origin_id: `missing_uc_${work.id}`,
                severity: 'MEDIUM',
                severity_rank: 3,
                reason_code: 'MISSING_UTILISATION_CERTIFICATE',
                evidence_text: `Work completed on ${work.actual_completion_date} (${daysSinceCompletion} days ago) but no Utilisation Certificate (UC) is filed (grace period: 90 days).`,
                confidence: 0.90,
              });
            }
          }
        }
        break;
      }

      case 'R-004': {
        // Expenditure exceeds sanctioned amount
        if (
          typeof work.expenditure === 'number' &&
          typeof work.sanctioned_amount === 'number' &&
          work.sanctioned_amount > 0
        ) {
          const overrunPct = ((work.expenditure - work.sanctioned_amount) / work.sanctioned_amount) * 100;
          if (overrunPct > 10) {
            candidates.push({
              work_id: work.id,
              rule_id: 'R-004',
              origin_id: `cost_overrun_${work.id}`,
              severity: 'CRITICAL',
              severity_rank: 1,
              reason_code: 'EXPENDITURE_EXCEEDS_SANCTION',
              evidence_text: `Expenditure of ${fmtINR(work.expenditure)} exceeds sanctioned ${fmtINR(work.sanctioned_amount)} by ${overrunPct.toFixed(1)}% (allowed variance: 10%).`,
              confidence: 0.95,
            });
          }
        }
        break;
      }

      case 'R-005': {
        // Zero expenditure on in-progress work
        if (
          work.status === 'IN_PROGRESS' &&
          typeof work.physical_progress_pct === 'number' &&
          work.physical_progress_pct >= 10 &&
          work.expenditure === 0
        ) {
          candidates.push({
            work_id: work.id,
            rule_id: 'R-005',
            origin_id: `zero_expenditure_${work.id}`,
            severity: 'MEDIUM',
            severity_rank: 3,
            reason_code: 'ZERO_EXPENDITURE_IN_PROGRESS',
            evidence_text: `Work shows ${work.physical_progress_pct}% physical progress but ₹0 expenditure has been recorded.`,
            confidence: 0.75,
          });
        }
        break;
      }

      case 'R-008': {
        // Completed but low progress recorded
        if (
          work.status === 'COMPLETED' &&
          typeof work.physical_progress_pct === 'number' &&
          work.physical_progress_pct < 80
        ) {
          candidates.push({
            work_id: work.id,
            rule_id: 'R-008',
            origin_id: `completed_low_progress_${work.id}`,
            severity: 'MEDIUM',
            severity_rank: 3,
            reason_code: 'COMPLETED_LOW_PROGRESS',
            evidence_text: `Status is COMPLETED but physical progress is only ${work.physical_progress_pct}% (expected ≥80%).`,
            confidence: 0.85,
          });
        }
        break;
      }

      case 'R-011': {
        // Ineligible category.
        //
        // Doctrine 6: an absent category is unknown, not ineligible. A work whose
        // category never arrived must not be reported as prohibited.
        if (work.category && INELIGIBLE_CATEGORY_VALUES.includes(work.category.toUpperCase())) {
          candidates.push({
            work_id: work.id,
            rule_id: 'R-011',
            origin_id: `ineligible_category_${work.id}`,
            severity: 'HIGH',
            severity_rank: 2,
            reason_code: 'INELIGIBLE_CATEGORY',
            evidence_text: `Category '${work.category}' is not eligible for MPLADS funding under the scheme guidelines.`,
            confidence: 0.99,
          });
        }
        break;
      }

      case 'R-012': {
        // Stage-payment pipeline stalled.
        //
        // Doctrine #6 governs the shape here. Without a loaded payment history
        // the rule cannot tell "no measured-bill payment was made" from "no
        // payment record was fetched", and firing on the second is firing on a
        // null field. It stays silent instead — the old version read
        // `works.second_installment`, a column nothing ever wrote, so it fired on
        // every high-value work in the corpus.
        if (!history) break;

        const highValue = numericParam(rule, 'high_value_threshold', 2500000);
        const minProgress = numericParam(rule, 'min_progress_for_second', 50);

        if (
          typeof work.sanctioned_amount === 'number' &&
          work.sanctioned_amount >= highValue &&
          typeof work.physical_progress_pct === 'number' &&
          work.physical_progress_pct >= minProgress &&
          history.measured_count === 0
        ) {
          candidates.push({
            work_id: work.id,
            rule_id: 'R-012',
            origin_id: `stage_payment_stalled_${work.id}`,
            severity: 'LOW',
            severity_rank: 4,
            reason_code: 'STAGE_PAYMENT_PIPELINE_STALLED',
            evidence_text: `High-value work (${fmtINR(work.sanctioned_amount)}) has reached ${work.physical_progress_pct}% progress, but its payment history stops at ${history.count} stage payment(s) totalling ${fmtINR(history.total_paid)} with no measured-bill payment recorded.`,
            confidence: 0.70,
          });
        }
        break;
      }

      case 'R-013': {
        // Released amount exceeds sanctioned
        if (
          typeof work.released_amount === 'number' &&
          typeof work.sanctioned_amount === 'number' &&
          work.sanctioned_amount > 0
        ) {
          const overrunPct = ((work.released_amount - work.sanctioned_amount) / work.sanctioned_amount) * 100;
          if (overrunPct > 5) {
            candidates.push({
              work_id: work.id,
              rule_id: 'R-013',
              origin_id: `release_overrun_${work.id}`,
              severity: 'HIGH',
              severity_rank: 2,
              reason_code: 'RELEASE_EXCEEDS_SANCTION',
              evidence_text: `Released funds (${fmtINR(work.released_amount)}) exceed sanctioned amount (${fmtINR(work.sanctioned_amount)}) by ${overrunPct.toFixed(1)}%.`,
              confidence: 0.95,
            });
          }
        }
        break;
      }

      case 'R-014': {
        // Sanctioned but never paid.
        //
        // Same null-field constraint as R-012: an absent payment history is
        // unknown, not empty. The old version read `works.first_installment`,
        // which nothing wrote, so this fired on every NOT_STARTED work older than
        // 90 days regardless of what had actually been paid.
        if (!history) break;

        const maxDays = numericParam(rule, 'max_days_without_first', 90);
        if (work.sanction_date && history.count === 0) {
          const days = daysBetween(work.sanction_date, today);
          if (days > maxDays) {
            candidates.push({
              work_id: work.id,
              rule_id: 'R-014',
              origin_id: `no_payment_since_sanction_${work.id}`,
              severity: 'MEDIUM',
              severity_rank: 3,
              reason_code: 'NO_PAYMENT_SINCE_SANCTION',
              evidence_text: `Sanctioned on ${work.sanction_date} (${days} days ago, threshold ${maxDays}) with no payment of any stage recorded. Status: ${work.status}, progress ${work.physical_progress_pct ?? 0}%.`,
              confidence: 0.80,
            });
          }
        }
        break;
      }
    }
  }

  return candidates;
}
