/**
 * Delay & Stall Detectors (R-006, R-007, R-015)
 */

import type { Work } from '../types.ts';
import type { AnomalyCandidate } from './cost_outlier.ts';
import { daysBetween, monthsBetween, nowIso } from '../util.ts';

export function detectDelays(works: Work[]): AnomalyCandidate[] {
  const candidates: AnomalyCandidate[] = [];
  const today = nowIso().slice(0, 10);

  for (const w of works) {
    // 1. R-006: Delayed beyond scheme timeline (24 months)
    if (w.sanction_date && ['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD'].includes(w.status)) {
      const months = monthsBetween(w.sanction_date, today);
      if (months > 24) {
        candidates.push({
          work_id: w.id,
          rule_id: 'R-006',
          origin_id: `delayed_${w.id}`,
          severity: 'HIGH',
          severity_rank: 2,
          reason_code: 'DELAYED_BEYOND_TIMELINE',
          evidence_text: `Work sanctioned on ${w.sanction_date}, now ${months} months elapsed (scheme limit: 24 months). Status: ${w.status}.`,
          confidence: Math.min(1.0, 0.6 + (months - 24) * 0.05),
        });
      }
    }

    // 2. R-007: Stalled — No progress/payment in 180 days
    if (['IN_PROGRESS', 'NOT_STARTED'].includes(w.status)) {
      const referenceDate = w.last_payment_date ?? w.sanction_date;
      if (referenceDate) {
        const days = daysBetween(referenceDate, today);
        if (days >= 180 && (w.physical_progress_pct ?? 0) < 100) {
          candidates.push({
            work_id: w.id,
            rule_id: 'R-007',
            origin_id: `stalled_${w.id}`,
            severity: 'HIGH',
            severity_rank: 2,
            reason_code: 'STALLED_NO_PROGRESS',
            evidence_text: `No payment or progress recorded in ${days} days (threshold: 180 days). Last activity date: ${referenceDate}. Progress: ${w.physical_progress_pct ?? 0}%.`,
            confidence: Math.min(1.0, 0.5 + (days / 365) * 0.5),
          });
        }
      }
    }

    // 3. R-015: Work on hold too long (>120 days)
    if (w.status === 'ON_HOLD') {
      const refDate = w.updated_at ? w.updated_at.slice(0, 10) : w.sanction_date;
      if (refDate) {
        const holdDays = daysBetween(refDate, today);
        if (holdDays >= 120) {
          candidates.push({
            work_id: w.id,
            rule_id: 'R-015',
            origin_id: `on_hold_${w.id}`,
            severity: 'MEDIUM',
            severity_rank: 3,
            reason_code: 'ON_HOLD_TOO_LONG',
            evidence_text: `Work has been on hold for ${holdDays} days (threshold: 120 days).`,
            confidence: Math.min(1.0, 0.5 + (holdDays / 200) * 0.5),
          });
        }
      }
    }
  }

  return candidates;
}
