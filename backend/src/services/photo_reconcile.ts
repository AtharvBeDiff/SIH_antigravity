/**
 * Photo reconciliation — where the site photograph and the portal record disagree.
 *
 * The second half of P-06, and the half that produces the finding. `photo_ai.ts` reports
 * what a model saw in one image; this file compares that reading — plus the deterministic
 * EXIF geotag — against the work as e-SAKSHI has it, and returns **only the disagreements**.
 * A photo consistent with the record produces an empty array, which is the intended common
 * case: the officer's queue should hold the handful of photos worth a second look, not every
 * photo on file.
 *
 * ## Not a model, and not a rule either
 *
 * Every comparison below is a distance calculation, an equality, or an ordinal test on the
 * model's coarse stage label. No model is consulted here — the model's work happened in
 * `photo_ai.ts` and produced observations; this file only compares those observations,
 * mechanically, against the record. `|photo − work| = 84 km` can be recomputed by anyone
 * reading the finding.
 *
 * The geotag check (V-001) uses no model at all — it is pure trigonometry on two coordinates
 * and is Tier 3. The three visual checks (V-002/003/004) compare the model's blind reading
 * against the record. That split is why the capability report labels the feature Tier 1 for
 * the vision and calls the geotag deterministic separately.
 *
 * They are **not** catalogued rules. `check_id` values are `V-0xx` — visual evidence —
 * deliberately distinct from both the `R-0xx` rule catalogue and the `D-0xx` document
 * findings: these produce no `alerts` rows, do not enter the per-district alert budget, carry
 * no `verification_status`, and are never scored against `answer_key`.
 *
 * ## A null observation skips its check — it never becomes a finding
 *
 * The discipline the whole feature rests on. If the model could not classify the asset,
 * V-002 does not run; it does not compare null against `works.category` and report a
 * mismatch. Every check states its precondition and returns nothing when it is unmet, so an
 * unreadable photo produces zero findings rather than a page of fabricated ones — and
 * `checks_run` records which checks were even applicable, so "nothing was checked" is never
 * shown as "everything checked out".
 *
 * ## The asymmetry in V-003 is deliberate
 *
 * V-003 fires when a work marked complete is photographed looking unfinished — the direction
 * that precedes a released payment. The reverse (a work marked incomplete that looks
 * finished) is a benign reporting lag, not a money-leak signal, and is intentionally not a
 * finding.
 */

import type { Work } from '../types.ts';
import { haversineMeters, roundTo, isDefaultedCoordinate } from '../util.ts';
import type { ConstructionStage, PhotoObservations } from './photo_ai.ts';

/**
 * The checks, by id. `V-` for visual evidence, distinct from the `R-` and `D-` catalogues.
 *
 * Each entry is the one-line statement of what disagreement it looks for, used in the UI so a
 * finding can be explained without reading this file.
 */
export const CHECK_IDS = {
  'V-001': "Photo's GPS location is far from the work's recorded coordinates",
  'V-002': 'Photo appears to show a different kind of asset than the work records',
  'V-003': 'Photo shows the work unfinished while the record marks it complete',
  'V-004': 'Photo shows visual signs that warrant a human authenticity review',
} as const;

export type PhotoCheckId = keyof typeof CHECK_IDS;

/**
 * Geotag agreement band, in metres.
 *
 * 1 km. A site is not a point: the recorded coordinate is one spot, the photographer stands
 * somewhere on the site, consumer GPS drifts tens of metres, and many works (a road, a canal)
 * legitimately extend well beyond their recorded point. Below this the photo is at the work.
 * Above it, the gap is worth a note — with the caveats the finding spells out.
 */
export const GEO_TOLERANCE_METERS = 1_000;

/**
 * Distance beyond which a location gap stops being explicable by site extent or GPS error.
 *
 * 50 km. A single work does not span districts. A photo this far from the record is almost
 * certainly the wrong photo, a reused photo, or — just as likely — a work whose coordinates
 * were never captured and defaulted to a placeholder (see the readiness checklist: absent
 * coordinates currently default to a Delhi centroid). Either way it is worth a hard look,
 * hence HIGH — but never CRITICAL, because the placeholder-coordinate case is a data gap, not
 * misconduct, and the two are indistinguishable from here.
 */
export const GEO_FAR_METERS = 50_000;

/** Severity vocabulary, matching `alerts` so the officer reads one scale. */
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Finding {
  check_id: PhotoCheckId;
  severity: FindingSeverity;
  detail: string;
  /** What the photo or the model shows. */
  observed_value: string | null;
  /** What the portal record claims. Null for checks intrinsic to the image (V-004). */
  portal_value: string | null;
  /** Metres, for the geotag check. Null for the categorical checks, where a number is decoration. */
  deviation: number | null;
}

/** A stage that is anything short of finished. */
const INCOMPLETE_STAGES: readonly ConstructionStage[] = ['NOT_STARTED', 'FOUNDATION', 'IN_PROGRESS'];

/** Human-readable form of a category/stage token for a finding sentence. */
function readable(token: string): string {
  return token.replace(/_/g, ' ').toLowerCase();
}

/** A coordinate pair as read from EXIF; both values present or the whole thing is null. */
export interface PhotoGps {
  latitude: number;
  longitude: number;
}

/**
 * Compare one photo's reading against one work.
 *
 * Returns the disagreements, most severe first. An empty array means the photo and the record
 * agree on everything that could be checked — which is different from "nothing was checked",
 * and the caller reports `checks_run` alongside so the two are distinguishable. A photo with
 * no geotag and an unreadable image yields zero findings *and* zero checks run; presenting
 * that as a clean result would be the most misleading thing this feature could do.
 *
 * @param work         The work as the portal has it.
 * @param observations The model's blind reading (from `photo_ai.ts`).
 * @param gps          The photo's EXIF coordinate, or null if it carried no geotag.
 */
export function reconcile(
  work: Work,
  observations: PhotoObservations,
  gps: PhotoGps | null,
): { findings: Finding[]; checks_run: PhotoCheckId[] } {
  const findings: Finding[] = [];
  const run: PhotoCheckId[] = [];

  // ── V-001 · photo GPS vs recorded work coordinates ────────────────────────
  //
  // Deterministic: trigonometry on two coordinate pairs, no model. Runs only when the photo
  // carries a geotag AND the work has recorded coordinates — a null on either side skips the
  // check rather than measuring a distance to a placeholder.
  //
  // The placeholder guard matters here specifically: a work whose coordinate was never captured
  // sits at the Delhi centroid, and a photo taken anywhere else would then read as a large,
  // spurious gap "to the work" — a fabricated finding measuring a distance to a data gap. Skip
  // the check when the recorded coordinate is that placeholder, rather than reporting the gap.
  if (
    gps !== null &&
    work.latitude != null &&
    work.longitude != null &&
    !isDefaultedCoordinate(work.latitude, work.longitude)
  ) {
    run.push('V-001');
    const meters = haversineMeters(gps.latitude, gps.longitude, work.latitude, work.longitude);
    if (meters > GEO_TOLERANCE_METERS) {
      const far = meters > GEO_FAR_METERS;
      const distanceText =
        meters >= 1_000 ? `${roundTo(meters / 1_000, 1)} km` : `${Math.round(meters)} m`;
      findings.push({
        check_id: 'V-001',
        // Beyond ~50 km the gap cannot be site extent or GPS drift; below it, it can be.
        severity: far ? 'HIGH' : 'MEDIUM',
        detail:
          `The photo's GPS location is ${distanceText} from the work's recorded ` +
          `coordinates. ` +
          (far
            ? 'A single work does not span this distance — this is likely the wrong or a ' +
              'reused photo. '
            : 'This can be normal for a large site or a linear work such as a road, and the ' +
              "recorded coordinates may themselves be approximate. ") +
          'Compare the two locations before drawing a conclusion.',
        observed_value: `${roundTo(gps.latitude, 5)}, ${roundTo(gps.longitude, 5)}`,
        portal_value: `${roundTo(work.latitude, 5)}, ${roundTo(work.longitude, 5)}`,
        deviation: roundTo(meters, 0),
      });
    }
  }

  // ── V-002 · asset category the photo shows vs the work's category ─────────
  //
  // The model classified the asset blind, never told what the work claims. A confident
  // mismatch means either the wrong photo is attached or the work is miscategorised — both
  // worth confirming. Categories can visually overlap (a hall reads as community
  // infrastructure or as education), so this is a prompt, not an accusation: MEDIUM, and easy
  // to dismiss. A null category (the model could not tell) skips the check entirely.
  if (observations.asset_category !== null) {
    run.push('V-002');
    if (observations.asset_category !== work.category) {
      findings.push({
        check_id: 'V-002',
        severity: 'MEDIUM',
        detail:
          `The photo appears to show a ${readable(observations.asset_category)} asset, ` +
          `while this work is recorded under ${readable(work.category)}. Confirm the right ` +
          'photo is attached to the right work; categories can also legitimately overlap.',
        observed_value: observations.asset_category,
        portal_value: work.category,
        deviation: null,
      });
    }
  }

  // ── V-003 · construction stage vs a completion claim ──────────────────────
  //
  // The money-leak check. Runs only when the model could judge the stage AND the record
  // claims the work is complete — completion is what a payment is released against. A photo of
  // an unfinished site on a work marked complete is the finding. The reverse direction is a
  // benign reporting lag and is deliberately not checked (see the header).
  const claimsComplete = work.status === 'COMPLETED' || work.physical_progress_pct >= 100;
  if (observations.construction_stage !== null && claimsComplete) {
    run.push('V-003');
    if (INCOMPLETE_STAGES.includes(observations.construction_stage)) {
      // The further from finished, the more serious. Foundation-or-less on a "completed"
      // work is the shape of a payment released against work not done.
      const early =
        observations.construction_stage === 'NOT_STARTED' ||
        observations.construction_stage === 'FOUNDATION';
      const portalClaim =
        work.status === 'COMPLETED'
          ? `status "COMPLETED"`
          : `${work.physical_progress_pct}% physical progress`;
      findings.push({
        check_id: 'V-003',
        severity: early ? 'HIGH' : 'MEDIUM',
        detail:
          `The work is recorded as complete (${portalClaim}) but the photo shows ` +
          `construction at the ${readable(observations.construction_stage)} stage. Payment ` +
          'is released against completion — a site that looks unfinished here is worth ' +
          'verifying before the record is relied on.',
        observed_value: observations.construction_stage,
        portal_value:
          work.status === 'COMPLETED'
            ? 'COMPLETED'
            : `${work.physical_progress_pct}% complete`,
        deviation: null,
      });
    }
  }

  // ── V-004 · image authenticity concern ───────────────────────────────────
  //
  // Intrinsic to the image, like D-008 is intrinsic to a document — there is nothing on the
  // portal to compare against. The model flagged whether the image warrants a human
  // authenticity review; it did NOT determine forgery, and this finding does not either. It
  // routes attention. Capped at MEDIUM (LIKELY) / LOW (POSSIBLE): a model's concern is not
  // evidence of tampering, and dressing it as HIGH would put an unearned accusation on a
  // dossier. A null concern (the model could not assess it) skips the check.
  if (observations.integrity_concern !== null) {
    run.push('V-004');
    if (observations.integrity_concern === 'POSSIBLE' || observations.integrity_concern === 'LIKELY') {
      const likely = observations.integrity_concern === 'LIKELY';
      findings.push({
        check_id: 'V-004',
        severity: likely ? 'MEDIUM' : 'LOW',
        detail:
          `The model flagged a ${likely ? 'likely' : 'possible'} reason to review this ` +
          'image for authenticity' +
          (observations.integrity_note ? `: ${observations.integrity_note}` : '') +
          '. This is a prompt for a human to look, not a determination that the image is ' +
          'altered — the platform does not decide whether an image is genuine.',
        observed_value: observations.integrity_concern,
        portal_value: null,
        deviation: null,
      });
    }
  }

  const order: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, checks_run: run };
}
