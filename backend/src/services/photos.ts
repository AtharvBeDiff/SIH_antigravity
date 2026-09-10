/**
 * Photos — upload, store, read, reconcile, record.
 *
 * The orchestration layer for P-06, the exact counterpart of `documents.ts` one modality
 * over. `photo_ai.ts` reads an image, `photo_reconcile.ts` compares the reading against the
 * work, and this file connects them to storage, the database and the audit ledger.
 *
 * ## Why the upload is base64 in a JSON body
 *
 * Same reason as documents: the backend has no multipart parser and this feature is not
 * reason enough to add one. `IngestPage.tsx` already posts a file as a JSON string, and
 * `server.ts` sets a 10 MB JSON limit against which a 5 MB image (base64-inflated to ~6.7 MB)
 * fits. {@link MAX_PHOTO_BYTES} enforces the decoded size before anything is written.
 *
 * ## EXIF is read at upload, not at analysis
 *
 * The GPS coordinate and capture time are deterministic facts about the file's bytes, like
 * its sha256 and size, so they are parsed once here (dependency-free, no model) and stored on
 * the `work_photos` row. The geotag check later reads them off the row. Parsing them at
 * analysis time would re-download the file and re-derive a fact that never changes.
 *
 * ## The file is stored before it is analysed, and the analysis is a separate step
 *
 * Upload writes the object, parses EXIF, writes the row, returns. Analysis is a second call
 * that invokes the model. A model call can fail for reasons unrelated to the file (no
 * credential, rate limit, timeout); a combined endpoint would fail a good upload because the
 * model was busy and push the officer to re-upload, producing a duplicate object. Storing
 * first makes a failed analysis retryable against a file that is already safe.
 *
 * ## A superseded analysis is kept
 *
 * Re-analysing a photo inserts a new analysis and stamps `superseded_at` on the previous one.
 * The old reading is the evidence for what an officer saw when they accepted or dismissed a
 * finding; overwriting it would make their decision unexplainable. Findings hang off the
 * analysis that produced them.
 *
 * ## No write-back to `works`
 *
 * Unlike documents (where accepting D-007 flips `has_uc`), no photo finding changes a work
 * row. A photo showing an unfinished site does not mean the platform should set the work's
 * status — that is the officer's action in e-SAKSHI, not an inference this platform makes.
 * Accepting a photo finding records the officer's disposition and nothing more.
 */

import { ApiError } from '../http.ts';
import { all, get, insert, update, uploadFile, downloadFile, getSignedUrl } from '../db.ts';
import { newId, nowIso, sha256 } from '../util.ts';
import { appendAudit } from './audit_chain.ts';
import type { Work, WorkPhoto } from '../types.ts';
import { readExif } from './exif.ts';
import { observePhoto, PHOTO_MIME_TYPES, type PhotoObservations, type PhotoReadFn } from './photo_ai.ts';
import { reconcile, type Finding, type PhotoCheckId, type PhotoGps } from './photo_reconcile.ts';
import { MAX_INLINE_BYTES } from './llm.ts';

/** The private bucket photos live in, shared with documents. Created by migration 003. */
const BUCKET = 'evidence';

/**
 * Decoded-size ceiling for a photo upload.
 *
 * Its own constant rather than a shared one with documents: a photo ceiling and a document
 * ceiling are different facts that happen to coincide at 5 MB today. Must stay
 * `<= MAX_INLINE_BYTES` (the model's inline-read ceiling in `llm.ts`), or an image would be
 * stored and then refused at analysis — an object in the bucket nothing can read. The
 * ordering is asserted by a test in `tests/photo_ai.test.ts`.
 */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Ceiling on the raw model text stored beside an analysis. */
const MAX_RESPONSE_CHARS = 4_000;

/** An analysis row as stored. Mirrors migration 014's `photo_analyses`. */
export interface PhotoAnalysis extends PhotoObservations {
  id: string;
  photo_id: string;
  work_id: string;
  model: string;
  latency_ms: number | null;
  fields_found: number;
  fields_expected: number;
  /**
   * The V-checks that were able to run against this reading — a fact about the comparison,
   * where `fields_found` is a fact about the model. Not interchangeable: `asset_description`
   * counts toward `fields_found` but no check reads it, and V-001 compares the EXIF geotag
   * with no reading at all.
   *
   * `[]` is a measured result (nothing could be compared). `null` means the row predates
   * migration 016 and nothing was recorded — never that nothing ran.
   */
  checks_run: PhotoCheckId[] | null;
  raw_response: string | null;
  superseded_at: string | null;
  analyzed_by: string;
  analyzed_at: string;
}

/** A finding row as stored. Mirrors migration 014's `photo_findings`. */
export interface PhotoFinding {
  id: string;
  analysis_id: string;
  work_id: string;
  photo_id: string;
  check_id: string;
  severity: string;
  detail: string;
  observed_value: string | null;
  portal_value: string | null;
  deviation: number | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/**
 * Decodes and validates an uploaded image before anything is written.
 *
 * Strict about the MIME type against {@link PHOTO_MIME_TYPES} — image formats only. A PDF is
 * a document (P-04), not a site photo, and would upload here only to sit unanalysable.
 *
 * Exported for direct unit testing: it is the sole input-validation boundary for photo
 * uploads, and its four rejection branches are cheaper to assert here than through the full
 * `storePhoto` path.
 */
export function decodePhotoUpload(base64: string, contentType: string): Buffer {
  const mime = contentType.trim().toLowerCase();
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ApiError(
      400,
      'UNSUPPORTED_TYPE',
      `'${contentType}' is not an accepted photo type. Accepted types: ` +
        `${PHOTO_MIME_TYPES.join(', ')}. Documents such as PDFs are uploaded through the ` +
        'documents endpoint, not here.',
    );
  }

  // Tolerate a data URL prefix, which is what `FileReader.readAsDataURL` produces.
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, 'base64');
  } catch {
    throw new ApiError(400, 'BAD_ENCODING', 'The image content is not valid base64.');
  }

  // Node's base64 decoder silently drops invalid characters rather than throwing, so an empty
  // result means "not base64" as often as "empty file"; both are worth refusing.
  if (bytes.byteLength === 0) {
    throw new ApiError(
      400,
      'EMPTY_FILE',
      'The decoded image is empty. Either the content was not base64 or the file has no bytes.',
    );
  }

  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new ApiError(
      413,
      'FILE_TOO_LARGE',
      `The image is ${(bytes.byteLength / 1_048_576).toFixed(1)} MB, above the ` +
        `${(MAX_PHOTO_BYTES / 1_048_576).toFixed(0)} MB limit for photos.`,
    );
  }

  return bytes;
}

/**
 * Stores a photo against a work and records it.
 *
 * The `work_photos` row carries `content_sha256`, so the same photograph submitted against
 * two different works is detectable — the byte-exact half of the photo-reuse concern
 * (Doctrine 7). Nothing is refused on that basis: a legitimate re-upload correcting a caption
 * repeats the hash, and blocking it would push the operator to work around the platform.
 * Perceptual near-duplicate reuse (a re-encoded or cropped copy) is R-010's job and remains
 * dormant until a perceptual-hash producer exists.
 */
export async function storePhoto(input: {
  work_id: string;
  caption: string | null;
  filename: string;
  content_base64: string;
  content_type: string;
  actor: string;
}): Promise<{
  photo: WorkPhoto;
  duplicate_of: string[];
  exif: { latitude: number | null; longitude: number | null; taken_at: string | null };
}> {
  const work = await get<Work>('works', { id: input.work_id });
  if (!work) {
    throw new ApiError(404, 'NOT_FOUND', `No work with id '${input.work_id}'.`);
  }

  const bytes = decodePhotoUpload(input.content_base64, input.content_type);
  const digest = sha256(bytes.toString('base64'));

  // Which other works already hold these exact bytes. Reported, not blocked: the same photo
  // against two works is a finding an officer should see, surfaced at the point of upload.
  const sameBytes = await all<WorkPhoto>('work_photos', { where: { content_sha256: digest } });
  const duplicateOf = [
    ...new Set(sameBytes.filter((p) => p.work_id !== input.work_id).map((p) => p.work_id)),
  ];

  // Deterministic EXIF facts, parsed once here. A stripped or malformed header yields nulls
  // (never a fabricated 0,0) and the geotag check simply will not run.
  const exif = readExif(bytes);

  const id = newId();
  const ext = input.filename.includes('.') ? input.filename.slice(input.filename.lastIndexOf('.')) : '';
  const storageKey = `photos/${input.work_id}/${id}${ext}`;

  await uploadFile(BUCKET, storageKey, bytes, input.content_type);

  const photo = await insert<WorkPhoto>('work_photos', {
    id,
    work_id: input.work_id,
    caption: input.caption,
    storage_key: storageKey,
    content_type: input.content_type,
    size_bytes: bytes.byteLength,
    content_sha256: digest,
    exif_latitude: exif.latitude,
    exif_longitude: exif.longitude,
    exif_taken_at: exif.takenAt,
    uploaded_by: input.actor,
    uploaded_at: nowIso(),
  });

  await appendAudit(input.actor, 'PHOTO_UPLOADED', 'work', input.work_id, {
    photo_id: id,
    filename: input.filename,
    storage_key: storageKey,
    size_bytes: bytes.byteLength,
    content_sha256: digest,
    has_geotag: exif.latitude !== null && exif.longitude !== null,
    taken_at: exif.takenAt,
    identical_bytes_already_on_works: duplicateOf,
  });

  return {
    photo,
    duplicate_of: duplicateOf,
    exif: { latitude: exif.latitude, longitude: exif.longitude, taken_at: exif.takenAt },
  };
}

/**
 * Reads a stored photo, compares it against the work, and records both.
 *
 * The sequence mirrors `extractDocument`: observe, reconcile, write the analysis, write the
 * findings, audit once. The audit entry names the finding count and the checks that ran, so
 * the ledger distinguishes "four checks ran and found nothing" from "nothing could be
 * checked" — the distinction a clean-looking dossier would otherwise destroy.
 *
 * @param read Injected model client, so this whole function is testable with no credential.
 */
export async function analyzePhoto(
  photoId: string,
  actor: string,
  read?: PhotoReadFn,
): Promise<{
  analysis: PhotoAnalysis;
  findings: PhotoFinding[];
  checks_run: PhotoCheckId[];
  superseded: string | null;
}> {
  const photo = await get<WorkPhoto>('work_photos', { id: photoId });
  if (!photo) {
    throw new ApiError(404, 'NOT_FOUND', `No photo with id '${photoId}'.`);
  }

  const work = await get<Work>('works', { id: photo.work_id });
  if (!work) {
    throw new ApiError(404, 'NOT_FOUND', `Work '${photo.work_id}' no longer exists.`);
  }

  const blob = await downloadFile(BUCKET, photo.storage_key);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const mimeType = photo.content_type ?? (blob.type !== '' ? blob.type : 'image/jpeg');

  const result = await observePhoto({ data: bytes, mimeType }, read);

  // The geotag comes off the row, parsed at upload. Both coordinates present or no geotag.
  const gps: PhotoGps | null =
    photo.exif_latitude !== null && photo.exif_longitude !== null
      ? { latitude: photo.exif_latitude, longitude: photo.exif_longitude }
      : null;

  const { findings, checks_run } = reconcile(work, result.observations, gps);

  // Supersede the previous current analysis before inserting the new one. Migration 014's
  // partial unique index enforces one current analysis per photo, so this ordering is not
  // cosmetic — inserting first would violate the index.
  const previous = await all<PhotoAnalysis>('photo_analyses', {
    where: { photo_id: photoId, superseded_at: null },
  });
  const supersededId = previous[0]?.id ?? null;
  if (supersededId !== null) {
    await update('photo_analyses', { id: supersededId }, { superseded_at: nowIso() });
    // Close the superseded analysis's still-open findings. `photosForWork` already hides them
    // (it filters to the current analysis), but `openPhotoFindings` — the cross-corpus
    // worklist — filters on status alone, so without this a re-analysis would leave the old
    // reading's OPEN findings in the queue as stale duplicates. ACCEPTED and DISMISSED are
    // left untouched: they are decisions an officer made, and the reading that informed them
    // is why a superseded analysis is kept rather than deleted.
    await update(
      'photo_findings',
      { analysis_id: supersededId, status: 'OPEN' },
      { status: 'SUPERSEDED' },
    );
  }

  // Insert the new current analysis. If this throws, the supersede above has already
  // committed — this layer has no transaction (see db.ts header) — so restore the previous
  // analysis to current rather than leave the photo with zero analyses and its findings
  // orphaned in SUPERSEDED.
  let analysis: PhotoAnalysis;
  try {
    analysis = await insert<PhotoAnalysis>('photo_analyses', {
      id: newId(),
      photo_id: photoId,
      work_id: photo.work_id,
      model: result.model,
      latency_ms: result.latency_ms,
      asset_category: result.observations.asset_category,
      asset_description: result.observations.asset_description,
      construction_stage: result.observations.construction_stage,
      integrity_concern: result.observations.integrity_concern,
      integrity_note: result.observations.integrity_note,
      fields_found: result.fields_found,
      fields_expected: result.fields_expected,
      // Stored, not just audited and returned. Without it on the row, the dossier could only
      // ask `fields_found > 0` on reload — a different question that answers wrongly in both
      // directions (see migration 016).
      checks_run,
      raw_response: result.raw_response ? result.raw_response.slice(0, MAX_RESPONSE_CHARS) : null,
      superseded_at: null,
      analyzed_by: actor,
      analyzed_at: nowIso(),
    });
  } catch (err) {
    if (supersededId !== null) {
      await update('photo_analyses', { id: supersededId }, { superseded_at: null });
      await update(
        'photo_findings',
        { analysis_id: supersededId, status: 'SUPERSEDED' },
        { status: 'OPEN' },
      );
    }
    throw err;
  }

  const stored: PhotoFinding[] = [];
  for (const f of findings) {
    stored.push(
      await insert<PhotoFinding>('photo_findings', {
        id: newId(),
        analysis_id: analysis.id,
        work_id: photo.work_id,
        photo_id: photoId,
        check_id: f.check_id,
        severity: f.severity,
        detail: f.detail,
        observed_value: f.observed_value,
        portal_value: f.portal_value,
        deviation: f.deviation,
        status: 'OPEN',
        created_at: nowIso(),
      }),
    );
  }

  await appendAudit(actor, 'PHOTO_ANALYZED', 'work', photo.work_id, {
    photo_id: photoId,
    analysis_id: analysis.id,
    model: result.model,
    fields_found: result.fields_found,
    fields_expected: result.fields_expected,
    // Both numbers, because they answer different questions. Zero findings out of four checks
    // is a photo consistent with the record; zero out of zero is a photo nothing could be
    // checked against.
    checks_run,
    findings_raised: stored.length,
    finding_check_ids: stored.map((f) => f.check_id),
    superseded_analysis_id: supersededId,
  });

  return { analysis, findings: stored, checks_run, superseded: supersededId };
}

/** Photos for a work, each with its current analysis and open findings. */
export async function photosForWork(workId: string): Promise<
  Array<WorkPhoto & { analysis: PhotoAnalysis | null; findings: PhotoFinding[] }>
> {
  const [photos, analyses, findings] = await Promise.all([
    all<WorkPhoto>('work_photos', { where: { work_id: workId }, orderBy: 'uploaded_at' }),
    all<PhotoAnalysis>('photo_analyses', { where: { work_id: workId, superseded_at: null } }),
    all<PhotoFinding>('photo_findings', { where: { work_id: workId } }),
  ]);

  return photos.map((p) => {
    const analysis = analyses.find((a) => a.photo_id === p.id) ?? null;
    return {
      ...p,
      analysis,
      // Findings belong to an analysis, so a superseded reading's findings do not appear here.
      // Showing findings from a replaced reading would present numbers the current analysis
      // disagrees with.
      findings: analysis === null ? [] : findings.filter((f) => f.analysis_id === analysis.id),
    };
  });
}

/** A time-limited URL for viewing the stored image. The bucket is private. */
export async function photoUrl(photoId: string): Promise<{ url: string; expires_in: number }> {
  const photo = await get<WorkPhoto>('work_photos', { id: photoId });
  if (!photo) {
    throw new ApiError(404, 'NOT_FOUND', `No photo with id '${photoId}'.`);
  }
  const expiresIn = 300;
  const url = await getSignedUrl(BUCKET, photo.storage_key, expiresIn);
  return { url, expires_in: expiresIn };
}

/**
 * Officer accepts a finding.
 *
 * Unlike the document counterpart there is no `works` write-back: accepting a photo finding
 * records the officer's judgement that the discrepancy is real and actioned, and nothing
 * about the work row changes on it. The same currency guards apply — a finding on a
 * superseded analysis must not be actionable.
 */
export async function acceptPhotoFinding(
  findingId: string,
  actor: string,
  note: string | null,
): Promise<PhotoFinding> {
  const finding = await getReviewableFinding(findingId);

  const [updated] = await update<PhotoFinding>(
    'photo_findings',
    { id: findingId },
    { status: 'ACCEPTED', reviewed_by: actor, reviewed_at: nowIso(), review_note: note },
  );

  await appendAudit(actor, 'PHOTO_FINDING_ACCEPTED', 'work', finding.work_id, {
    finding_id: findingId,
    check_id: finding.check_id,
    severity: finding.severity,
    analysis_id: finding.analysis_id,
    photo_id: finding.photo_id,
    note,
  });

  return updated ?? { ...finding, status: 'ACCEPTED' };
}

/**
 * Officer dismisses a finding.
 *
 * A reason is required, for the same reason `PATCH /api/alerts/:id` requires one: a dismissal
 * with no stated reason is indistinguishable from a queue being cleared, and dismissals are
 * the only evidence a check produces noise. V-002 and the softer V-001 tier are expected to
 * be dismissed often, and those dismissals are how anyone would know to tune them.
 */
export async function dismissPhotoFinding(
  findingId: string,
  actor: string,
  reason: string,
): Promise<PhotoFinding> {
  const finding = await getReviewableFinding(findingId);

  const [updated] = await update<PhotoFinding>(
    'photo_findings',
    { id: findingId },
    { status: 'DISMISSED', reviewed_by: actor, reviewed_at: nowIso(), review_note: reason },
  );

  await appendAudit(actor, 'PHOTO_FINDING_DISMISSED', 'work', finding.work_id, {
    finding_id: findingId,
    check_id: finding.check_id,
    severity: finding.severity,
    analysis_id: finding.analysis_id,
    photo_id: finding.photo_id,
    reason,
  });

  return updated ?? { ...finding, status: 'DISMISSED' };
}

/**
 * Fetches a finding and asserts it can be reviewed: it exists, it is still OPEN, and its
 * analysis has not been superseded. Shared by accept and dismiss so both apply the same
 * guards — a finding on a replaced reading must not be actionable through either path.
 */
async function getReviewableFinding(findingId: string): Promise<PhotoFinding> {
  const finding = await get<PhotoFinding>('photo_findings', { id: findingId });
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

  const analysis = await get<PhotoAnalysis>('photo_analyses', { id: finding.analysis_id });
  if (analysis && analysis.superseded_at !== null) {
    throw new ApiError(
      409,
      'ANALYSIS_SUPERSEDED',
      'This finding belongs to a photo reading that has since been replaced by a newer ' +
        "analysis. Review the current reading's findings instead.",
    );
  }

  return finding;
}

/** Open findings across the corpus, most severe first. The photo-AI worklist. */
export async function openPhotoFindings(limit = 100): Promise<PhotoFinding[]> {
  const rows = await all<PhotoFinding>('photo_findings', { where: { status: 'OPEN' } });
  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)).slice(0, limit);
}

/** Re-exported so the router can describe a finding without importing the reconciler. */
export type { Finding };
