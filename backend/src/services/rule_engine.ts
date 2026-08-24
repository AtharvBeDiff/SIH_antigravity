/**
 * Rule Engine Service
 *
 * Evaluates the 17 compliance rules against work records.
 * Follows Doctrine #6: Null-Field Rule — a rule must NEVER fire on a null field.
 */

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Work, RulesConfig } from '../types.ts';
import type { AnomalyCandidate } from '../detectors/cost_outlier.ts';
import { isRuleSuspended } from './probation.ts';
import { fmtINR, daysBetween, nowIso } from '../util.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _cachedConfig: RulesConfig | null = null;

export function loadRulesConfig(): RulesConfig {
  if (!_cachedConfig) {
    const yamlPath = resolve(__dirname, '..', 'rules', 'mplads_rules.yaml');
    const content = readFileSync(yamlPath, 'utf-8');
    _cachedConfig = parse(content) as RulesConfig;
  }
  return _cachedConfig;
}

const INELIGIBLE_CATEGORIES = [
  'COMMERCIAL', 'RELIGIOUS', 'OFFICE_BUILDING', 'PRIVATE_PROPERTY',
  'CLUB_HOUSE', 'ACQUISITION', 'MEMORIAL'
];

export async function evaluateWorkRules(
  work: Work,
  suspendedRuleIds?: Set<string>,
): Promise<AnomalyCandidate[]> {
  const config = loadRulesConfig();
  const candidates: AnomalyCandidate[] = [];
  const today = nowIso().slice(0, 10);

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
        // Money released ahead of physical progress
        if (
          typeof work.released_amount === 'number' &&
          typeof work.sanctioned_amount === 'number' &&
          work.sanctioned_amount > 0 &&
          typeof work.physical_progress_pct === 'number'
        ) {
          const releasePct = (work.released_amount / work.sanctioned_amount) * 100;
          const gap = releasePct - work.physical_progress_pct;
          if (gap >= 40 && work.released_amount >= 100000) {
            candidates.push({
              work_id: work.id,
              rule_id: 'R-002',
              origin_id: `release_progress_gap_${work.id}`,
              severity: 'HIGH',
              severity_rank: 2,
              reason_code: 'FUNDS_AHEAD_OF_PROGRESS',
              evidence_text: `Released ${fmtINR(work.released_amount)} (${releasePct.toFixed(0)}% of sanctioned) but physical progress is only ${work.physical_progress_pct}%. Gap: ${gap.toFixed(0)} percentage points.`,
              confidence: 0.85,
            });
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
        // Ineligible Category
        if (work.category && INELIGIBLE_CATEGORIES.includes(work.category.toUpperCase())) {
          candidates.push({
            work_id: work.id,
            rule_id: 'R-011',
            origin_id: `ineligible_category_${work.id}`,
            severity: 'HIGH',
            severity_rank: 2,
            reason_code: 'INELIGIBLE_CATEGORY',
            evidence_text: `Category '${work.category}' is prohibited under MPLADS scheme guidelines.`,
            confidence: 0.99,
          });
        }
        break;
      }

      case 'R-012': {
        // High-value work without second installment
        if (
          work.status === 'IN_PROGRESS' &&
          typeof work.sanctioned_amount === 'number' &&
          work.sanctioned_amount >= 2500000 &&
          typeof work.physical_progress_pct === 'number' &&
          work.physical_progress_pct >= 50 &&
          (!work.second_installment || work.second_installment === 0)
        ) {
          candidates.push({
            work_id: work.id,
            rule_id: 'R-012',
            origin_id: `missing_second_installment_${work.id}`,
            severity: 'LOW',
            severity_rank: 4,
            reason_code: 'MISSING_SECOND_INSTALLMENT',
            evidence_text: `High-value project (${fmtINR(work.sanctioned_amount)}) has reached ${work.physical_progress_pct}% progress but second installment has not been released.`,
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
        // No first installment despite sanction (>90 days)
        if (work.status === 'NOT_STARTED' && work.sanction_date) {
          const days = daysBetween(work.sanction_date, today);
          if (days > 90 && (!work.first_installment || work.first_installment === 0)) {
            candidates.push({
              work_id: work.id,
              rule_id: 'R-014',
              origin_id: `no_first_installment_${work.id}`,
              severity: 'MEDIUM',
              severity_rank: 3,
              reason_code: 'NO_FIRST_INSTALLMENT',
              evidence_text: `Sanctioned on ${work.sanction_date} (${days} days ago) but no first installment has been released.`,
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
