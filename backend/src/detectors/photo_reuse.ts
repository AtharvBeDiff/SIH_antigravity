/**
 * Photo Reuse Detector (R-010) — implemented, and dormant.
 *
 * Compares `works.evidence_image_key` pairwise across works, cross-work only, and
 * reports pairs within a Hamming distance of 8.
 *
 * **Nothing writes `works.evidence_image_key.`** Not `routers/ingest.ts` (there is no
 * such CSV column), not the generator, not the field-inspection upload — the evidence
 * bucket exists in the schema and nothing puts an object in it. So `worksWithPhotos`
 * is empty on every run and this detector has never produced an alert.
 *
 * That is recorded in three places on purpose, because a dormant CRITICAL anti-fraud
 * rule is worse than an absent one — its silence reads as a finding:
 *
 *   - `rules/mplads_rules.yaml` carries `dormant_reason` on R-010, so `/rules` shows
 *     the rule as unable to fire rather than as an active check that found nothing;
 *   - `services/readiness.ts` lists Photo Hash Key as `NOT_INGESTED`;
 *   - this header, and the guard below.
 *
 * What is missing is a data path, not logic. The comparison is correct and starts
 * working unchanged the moment a perceptual hash is computed at upload time and
 * persisted. Two things it must be, when that day comes:
 *
 *   1. **A perceptual hash, not a storage key.** The column name says "key", and a
 *      storage path (`evidence/work-123/photo.jpg`) compared by Hamming distance
 *      would produce matches on shared path prefixes — every work in a district
 *      would "reuse" every other's photo. The detector rejects non-hex input below
 *      rather than scoring it.
 *   2. **Fixed-width.** `hexHamming` throws on a length mismatch, which in a pairwise
 *      loop would abort the whole analysis run rather than skip a pair.
 */

import type { Work } from '../types.ts';
import type { AnomalyCandidate } from './cost_outlier.ts';
import { hexHamming } from '../util.ts';

/** Perceptual-hash comparison threshold. Below this, two images are the same photo. */
const HAMMING_THRESHOLD = 8;

/** Minimum hash width worth comparing, in hex characters (64 bits). */
const MIN_HASH_LENGTH = 16;

/** A hex string of even length — what a perceptual hash looks like. */
const HEX_HASH = /^[0-9a-f]+$/i;

/**
 * True when `key` is usable as a perceptual hash.
 *
 * The previous filter was `key.length >= 16`, which a storage path also satisfies.
 * Once anything begins writing this column, a path written where a hash was expected
 * would not fail — it would produce CRITICAL fraud alerts for every pair of works
 * whose paths share a prefix. Cheap to reject now, expensive to notice later.
 */
function isPerceptualHash(key: string): boolean {
  return key.length >= MIN_HASH_LENGTH && HEX_HASH.test(key);
}

export interface PhotoReuseResult {
  candidates: AnomalyCandidate[];
  /** Works carrying something usable as a perceptual hash. */
  comparable_works: number;
  /**
   * Works whose `evidence_image_key` was set but not a hash — a storage path, or a
   * synthesised placeholder. Non-zero means something is writing the wrong kind of
   * value to the column, which is a bug in that writer, not an absence of data.
   */
  unusable_keys: number;
}

/**
 * Run R-010 and report what it had to work with.
 *
 * The counts are the point of the return shape. A bare `AnomalyCandidate[]` cannot
 * distinguish "compared 400 works, found no reuse" from "had nothing to compare",
 * and those two mean opposite things about the corpus.
 */
export function analyzePhotoReuse(works: Work[]): PhotoReuseResult {
  const candidates: AnomalyCandidate[] = [];

  const keyed = works.filter((w): w is Work & { evidence_image_key: string } =>
    Boolean(w.evidence_image_key),
  );
  const comparable = keyed.filter((w) => isPerceptualHash(w.evidence_image_key));
  const unusable = keyed.length - comparable.length;

  for (let i = 0; i < comparable.length; i++) {
    const w1 = comparable[i]!;
    for (let j = i + 1; j < comparable.length; j++) {
      const w2 = comparable[j]!;
      if (w1.id === w2.id) continue;

      // Two hashes of different widths are not comparable, and `hexHamming` throws
      // on the mismatch. Skipped rather than propagated: an exception here would
      // abort `runAnalyze` for every rule, so one malformed row would take down the
      // whole pipeline.
      if (w1.evidence_image_key.length !== w2.evidence_image_key.length) continue;

      const dist = hexHamming(w1.evidence_image_key, w2.evidence_image_key);
      if (dist <= HAMMING_THRESHOLD) {
        candidates.push({
          work_id: w1.id,
          rule_id: 'R-010',
          origin_id: `photo_reuse_${w1.id}_${w2.id}`,
          severity: 'CRITICAL',
          severity_rank: 1,
          reason_code: 'PHOTO_REUSE_DETECTED',
          evidence_text: `Evidence photo matches photo from work "${w2.title}" (${w2.esakshi_work_id ?? w2.id}) with perceptual hash distance of ${dist} (threshold: ${HAMMING_THRESHOLD}).`,
          confidence: Math.max(0.7, 1.0 - dist / 16),
        });
      }
    }
  }

  return { candidates, comparable_works: comparable.length, unusable_keys: unusable };
}

/**
 * R-010's candidates alone, for callers that only need the alerts.
 *
 * Kept so `services/alerts.ts` reads the same as the other detectors. Anything
 * deciding whether the *absence* of candidates means anything must use
 * {@link analyzePhotoReuse} instead — an empty array from this function is
 * indistinguishable from a corpus with no photos at all, which is in fact every
 * corpus today.
 */
export function detectPhotoReuse(works: Work[]): AnomalyCandidate[] {
  return analyzePhotoReuse(works).candidates;
}
