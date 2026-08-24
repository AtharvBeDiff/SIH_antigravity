/**
 * Cost Outlier Detector (R-001)
 *
 * Uses robust MAD z-score (not IsolationForest).
 * Flags works whose sanctioned amount significantly exceeds the district median
 * for that category.
 */

import type { Work } from '../types.ts';
import type { CategoryBenchmark } from '../services/benchmarks.ts';
import { robustZ, fmtINR } from '../util.ts';

export interface AnomalyCandidate {
  work_id: string;
  rule_id: string;
  origin_id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  severity_rank: number;
  reason_code: string;
  evidence_text: string;
  confidence: number;
}

export function detectCostOutliers(
  works: Work[],
  benchmarks: Map<string, CategoryBenchmark>,
): AnomalyCandidate[] {
  const candidates: AnomalyCandidate[] = [];

  for (const w of works) {
    if (!w.district_id || !w.category || typeof w.sanctioned_amount !== 'number') {
      continue; // doctrine #6: null-field rule
    }

    const key = `${w.district_id}::${w.category}`;
    const b = benchmarks.get(key);
    if (!b || b.count < 5) continue; // need at least 5 works for statistical validity

    const z = robustZ(w.sanctioned_amount, b.median_amount, b.mad_amount);
    if (z >= 3.0 && b.median_amount > 0) {
      const ratio = (w.sanctioned_amount / b.median_amount).toFixed(1);
      candidates.push({
        work_id: w.id,
        rule_id: 'R-001',
        origin_id: `cost_outlier_${w.id}`,
        severity: 'HIGH',
        severity_rank: 2,
        reason_code: 'COST_OUTLIER',
        evidence_text: `Sanctioned amount ${fmtINR(w.sanctioned_amount)} is ${ratio}× the district median of ${fmtINR(b.median_amount)} for ${w.category} works (MAD z-score: ${z.toFixed(2)}).`,
        confidence: Math.min(1.0, 0.5 + (z / 10)),
      });
    }
  }

  return candidates;
}
