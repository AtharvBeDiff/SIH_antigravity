/**
 * Photo Reuse Detector (R-010)
 *
 * Cross-work only (not self-comparison).
 * Compares evidence perceptual image keys / hashes using hexHamming distance <= 8.
 */

import type { Work } from '../types.ts';
import type { AnomalyCandidate } from './cost_outlier.ts';
import { hexHamming } from '../util.ts';

export function detectPhotoReuse(works: Work[]): AnomalyCandidate[] {
  const candidates: AnomalyCandidate[] = [];
  const worksWithPhotos = works.filter(w => w.evidence_image_key && w.evidence_image_key.length >= 16);
  const n = worksWithPhotos.length;

  for (let i = 0; i < n; i++) {
    const w1 = worksWithPhotos[i]!;
    for (let j = i + 1; j < n; j++) {
      const w2 = worksWithPhotos[j]!;

      // Cross-work only
      if (w1.id === w2.id) continue;

      const dist = hexHamming(w1.evidence_image_key!, w2.evidence_image_key!);
      if (dist <= 8) {
        candidates.push({
          work_id: w1.id,
          rule_id: 'R-010',
          origin_id: `photo_reuse_${w1.id}_${w2.id}`,
          severity: 'CRITICAL',
          severity_rank: 1,
          reason_code: 'PHOTO_REUSE_DETECTED',
          evidence_text: `Evidence photo matches photo from work "${w2.title}" (${w2.esakshi_work_id ?? w2.id}) with perceptual hash distance of ${dist} (threshold: 8).`,
          confidence: Math.max(0.7, 1.0 - (dist / 16)),
        });
      }
    }
  }

  return candidates;
}
