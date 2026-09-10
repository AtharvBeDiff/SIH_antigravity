/**
 * Inspection reconciliation — where the inspector's field evidence and the portal record disagree.
 *
 * The comparator half of P-10, the inspection counterpart of `photo_reconcile.ts` and
 * `document_reconcile.ts`. An inspector visits a site, records a GPS fix, a defect status and a
 * date, and (through the photo pipeline) leaves geotagged, timestamped photographs. This file
 * compares those field facts against the work as e-SAKSHI has it and returns **only the
 * disagreements**. An inspection consistent with the record produces an empty array.
 *
 * ## Not a model, and not a rule
 *
 * Every check below is a distance, an equality, or a date subtraction. No model is consulted:
 * the inspector and the camera produced the observations, and this file only compares them,
 * mechanically. `|inspector − work| = 84 km` can be recomputed by anyone reading the finding.
 *
 * `check_id` values are `I-0xx` — inspection evidence — deliberately distinct from the `R-0xx`
 * rule catalogue, the `D-0xx` document findings and the `V-0xx` photo findings. They produce no
 * `alerts` rows, do not enter the per-district alert budget, carry no `verification_status`, and
 * are never scored against `answer_key`. They are a worklist for a human, not a verdict.
 *
 * ## The record side is never attributed to an author
 *
 * A finding reports `record_value` and `record_source` — the value compared against and the
 * column it came from — but never *who* entered it. Nothing here says an agency, an officer or
 * an MP claimed anything: `works.status` has no author column, `uploaded_by` on a photo is an
 * unauthenticated header string, and inventing attribution would be worse than omitting it.
 * Doctrine 3 besides: the accountability unit is the work and its record, not a named person.
 *
 * ## A missing input skips its check — it never becomes a finding
 *
 * The discipline the whole feature rests on (Doctrine 6). If the inspector recorded no GPS,
 * I-001 and I-004 do not run — they do not measure a distance to a null and call it a mismatch.
 * If no photo carries a timestamp, I-003 does not run. Every check states its precondition and
 * pushes to `checks_run` only once that precondition is met, so "nothing could be checked" is
 * recorded as such and never rendered as "everything checked out". I-004 additionally refuses
 * the Delhi-centroid placeholder (`isDefaultedCoordinate`): a work whose coordinate was never
 * captured must not have every off-Delhi inspection read as a location mismatch.
 */

import type { Work, WorkPhoto } from '../types.ts';
import { haversineMeters, roundTo, isDefaultedCoordinate } from '../util.ts';
import type { FindingSeverity } from './photo_reconcile.ts';
import { GEO_TOLERANCE_METERS, GEO_FAR_METERS } from './photo_reconcile.ts';

/**
 * The checks, by id. `I-` for inspection evidence, distinct from the `R-`, `D-` and `V-`
 * catalogues. Each entry is the one-line statement of the disagreement it looks for, surfaced in
 * the UI so a finding can be explained without reading this file.
 */
export const CHECK_IDS = {
  'I-001': "Inspector's GPS location is far from the site's own photographs",
  'I-002': 'Inspector found defects or no work while the record marks the work complete',
  'I-003': 'Site photographs were captured well after the inspection date',
  'I-004': "Inspector's GPS location is far from the work's recorded coordinates",
} as const;

export type InspectionCheckId = keyof typeof CHECK_IDS;

/** The unit a finding's `deviation` is measured in. Metres never collide with days on one column. */
export type DeviationUnit = 'METRES' | 'DAYS';

export interface Finding {
  check_id: InspectionCheckId;
  severity: FindingSeverity;
  detail: string;
  /** What the inspector recorded or the photographs show. */
  observed_value: string | null;
  /** The value compared against on the record side. */
  record_value: string | null;
  /** The column the record value came from. Never a person — see the header. */
  record_source: string | null;
  /** The photo a photo-based check keyed on (I-001, I-003), for D7 traceability. Null otherwise. */
  photo_id: string | null;
  /** Magnitude of the gap, or null for checks where a number would be decoration (I-002). */
  deviation: number | null;
  /** The unit `deviation` is in, or null when `deviation` is null. */
  deviation_unit: DeviationUnit | null;
}

/**
 * The inspection as this comparator needs it — deliberately narrower than `types.ts`'s
 * `Inspection`. Only the three fields the checks read, and `overall_status` as a plain string:
 * the reconciler tests the status against its own vocabulary and must not be coupled to the
 * domain type's evolving union. `latitude`/`longitude` are `number | null` because an inspection
 * synced from a device that could not get a fix carries none.
 */
export interface InspectionRecord {
  latitude: number | null;
  longitude: number | null;
  inspection_date: string;
  overall_status: string;
}

/**
 * Inspector statuses that assert something is wrong on site. A work the record calls complete,
 * inspected into one of these, is the I-002 finding.
 *
 * `FAIL` and `PARTIAL` are the legacy `Inspection.overall_status` vocabulary; `DEFECTS_FOUND` and
 * `WORK_NOT_STARTED` are the field-app vocabulary (`CreateInspectionInput`). Both are honoured so
 * the check works regardless of which produced the row.
 */
const DEFECT_STATUSES = new Set(['DEFECTS_FOUND', 'WORK_NOT_STARTED', 'FAIL', 'PARTIAL']);

/**
 * Every status the check understands. I-002 runs only when the status is one of these: an
 * unrecognised value means the check cannot judge it, so it is skipped (not read as clean, and
 * not read as a defect). `SATISFACTORY`/`PASS`/`INACCESSIBLE` are known-and-not-a-defect.
 */
const KNOWN_STATUSES = new Set([...DEFECT_STATUSES, 'SATISFACTORY', 'INACCESSIBLE', 'PASS']);

/** Days beyond which photographs taken after an inspection stop being same-visit uploads. */
const PHOTO_LAG_DAYS = 31;

/**
 * Compare one inspection against one work and its photographs.
 *
 * Returns the disagreements, most severe first, and the ids of the checks that could run.
 * An empty `findings` with a non-empty `checks_run` means "checked, nothing wrong"; an empty
 * `checks_run` means nothing could be checked (no GPS, no photos, unknown status) — a measured
 * result the caller stores as `[]`, never conflates with clean.
 *
 * @param inspection The inspector's field record (narrow shape — see `InspectionRecord`).
 * @param work       The work as the portal has it.
 * @param photos     Every photo on the work, for the geotag and timestamp checks.
 */
export function reconcile(
  inspection: InspectionRecord,
  work: Work,
  photos: WorkPhoto[],
): { findings: Finding[]; checks_run: InspectionCheckId[] } {
  const findings: Finding[] = [];
  const run: InspectionCheckId[] = [];

  const inspectorHasGps = inspection.latitude != null && inspection.longitude != null;

  // ── I-001 · inspector GPS vs the site's own photographs ───────────────────
  //
  // The photo EXIF is the one location signal not poisoned by the Delhi-centroid ingest — it is
  // read from the image bytes, not the CSV. So the inspector's fix is compared against the
  // closest geotagged photo on the work, and the closest is kept for `photo_id` so the officer
  // can open the exact image. Runs only when the inspector recorded a fix AND at least one photo
  // carries a geotag.
  const geotagged = photos.filter((p) => p.exif_latitude != null && p.exif_longitude != null);
  if (inspectorHasGps && geotagged.length > 0) {
    run.push('I-001');
    let closest: WorkPhoto | null = null;
    let minMeters = Infinity;
    for (const p of geotagged) {
      const m = haversineMeters(
        inspection.latitude!,
        inspection.longitude!,
        p.exif_latitude!,
        p.exif_longitude!,
      );
      if (m < minMeters) {
        minMeters = m;
        closest = p;
      }
    }
    if (closest !== null && minMeters > GEO_TOLERANCE_METERS) {
      const far = minMeters > GEO_FAR_METERS;
      const distanceText =
        minMeters >= 1_000 ? `${roundTo(minMeters / 1_000, 1)} km` : `${Math.round(minMeters)} m`;
      findings.push({
        check_id: 'I-001',
        severity: far ? 'HIGH' : 'MEDIUM',
        detail:
          `The inspector's recorded GPS location is ${distanceText} from the nearest ` +
          `geotagged site photograph. ` +
          (far
            ? 'A single site does not span this distance — the inspection and the photographs ' +
              'may be of different places. '
            : 'This can be normal for a large or linear site, and consumer GPS drifts. ') +
          'Compare the two locations before drawing a conclusion.',
        observed_value: `${roundTo(inspection.latitude!, 5)}, ${roundTo(inspection.longitude!, 5)}`,
        record_value: `${roundTo(closest.exif_latitude!, 5)}, ${roundTo(closest.exif_longitude!, 5)}`,
        record_source: 'work_photos.exif_latitude/exif_longitude',
        photo_id: closest.id,
        deviation: roundTo(minMeters, 0),
        deviation_unit: 'METRES',
      });
    }
  }

  // ── I-002 · inspector's defect status vs a completion claim ───────────────
  //
  // The money-leak check. Runs only when the status is one the check understands AND the record
  // claims the work is complete — completion is what a payment is released against. An inspector
  // who found defects, or no work at all, on a work marked complete is the finding. A benign
  // status (satisfactory, inaccessible) runs the check and produces nothing; an unknown status
  // skips it.
  const claimsComplete = work.status === 'COMPLETED' || work.physical_progress_pct >= 100;
  if (KNOWN_STATUSES.has(inspection.overall_status) && claimsComplete) {
    run.push('I-002');
    if (DEFECT_STATUSES.has(inspection.overall_status)) {
      // "No work started" and an outright fail are the sharper end; found-defects/partial is a
      // step below. Neither is CRITICAL — an inspection is one observer on one day, and the gap
      // may be a reporting lag rather than misconduct.
      const severe =
        inspection.overall_status === 'WORK_NOT_STARTED' || inspection.overall_status === 'FAIL';
      const portalClaim =
        work.status === 'COMPLETED' ? 'status "COMPLETED"' : `${work.physical_progress_pct}% physical progress`;
      findings.push({
        check_id: 'I-002',
        severity: severe ? 'HIGH' : 'MEDIUM',
        detail:
          `The work is recorded as complete (${portalClaim}) but the inspector recorded a ` +
          `status of "${inspection.overall_status}". Payment is released against completion — ` +
          'a site an inspector found unfinished or defective is worth verifying before the ' +
          'record is relied on.',
        observed_value: inspection.overall_status,
        record_value: work.status === 'COMPLETED' ? 'COMPLETED' : `${work.physical_progress_pct}% complete`,
        record_source: work.status === 'COMPLETED' ? 'works.status' : 'works.physical_progress_pct',
        photo_id: null,
        deviation: null,
        deviation_unit: null,
      });
    }
  }

  // ── I-003 · photograph capture time vs the inspection date ────────────────
  //
  // A photograph legitimately trails its inspection by a day or two — uploaded that evening, or
  // the next morning. A month later is a different visit, a stock image, or a backdated record.
  // Always MEDIUM: a late upload is a provenance question, not proof of anything.
  //
  // Both sides are parsed *before* the push. Having a photo with an `exif_taken_at` string is not
  // the precondition — having two dates that actually parse is. An unparseable
  // `inspection.inspection_date` (or a null one, where the template literal yields
  // `'nullT00:00:00Z'`), or timestamped photos whose every EXIF string is junk, leaves nothing to
  // subtract. Pushing first and discovering that second would record `checks_run: ['I-003']`
  // against a comparison that measured nothing, and the panel would render that as "no
  // disagreement across the 1 check that ran" — a clean bill of health from a check that never
  // ran. That is the exact failure this column exists to make impossible, so the push waits.
  const timestamped = photos.filter((p) => p.exif_taken_at != null);
  if (timestamped.length > 0) {
    const inspectionMs = Date.parse(`${inspection.inspection_date}T00:00:00Z`);
    let latestMs = -Infinity;
    let latestPhoto: WorkPhoto | null = null;
    for (const p of timestamped) {
      const t = Date.parse(p.exif_taken_at!);
      if (!Number.isNaN(t) && t > latestMs) {
        latestMs = t;
        latestPhoto = p;
      }
    }
    if (!Number.isNaN(inspectionMs) && latestMs !== -Infinity) {
      run.push('I-003');
      const days = (latestMs - inspectionMs) / 86_400_000;
      if (days > PHOTO_LAG_DAYS) {
        findings.push({
          check_id: 'I-003',
          severity: 'MEDIUM',
          detail:
            `The most recent site photograph was captured about ${roundTo(days, 0)} days ` +
            'after the inspection date. Photographs are expected around the time of the ' +
            'visit — a long gap is worth confirming, as it can indicate a later upload, a ' +
            'stock image, or a backdated inspection record.',
          // `observed_value` is what the inspector recorded and `record_value` is what the
          // platform holds — the contract stated in migration 017's column comments. This check
          // read those two backwards until the review caught it: it put the photograph's EXIF
          // date in `observed_value` and `inspections.inspection_date` in `record_value`, so the
          // panel's "Work record:" heading sat directly above the text
          // `inspections.inspection_date`, and the two values were labelled with each other's
          // provenance on every I-003 finding. The inspector recorded the visit date; the
          // platform holds the photograph's timestamp.
          observed_value: inspection.inspection_date,
          record_value: new Date(latestMs).toISOString().slice(0, 10),
          record_source: 'work_photos.exif_taken_at',
          // The photograph whose timestamp produced the gap, so the officer can open the image
          // the measurement was taken from rather than guess which of a dozen is the late one.
          // I-001 keys on a photo for the same reason; the claim in earlier comments that only
          // I-001 does was wrong — I-003 reads a fact out of an image file just as directly.
          photo_id: latestPhoto?.id ?? null,
          deviation: roundTo(days, 0),
          deviation_unit: 'DAYS',
        });
      }
    }
  }

  // ── I-004 · inspector GPS vs the work's recorded coordinates ──────────────
  //
  // The same trigonometry as I-001, against the portal coordinate rather than the photos. Skipped
  // — not merely non-firing — when the inspector recorded no fix, when the work has no recorded
  // coordinate, OR when that coordinate is the Delhi-centroid placeholder: a work whose location
  // was never captured must not have every off-Delhi inspection read as an 800-km mismatch.
  if (
    inspectorHasGps &&
    work.latitude != null &&
    work.longitude != null &&
    !isDefaultedCoordinate(work.latitude, work.longitude)
  ) {
    run.push('I-004');
    const meters = haversineMeters(
      inspection.latitude!,
      inspection.longitude!,
      work.latitude,
      work.longitude,
    );
    if (meters > GEO_TOLERANCE_METERS) {
      const far = meters > GEO_FAR_METERS;
      const distanceText =
        meters >= 1_000 ? `${roundTo(meters / 1_000, 1)} km` : `${Math.round(meters)} m`;
      findings.push({
        check_id: 'I-004',
        severity: far ? 'HIGH' : 'MEDIUM',
        detail:
          `The inspector's recorded GPS location is ${distanceText} from the work's recorded ` +
          `coordinates. ` +
          (far
            ? 'A single work does not span this distance — the inspection may be of a different ' +
              'site, or the recorded coordinates may be wrong. '
            : 'This can be normal for a large site or a linear work such as a road, and the ' +
              'recorded coordinates may themselves be approximate. ') +
          'Compare the two locations before drawing a conclusion.',
        observed_value: `${roundTo(inspection.latitude!, 5)}, ${roundTo(inspection.longitude!, 5)}`,
        record_value: `${roundTo(work.latitude, 5)}, ${roundTo(work.longitude, 5)}`,
        record_source: 'works.latitude/longitude',
        photo_id: null,
        deviation: roundTo(meters, 0),
        deviation_unit: 'METRES',
      });
    }
  }

  const order: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, checks_run: run };
}
