/**
 * Duplicate Work Detector (R-009)
 *
 * 2-of-3 corroboration required:
 *   1. Text similarity (tokenSetRatio >= 0.75)
 *   2. Geo proximity (haversineMeters <= 500m)
 *   3. Amount match (relative diff <= 15%)
 */

import type { Work } from '../types.ts';
import type { AnomalyCandidate } from './cost_outlier.ts';
import { tokenSetRatio, haversineMeters, fmtINR } from '../util.ts';

export function detectDuplicates(works: Work[]): AnomalyCandidate[] {
  const candidates: AnomalyCandidate[] = [];
  const n = works.length;

  for (let i = 0; i < n; i++) {
    const w1 = works[i]!;
    for (let j = i + 1; j < n; j++) {
      const w2 = works[j]!;

      // Compare only works within same district
      if (w1.district_id !== w2.district_id) continue;

      let matchCount = 0;
      const matchDetails: string[] = [];

      // 1. Text similarity
      const textSim = tokenSetRatio(w1.title, w2.title);
      if (textSim >= 0.75) {
        matchCount++;
        matchDetails.push(`Title similarity ${(textSim * 100).toFixed(0)}%`);
      }

      // 2. Geo proximity
      if (
        w1.latitude !== null && w1.latitude !== undefined &&
        w1.longitude !== null && w1.longitude !== undefined &&
        w2.latitude !== null && w2.latitude !== undefined &&
        w2.longitude !== null && w2.longitude !== undefined
      ) {
        const dist = haversineMeters(w1.latitude, w1.longitude, w2.latitude, w2.longitude);
        if (dist <= 500) {
          matchCount++;
          matchDetails.push(`Locations ${dist.toFixed(0)}m apart`);
        }
      }

      // 3. Amount similarity
      if (
        typeof w1.sanctioned_amount === 'number' && w1.sanctioned_amount > 0 &&
        typeof w2.sanctioned_amount === 'number' && w2.sanctioned_amount > 0
      ) {
        const maxAmt = Math.max(w1.sanctioned_amount, w2.sanctioned_amount);
        const diffAmt = Math.abs(w1.sanctioned_amount - w2.sanctioned_amount);
        const diffPct = diffAmt / maxAmt;
        if (diffPct <= 0.15) {
          matchCount++;
          matchDetails.push(`Amounts within ${(diffPct * 100).toFixed(0)}% (${fmtINR(w1.sanctioned_amount)} vs ${fmtINR(w2.sanctioned_amount)})`);
        }
      }

      // Flag if at least 2 of 3 corroborations matched
      if (matchCount >= 2) {
        candidates.push({
          work_id: w1.id,
          rule_id: 'R-009',
          origin_id: `duplicate_${w1.id}_${w2.id}`,
          severity: 'CRITICAL',
          severity_rank: 1,
          reason_code: 'POTENTIAL_DUPLICATE_WORK',
          evidence_text: `Potential duplicate of work "${w2.title}" (${w2.esakshi_work_id ?? w2.id}). Matches (${matchCount}/3): ${matchDetails.join(', ')}.`,
          confidence: matchCount === 3 ? 0.95 : 0.80,
        });
      }
    }
  }

  return candidates;
}
