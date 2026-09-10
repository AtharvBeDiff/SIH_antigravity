/**
 * Inspection comparison — orchestration for P-10.
 *
 * The counterpart of `photos.ts` and `documents.ts` for inspection evidence.
 * `inspection_reconcile.ts` holds the comparison logic (pure, no database); this file connects
 * it to the tables, the audit ledger and the review workflow.
 *
 * ## Nothing is uploaded and no model is called
 *
 * Unlike its two siblings there is no file and no credential. Everything compared here is
 * already on record: the inspector's row in `inspections`, the work's row in `works`, and the
 * EXIF facts parsed from photographs at upload. That makes a comparison cheap, repeatable, and
 * available whether or not a model API key is configured — `capability()` reports
 * `available: true` unconditionally, which is true for exactly that reason.
 *
 * ## A superseded comparison is kept
 *
 * Re-comparing an inspection inserts a new comparison row and stamps `superseded_at` on the
 * previous one. The old comparison is the evidence for what an officer saw when they accepted
 * or dismissed a finding; overwriting it would make their decision unexplainable. Findings hang
 * off the comparison that produced them. Migration 017's partial unique index enforces one
 * current comparison per inspection, so the supersede must happen *before* the insert.
 *
 * ## No write-back to `works`, and no alerts
 *
 * Accepting an I-finding records the officer's disposition and nothing more. No work row
 * changes, no `alerts` row is minted, no district alert budget is touched, and nothing here is
 * scored against `answer_key`. An inspector's disagreement with the record is a prompt for a
 * human to look, not a platform verdict about a work — the same discipline as D-0xx and V-0xx.
 */

import { ApiError } from '../http.ts';
import { all, get, insert, update } from '../db.ts';
import { newId, nowIso } from '../util.ts';
import { appendAudit } from './audit_chain.ts';
import type { Inspection, Work, WorkPhoto } from '../types.ts';
import {
  reconcile,
  CHECK_IDS,
  type InspectionCheckId,
  type InspectionRecord,
} from './inspection_reconcile.ts';

/** A comparison row as stored. Mirrors migration 017's `inspection_comparisons`. */
export interface InspectionComparison {
  id: string;
  inspection_id: string;
  work_id: string;
  /**
   * The photo corpus the comparison had to work with. Three counts rather than one, because
   * "no photos" and "photos with no geotag" fail different checks and an officer reading a
   * clean result deserves to know which. Never inferred from `checks_run`.
   */
  photos_on_record: number;
  photos_with_geotag: number;
  photos_with_timestamp: number;
  /**
   * The I-checks that were able to run. `[]` is a measured result — nothing could be compared.
   * `null` means nothing was recorded, never that nothing ran: `compareInspection` always writes
   * this, so a NULL is a row that came from somewhere else — a backfill, a data repair. Narrow
   * with `Array.isArray()`, which covers that NULL and the `undefined` a `select('*')` yields for
   * an absent column, and is the same guard the P-04 and P-06 readers use.
   */
  checks_run: InspectionCheckId[] | null;
  superseded_at: string | null;
  compared_by: string;
  compared_at: string;
}

/** A finding row as stored. Mirrors migration 017's `inspection_findings`. */
export interface InspectionFinding {
  id: string;
  comparison_id: string;
  inspection_id: string;
  work_id: string;
  /** The photograph an I-001 finding keyed on, so an officer can open it. Null otherwise. */
  photo_id: string | null;
  check_id: string;
  severity: string;
  detail: string;
  observed_value: string | null;
  /**
   * The value compared against on the record side, and the column it came from. Deliberately
   * not named `agency_value`: no column records who entered a work's status, `uploaded_by` on a
   * photo is an unauthenticated header string, and attributing the record to an author would be
   * a fabrication the schema cannot support.
   */
  record_value: string | null;
  record_source: string | null;
  deviation: number | null;
  /** METRES or DAYS. Without it, a distance and a lag share one column and cannot be told apart. */
  deviation_unit: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/**
 * What `GET /api/inspections/status` answers.
 *
 * `available` is unconditionally true, unlike the document and photo counterparts: this feature
 * calls no model and needs no credential, so there is no configuration state in which it cannot
 * run. `reason` is correspondingly always null — the same biconditional the other two hold to.
 */
export function capability(): {
  available: boolean;
  reason: string | null;
  tier: string;
  checks: Array<{ id: string; description: string }>;
} {
  return {
    available: true,
    reason: null,
    tier:
      'Tier 3 — deterministic. Every check is a distance, a date subtraction or an equality ' +
      'over values already on record; no model is called and no credential is required. ' +
      'Raises no alerts.',
    checks: Object.entries(CHECK_IDS).map(([id, description]) => ({ id, description })),
  };
}

/**
 * Compares one inspection against its work and that work's photographs, and records the result.
 *
 * The sequence mirrors `analyzePhoto`: gather, reconcile, supersede, insert the comparison,
 * insert the findings, audit once. The audit entry carries both `checks_run` and
 * `findings_raised`, so the ledger distinguishes "four checks ran and found nothing" from
 * "nothing could be checked" — the distinction a clean-looking dossier would otherwise destroy.
 */
export async function compareInspection(
  inspectionId: string,
  actor: string,
): Promise<{
  comparison: InspectionComparison;
  findings: InspectionFinding[];
  checks_run: InspectionCheckId[];
  superseded: string | null;
}> {
  const inspection = await get<Inspection>('inspections', { id: inspectionId });
  if (!inspection) {
    throw new ApiError(404, 'NOT_FOUND', `No inspection with id '${inspectionId}'.`);
  }

  const work = await get<Work>('works', { id: inspection.work_id });
  if (!work) {
    throw new ApiError(404, 'NOT_FOUND', `Work '${inspection.work_id}' no longer exists.`);
  }

  const photos = await all<WorkPhoto>('work_photos', { where: { work_id: inspection.work_id } });

  // Counted here rather than derived from `checks_run` later: these are facts about the corpus
  // the comparison had, and they explain a `checks_run` of [] without guesswork.
  const photosWithGeotag = photos.filter(
    (p) => p.exif_latitude != null && p.exif_longitude != null,
  ).length;
  const photosWithTimestamp = photos.filter((p) => p.exif_taken_at != null).length;

  // The reconciler takes the narrow shape, and `== null` rather than a cast: an inspection
  // synced from a device with no GPS fix carries no coordinate, and `db.ts` selects '*' so a
  // column absent from the table arrives as undefined.
  const record: InspectionRecord = {
    latitude: inspection.latitude ?? null,
    longitude: inspection.longitude ?? null,
    inspection_date: inspection.inspection_date,
    overall_status: inspection.overall_status,
  };

  const { findings, checks_run } = reconcile(record, work, photos);

  // Supersede the previous current comparison before inserting the new one. Migration 017's
  // partial unique index enforces one current comparison per inspection, so this ordering is
  // not cosmetic — inserting first would violate the index.
  const previous = await all<InspectionComparison>('inspection_comparisons', {
    where: { inspection_id: inspectionId, superseded_at: null },
  });
  const supersededId = previous[0]?.id ?? null;
  if (supersededId !== null) {
    await update('inspection_comparisons', { id: supersededId }, { superseded_at: nowIso() });
    // Close the superseded comparison's still-open findings, for the same reason as photos:
    // `openInspectionFindings` filters on status alone, so without this a re-comparison would
    // leave the old run's OPEN findings in the worklist as stale duplicates. ACCEPTED and
    // DISMISSED are left untouched — they are decisions an officer made.
    await update(
      'inspection_findings',
      { comparison_id: supersededId, status: 'OPEN' },
      { status: 'SUPERSEDED' },
    );
  }

  // If this throws, the supersede above has already committed — this layer has no transaction
  // (see db.ts header) — so restore the previous comparison to current rather than leave the
  // inspection with zero comparisons and its findings orphaned in SUPERSEDED.
  let comparison: InspectionComparison;
  try {
    comparison = await insert<InspectionComparison>('inspection_comparisons', {
      id: newId(),
      inspection_id: inspectionId,
      work_id: inspection.work_id,
      photos_on_record: photos.length,
      photos_with_geotag: photosWithGeotag,
      photos_with_timestamp: photosWithTimestamp,
      checks_run,
      superseded_at: null,
      compared_by: actor,
      compared_at: nowIso(),
    });
  } catch (err) {
    if (supersededId !== null) {
      await update('inspection_comparisons', { id: supersededId }, { superseded_at: null });
      await update(
        'inspection_findings',
        { comparison_id: supersededId, status: 'SUPERSEDED' },
        { status: 'OPEN' },
      );
    }
    throw err;
  }

  const stored: InspectionFinding[] = [];
  for (const f of findings) {
    stored.push(
      await insert<InspectionFinding>('inspection_findings', {
        id: newId(),
        comparison_id: comparison.id,
        inspection_id: inspectionId,
        work_id: inspection.work_id,
        photo_id: f.photo_id,
        check_id: f.check_id,
        severity: f.severity,
        detail: f.detail,
        observed_value: f.observed_value,
        record_value: f.record_value,
        record_source: f.record_source,
        deviation: f.deviation,
        deviation_unit: f.deviation_unit,
        status: 'OPEN',
        created_at: nowIso(),
      }),
    );
  }

  await appendAudit(actor, 'INSPECTION_COMPARED', 'work', inspection.work_id, {
    inspection_id: inspectionId,
    comparison_id: comparison.id,
    photos_on_record: photos.length,
    photos_with_geotag: photosWithGeotag,
    photos_with_timestamp: photosWithTimestamp,
    // Both numbers, because they answer different questions. Zero findings out of four checks
    // is an inspection consistent with the record; zero out of zero is an inspection nothing
    // could be checked against.
    checks_run,
    findings_raised: stored.length,
    finding_check_ids: stored.map((f) => f.check_id),
    superseded_comparison_id: supersededId,
  });

  return { comparison, findings: stored, checks_run, superseded: supersededId };
}

/**
 * Every inspection on a work, each with its current comparison and that comparison's findings.
 *
 * A null `comparison` means nobody has run the comparison yet — not that the inspection is
 * clean. The panel must render those two differently, which is why this returns the null rather
 * than an empty comparison shaped like a clean one.
 */
export async function evidenceForWork(workId: string): Promise<
  Array<Inspection & { comparison: InspectionComparison | null; findings: InspectionFinding[] }>
> {
  const [inspections, comparisons, findings] = await Promise.all([
    all<Inspection>('inspections', { where: { work_id: workId } }),
    all<InspectionComparison>('inspection_comparisons', {
      where: { work_id: workId, superseded_at: null },
    }),
    all<InspectionFinding>('inspection_findings', { where: { work_id: workId } }),
  ]);

  // Most recent inspection first. Sorted here rather than in the query because `inspection_date`
  // is a date string and `all` takes a single orderBy column; the two-key ordering (date, then
  // creation) is clearer in code than as a database concern.
  const sorted = [...inspections].sort((a, b) => {
    const byDate = (b.inspection_date ?? '').localeCompare(a.inspection_date ?? '');
    return byDate !== 0 ? byDate : (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });

  return sorted.map((i) => {
    const comparison = comparisons.find((c) => c.inspection_id === i.id) ?? null;
    return {
      ...i,
      comparison,
      // Findings belong to a comparison, so a superseded run's findings do not appear here.
      findings: comparison === null ? [] : findings.filter((f) => f.comparison_id === comparison.id),
    };
  });
}

/**
 * Fetches a finding and asserts it can be reviewed: it exists, it is still OPEN, and its
 * comparison has not been superseded. Shared by accept and dismiss so both apply the same
 * guards — a finding from a replaced comparison must not be actionable through either path.
 */
async function getReviewableFinding(findingId: string): Promise<InspectionFinding> {
  const finding = await get<InspectionFinding>('inspection_findings', { id: findingId });
  if (!finding) {
    throw new ApiError(404, 'NOT_FOUND', `No finding with id '${findingId}'.`);
  }
  if (finding.status !== 'OPEN') {
    throw new ApiError(
      409,
      'ALREADY_REVIEWED',
      `This finding was already ${finding.status.toLowerCase()}` +
        `${finding.reviewed_by ? ` by ${finding.reviewed_by}` : ''}` +
        `${finding.reviewed_at ? ` at ${finding.reviewed_at}` : ''}.`,
    );
  }

  const comparison = await get<InspectionComparison>('inspection_comparisons', {
    id: finding.comparison_id,
  });
  if (comparison && comparison.superseded_at !== null) {
    throw new ApiError(
      409,
      'COMPARISON_SUPERSEDED',
      'This finding belongs to an inspection comparison that has since been replaced by a ' +
        "newer run. Review the current comparison's findings instead.",
    );
  }

  return finding;
}

/**
 * Officer accepts a finding.
 *
 * No `works` write-back, matching the photo counterpart: an inspector's report that a site is
 * unfinished does not license this platform to set the work's status. That correction belongs
 * in e-SAKSHI, by an officer, on the record of authority. Accepting records the judgement.
 */
export async function acceptInspectionFinding(
  findingId: string,
  actor: string,
  note: string | null,
): Promise<InspectionFinding> {
  const finding = await getReviewableFinding(findingId);

  const [updated] = await update<InspectionFinding>(
    'inspection_findings',
    { id: findingId },
    { status: 'ACCEPTED', reviewed_by: actor, reviewed_at: nowIso(), review_note: note },
  );

  await appendAudit(actor, 'INSPECTION_FINDING_ACCEPTED', 'work', finding.work_id, {
    finding_id: findingId,
    check_id: finding.check_id,
    severity: finding.severity,
    comparison_id: finding.comparison_id,
    inspection_id: finding.inspection_id,
    note,
  });

  return updated ?? { ...finding, status: 'ACCEPTED' };
}

/**
 * Officer dismisses a finding.
 *
 * A reason is required, as everywhere else in the platform: a dismissal with no stated reason is
 * indistinguishable from a queue being cleared, and dismissals are the only evidence a check
 * produces noise. I-001 in particular is expected to be dismissed on large or linear sites, and
 * those dismissals are how anyone would know to widen its tolerance.
 */
export async function dismissInspectionFinding(
  findingId: string,
  actor: string,
  reason: string,
): Promise<InspectionFinding> {
  const finding = await getReviewableFinding(findingId);

  const [updated] = await update<InspectionFinding>(
    'inspection_findings',
    { id: findingId },
    { status: 'DISMISSED', reviewed_by: actor, reviewed_at: nowIso(), review_note: reason },
  );

  await appendAudit(actor, 'INSPECTION_FINDING_DISMISSED', 'work', finding.work_id, {
    finding_id: findingId,
    check_id: finding.check_id,
    severity: finding.severity,
    comparison_id: finding.comparison_id,
    inspection_id: finding.inspection_id,
    reason,
  });

  return updated ?? { ...finding, status: 'DISMISSED' };
}

/** Open findings across the corpus, most severe first. The inspection-evidence worklist. */
export async function openInspectionFindings(limit = 100): Promise<InspectionFinding[]> {
  const rows = await all<InspectionFinding>('inspection_findings', { where: { status: 'OPEN' } });
  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)).slice(0, limit);
}
