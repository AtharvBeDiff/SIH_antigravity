/**
 * Documents — upload, store, read, reconcile, record.
 *
 * The orchestration layer for P-04. `document_ai.ts` reads a page, `document_reconcile.ts`
 * compares the reading against the work, and this file is what connects them to storage,
 * the database and the audit ledger.
 *
 * ## Why the upload is base64 in a JSON body
 *
 * The backend has no multipart parser and adding one for this would be the only reason it
 * exists. The precedent is already in the product: `IngestPage.tsx` reads a CSV client-side
 * and posts it as a JSON string. `server.ts` sets `express.json({ limit: '10mb' })`, and
 * base64 inflates by 4/3, so a 5 MB file — the `evidence` bucket's own ceiling — arrives as
 * ~6.7 MB and fits. {@link MAX_UPLOAD_BYTES} enforces the decoded size before anything is
 * written, so the limit is stated in the units the operator thinks in rather than
 * discovered as a body-parser error.
 *
 * ## The file is stored before it is read, and the reading is a separate step
 *
 * Upload writes the object and the `documents` row, then returns. Extraction is a second
 * call. This is not laziness: a model call takes seconds and can fail for reasons that have
 * nothing to do with the file (no credential, rate limit, timeout), and a combined endpoint
 * would make a perfectly good upload fail because the model was busy. The officer would
 * then re-upload, producing a duplicate object. Storing first means a failed extraction is
 * retryable against a file that is already safe.
 *
 * ## A superseded extraction is kept
 *
 * Re-reading a document inserts a new extraction and stamps `superseded_at` on the previous
 * one. The old reading is the evidence for what an officer was looking at when they
 * accepted or dismissed a finding; overwriting it would make their decision unexplainable.
 * Findings hang off the extraction that produced them, so a superseded reading keeps its
 * findings and the current reading gets its own.
 *
 * ## has_uc is updated, and never on the model's word alone
 *
 * The one place this feature writes back to `works`. When a UC extraction yields a
 * certificate date and the portal has `has_uc = false`, that is D-007 — a record-keeping
 * gap. The flag is **not** flipped automatically: `has_uc` gates R-003, and letting a model
 * reading silence a compliance rule would mean a poor scan could clear an alert. The
 * finding is raised, an officer accepts it, and {@link acceptFinding} performs the write
 * with the acceptance in the ledger. That is the whole difference between an AI that
 * assists an audit and an AI that quietly overrides one.
 */

import { ApiError } from '../http.ts';
import { all, get, insert, update, uploadFile, downloadFile, getSignedUrl } from '../db.ts';
import { newId, nowIso, sha256 } from '../util.ts';
import { appendAudit } from './audit_chain.ts';
import type { Agency, Document, Work } from '../types.ts';
import {
  DOCUMENT_KINDS,
  extractFields,
  resolveKind,
  type DocumentKind,
  type DocumentReadFn,
  type ExtractedFields,
} from './document_ai.ts';
import { reconcileWithAgency, type CheckId, type Finding } from './document_reconcile.ts';
import { VISION_MIME_TYPES } from './llm.ts';

/** The private bucket documents live in. Created by migration 003. */
const BUCKET = 'evidence';

/**
 * Decoded-size ceiling, matching the `evidence` bucket's `file_size_limit`.
 *
 * Enforced on the decoded length, not the base64 length, because the operator's file is 5 MB
 * and telling them the limit is 6.67 MB would be describing an implementation detail of the
 * transport.
 *
 * Must stay `<= MAX_INLINE_BYTES`, the extractor's inline-read ceiling in `llm.ts`. This is a
 * store ceiling and that is a model ceiling — two different facts that happen to coincide at
 * 5 MB — so they are separate constants, not one derived from the other. But an upload
 * accepted above the extract ceiling would be stored and then refused at extraction with a
 * 413, an object in the bucket nothing can read. `/api/documents/status` publishes both (as
 * `max_upload_bytes` and `max_bytes`); the ordering between them is asserted by the
 * "`/status` advertises an upload ceiling no larger than the extractor accepts" test in
 * `tests/document_ai.test.ts`, so raising this without raising that is caught.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** An extraction row as stored. Mirrors migration 013's `document_extractions`. */
export interface DocumentExtraction extends ExtractedFields {
  id: string;
  document_id: string;
  work_id: string;
  doc_kind: string;
  model: string;
  latency_ms: number | null;
  fields_found: number;
  fields_expected: number;
  /**
   * The D-checks that were able to run against this reading — a fact about the comparison,
   * where `fields_found` is a fact about the model. Not interchangeable, and the gap is wide
   * here: `sanction_reference`, `work_reference` and `signatory_name` all count toward
   * `fields_found` but no D-check reads any of them, so a utilisation certificate can read
   * three of its six expected fields and still have run nothing.
   *
   * `[]` is a measured result (nothing could be compared). `null` means the row predates
   * migration 016 and nothing was recorded — never that nothing ran.
   */
  checks_run: CheckId[] | null;
  raw_transcript: string | null;
  superseded_at: string | null;
  extracted_by: string;
  extracted_at: string;
}

/** A finding row as stored. Mirrors migration 013's `document_findings`. */
export interface DocumentFinding {
  id: string;
  extraction_id: string;
  work_id: string;
  check_id: string;
  severity: string;
  detail: string;
  document_value: string | null;
  portal_value: string | null;
  deviation_pct: number | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/**
 * Decodes and validates an uploaded payload before anything is written.
 *
 * Strict about the MIME type against {@link VISION_MIME_TYPES} rather than against the
 * bucket's list, because a file the bucket accepts but the model cannot read would upload
 * successfully and then be permanently unextractable — an object in storage that the product
 * has no path to use.
 *
 * Exported for direct unit testing: it is the sole input-validation boundary for uploads,
 * and its four rejection branches (unsupported type, bad encoding, empty, too large) are
 * cheaper and more precisely asserted here than through the full `storeDocument` path, which
 * would need a stubbed storage client to reach them.
 */
export function decodeUpload(base64: string, contentType: string): Buffer {
  const mime = contentType.trim().toLowerCase();
  if (!(VISION_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ApiError(
      400,
      'UNSUPPORTED_TYPE',
      `'${contentType}' cannot be stored as a work document. Accepted types: ` +
        `${VISION_MIME_TYPES.join(', ')}. The list is limited to what the extraction step ` +
        'can actually read — a file that uploads but can never be read is worse than a ' +
        'refused upload.',
    );
  }

  // Tolerate a data URL prefix, which is what `FileReader.readAsDataURL` produces and the
  // obvious thing a frontend will send.
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, 'base64');
  } catch {
    throw new ApiError(400, 'BAD_ENCODING', 'The file content is not valid base64.');
  }

  // Node's base64 decoder does not throw on malformed input; it silently drops invalid
  // characters. An empty result therefore means "not base64" rather than "empty file", and
  // both are worth refusing.
  if (bytes.byteLength === 0) {
    throw new ApiError(
      400,
      'EMPTY_FILE',
      'The decoded file is empty. Either the content was not base64 or the file has no ' +
        'bytes.',
    );
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      413,
      'FILE_TOO_LARGE',
      `The file is ${(bytes.byteLength / 1_048_576).toFixed(1)} MB, above the ` +
        `${(MAX_UPLOAD_BYTES / 1_048_576).toFixed(0)} MB limit for work documents.`,
    );
  }

  return bytes;
}

/**
 * Stores a document against a work and records it.
 *
 * The `documents` row carries `content_sha256`, so a re-upload of a byte-identical file is
 * recognisable and the same certificate submitted against two different works is
 * detectable. Nothing is refused on that basis here — a legitimate re-upload correcting
 * metadata is a sanctioned operation, and refusing it would push the operator toward
 * working around the platform.
 */
export async function storeDocument(input: {
  work_id: string;
  type: string;
  filename: string;
  content_base64: string;
  content_type: string;
  actor: string;
}): Promise<{ document: Document; kind: DocumentKind | null; duplicate_of: string[] }> {
  const work = await get<Work>('works', { id: input.work_id });
  if (!work) {
    throw new ApiError(404, 'NOT_FOUND', `No work with id '${input.work_id}'.`);
  }

  const bytes = decodeUpload(input.content_base64, input.content_type);
  const digest = sha256(bytes.toString('base64'));

  // Which other works already hold these exact bytes. Reported, not blocked: the same
  // completion certificate attached to two works is a finding an officer should see, and
  // the honest place to surface it is at the point of upload.
  const sameBytes = await all<Document>('documents', { where: { content_sha256: digest } });
  const duplicateOf = [
    ...new Set(sameBytes.filter((d) => d.work_id !== input.work_id).map((d) => d.work_id)),
  ];

  const id = newId();
  // Extension preserved so a signed URL opens in the right viewer. Path namespaced by work
  // so the bucket stays navigable by hand when something goes wrong.
  const ext = input.filename.includes('.') ? input.filename.slice(input.filename.lastIndexOf('.')) : '';
  const storageKey = `documents/${input.work_id}/${id}${ext}`;

  await uploadFile(BUCKET, storageKey, bytes, input.content_type);

  const document = await insert<Document>('documents', {
    id,
    work_id: input.work_id,
    type: input.type,
    filename: input.filename,
    storage_key: storageKey,
    content_type: input.content_type,
    size_bytes: bytes.byteLength,
    content_sha256: digest,
    uploaded_at: nowIso(),
  });

  await appendAudit(input.actor, 'DOCUMENT_UPLOADED', 'work', input.work_id, {
    document_id: id,
    type: input.type,
    filename: input.filename,
    storage_key: storageKey,
    size_bytes: bytes.byteLength,
    content_sha256: digest,
    // In the ledger because it is a fact about the corpus at upload time, and because a
    // later dispute about which work a certificate belonged to is exactly what an
    // append-only record is for.
    identical_bytes_already_on_works: duplicateOf,
  });

  return { document, kind: resolveKind(input.type), duplicate_of: duplicateOf };
}

/**
 * Reads a stored document, compares it against the work, and records both.
 *
 * The sequence is deliberate: extract, reconcile, write the extraction, write the findings,
 * audit once. The audit entry names the finding count and the checks that ran, so the ledger
 * distinguishes "eight checks ran and found nothing" from "nothing could be checked" — a
 * distinction the officer needs and a clean-looking dossier destroys.
 *
 * @param read Injected model client, so this whole function is testable with no credential.
 */
export async function extractDocument(
  documentId: string,
  actor: string,
  read?: DocumentReadFn,
): Promise<{
  extraction: DocumentExtraction;
  findings: DocumentFinding[];
  checks_run: CheckId[];
  superseded: string | null;
}> {
  const document = await get<Document>('documents', { id: documentId });
  if (!document) {
    throw new ApiError(404, 'NOT_FOUND', `No document with id '${documentId}'.`);
  }

  const kind = resolveKind(document.type);
  if (kind === null) {
    throw new ApiError(
      422,
      'UNKNOWN_DOCUMENT_KIND',
      `'${document.type}' is not a document kind this platform can read. Known kinds: ` +
        `${DOCUMENT_KINDS.join(', ')}. The kind decides which comparisons are run, so ` +
        'guessing it would mean checking a document against requirements it never claimed ' +
        'to meet.',
    );
  }

  const work = await get<Work>('works', { id: document.work_id });
  if (!work) {
    throw new ApiError(404, 'NOT_FOUND', `Work '${document.work_id}' no longer exists.`);
  }

  const blob = await downloadFile(BUCKET, document.storage_key);
  const bytes = Buffer.from(await blob.arrayBuffer());

  // `documents.content_type` is null for rows written before migration 013. Falling back to
  // the blob's own type, then to PDF, keeps older rows readable rather than unextractable.
  const mimeType =
    document.content_type ?? (blob.type !== '' ? blob.type : 'application/pdf');

  const result = await extractFields(kind, { data: bytes, mimeType }, read);

  // The agency name D-005 needs. `works` carries `agency_id`; a missing agency means the
  // check does not run, which `reconcileWithAgency` handles by not adding it to checks_run.
  const agency = work.agency_id ? await get<Agency>('agencies', { id: work.agency_id }) : null;
  const { findings, checks_run } = reconcileWithAgency(
    work,
    kind,
    result.fields,
    agency?.name ?? null,
  );

  // Supersede the previous current extraction before inserting the new one. Migration 013's
  // partial unique index enforces one current reading per document, so this ordering is not
  // cosmetic — inserting first would violate the index.
  const previous = await all<DocumentExtraction>('document_extractions', {
    where: { document_id: documentId, superseded_at: null },
  });
  const supersededId = previous[0]?.id ?? null;
  if (supersededId !== null) {
    await update('document_extractions', { id: supersededId }, { superseded_at: nowIso() });
    // Close the superseded reading's still-open findings. `documentsForWork` already hides
    // them (it filters findings to the current extraction), but `openFindings` — the
    // cross-corpus worklist — filters on `status` alone, so without this a re-extraction
    // would leave the old reading's OPEN findings in the queue as stale duplicates, one more
    // set per re-read. It is also the safety property acceptFinding/dismissFinding rely on:
    // a finding on a superseded reading must not stay actionable, or an officer could accept
    // a D-007 from a scan the platform has since discarded and flip `works.has_uc` on its
    // word. ACCEPTED and DISMISSED findings are left untouched — they are decisions an
    // officer made, and the reading that informed them is exactly why a superseded extraction
    // is kept rather than deleted.
    await update(
      'document_findings',
      { extraction_id: supersededId, status: 'OPEN' },
      { status: 'SUPERSEDED' },
    );
  }

  // Insert the new current reading. If this throws, the supersede above has already
  // committed — this layer has no transaction (see db.ts header) — so restore the previous
  // reading to current rather than leave the document with zero extractions and its findings
  // orphaned in SUPERSEDED. A current reading's findings are only ever OPEN/ACCEPTED/DISMISSED,
  // never SUPERSEDED, so this rollback touches exactly the rows the block above changed.
  let extraction: DocumentExtraction;
  try {
    extraction = await insert<DocumentExtraction>('document_extractions', {
      id: newId(),
      document_id: documentId,
      work_id: document.work_id,
      doc_kind: kind,
      model: result.model,
      latency_ms: result.latency_ms,
      ...result.fields,
      fields_found: result.fields_found,
      fields_expected: result.fields_expected,
      // Stored, not just audited and returned. Without it on the row, the dossier could only
      // ask `fields_found > 0` on reload — and three of a UC's six expected fields are read
      // by no check at all, so that question has a wrong answer available (migration 016).
      checks_run,
      raw_transcript: result.raw_transcript,
      superseded_at: null,
      extracted_by: actor,
      extracted_at: nowIso(),
    });
  } catch (err) {
    if (supersededId !== null) {
      await update('document_extractions', { id: supersededId }, { superseded_at: null });
      await update(
        'document_findings',
        { extraction_id: supersededId, status: 'SUPERSEDED' },
        { status: 'OPEN' },
      );
    }
    throw err;
  }

  const stored: DocumentFinding[] = [];
  for (const f of findings) {
    stored.push(
      await insert<DocumentFinding>('document_findings', {
        id: newId(),
        extraction_id: extraction.id,
        work_id: document.work_id,
        check_id: f.check_id,
        severity: f.severity,
        detail: f.detail,
        document_value: f.document_value,
        portal_value: f.portal_value,
        deviation_pct: f.deviation_pct,
        status: 'OPEN',
        created_at: nowIso(),
      }),
    );
  }

  await appendAudit(actor, 'DOCUMENT_EXTRACTED', 'work', document.work_id, {
    document_id: documentId,
    extraction_id: extraction.id,
    doc_kind: kind,
    model: result.model,
    fields_found: result.fields_found,
    fields_expected: result.fields_expected,
    // Both numbers, because they answer different questions. Zero findings out of eight
    // checks is a clean document; zero findings out of zero checks is a document nothing
    // could be checked against.
    checks_run: checks_run,
    findings_raised: stored.length,
    finding_check_ids: stored.map((f) => f.check_id),
    superseded_extraction_id: supersededId,
    // Not the transcript. The ledger is append-only and hash-chained; copying document text
    // into it would grow it without bound and duplicate corpus data into a structure that
    // is never pruned. The extraction row holds it and is referenced by id.
  });

  return { extraction, findings: stored, checks_run, superseded: supersededId };
}

/** Documents for a work, each with its current extraction and open findings. */
export async function documentsForWork(workId: string): Promise<
  Array<
    Document & {
      extraction: DocumentExtraction | null;
      findings: DocumentFinding[];
      readable_kind: DocumentKind | null;
    }
  >
> {
  const [documents, extractions, findings] = await Promise.all([
    all<Document>('documents', { where: { work_id: workId }, orderBy: 'uploaded_at' }),
    all<DocumentExtraction>('document_extractions', {
      where: { work_id: workId, superseded_at: null },
    }),
    all<DocumentFinding>('document_findings', { where: { work_id: workId } }),
  ]);

  return documents.map((d) => {
    const extraction = extractions.find((e) => e.document_id === d.id) ?? null;
    return {
      ...d,
      extraction,
      // Findings belong to an extraction, so a superseded reading's findings do not appear
      // here. That is intentional: showing findings from a reading that has been replaced
      // would present the officer with numbers the current extraction disagrees with.
      findings:
        extraction === null ? [] : findings.filter((f) => f.extraction_id === extraction.id),
      readable_kind: resolveKind(d.type),
    };
  });
}

/** A time-limited URL for viewing the stored file. The bucket is private. */
export async function documentUrl(documentId: string): Promise<{ url: string; expires_in: number }> {
  const document = await get<Document>('documents', { id: documentId });
  if (!document) {
    throw new ApiError(404, 'NOT_FOUND', `No document with id '${documentId}'.`);
  }
  const expiresIn = 300;
  const url = await getSignedUrl(BUCKET, document.storage_key, expiresIn);
  return { url, expires_in: expiresIn };
}

/**
 * Officer accepts a finding, and for D-007 that acceptance is what updates `works.has_uc`.
 *
 * The only write-back to `works` in this feature, and it is gated on a human. `has_uc`
 * gates R-003, so an automatic flip would let a model reading of a poor scan silence a
 * compliance alert. The officer's acceptance is the authority, the ledger records who and
 * when, and the model's role stops at having raised the question.
 */
export async function acceptFinding(
  findingId: string,
  actor: string,
  note: string | null,
): Promise<{ finding: DocumentFinding; work_updated: Record<string, unknown> | null }> {
  const finding = await get<DocumentFinding>('document_findings', { id: findingId });
  if (!finding) {
    throw new ApiError(404, 'NOT_FOUND', `No finding with id '${findingId}'.`);
  }
  if (finding.status !== 'OPEN') {
    throw new ApiError(
      409,
      'ALREADY_REVIEWED',
      `This finding was already ${finding.status.toLowerCase()} by ` +
        `${finding.reviewed_by ?? 'someone'}${finding.reviewed_at ? ` at ${finding.reviewed_at}` : ''}.`,
    );
  }

  // The finding must belong to the document's *current* reading. Superseding an extraction
  // closes its OPEN findings, so this normally cannot be reached through the UI; the guard is
  // here because the one thing that must never happen is accepting a D-007 from a superseded
  // scan and flipping `works.has_uc` on the strength of a reading the platform has discarded.
  // It also catches a finding left OPEN on a superseded extraction by data written before the
  // supersede-closes-findings behaviour existed. Fetched here rather than only inside the
  // D-007 branch so the check runs for every finding, and reused there.
  const extraction = await get<DocumentExtraction>('document_extractions', {
    id: finding.extraction_id,
  });
  if (extraction && extraction.superseded_at !== null) {
    throw new ApiError(
      409,
      'EXTRACTION_SUPERSEDED',
      'This finding belongs to a document reading that has since been replaced by a newer ' +
        'extraction. Review the current reading\'s findings instead.',
    );
  }

  const reviewedAt = nowIso();
  const [updated] = await update<DocumentFinding>(
    'document_findings',
    { id: findingId },
    { status: 'ACCEPTED', reviewed_by: actor, reviewed_at: reviewedAt, review_note: note },
  );

  // D-007 is the record-keeping gap: a UC is in hand and the portal says there is none.
  // Accepting it is the officer asserting the certificate is real, which is the only basis
  // on which `has_uc` should move.
  let workUpdated: Record<string, unknown> | null = null;
  if (finding.check_id === 'D-007') {
    const ucDate = extraction?.certificate_date ?? null;
    // `uc_date` is written here for the first time in this codebase's history — it existed
    // in the schema and was read by nothing. It is now the date printed on the certificate
    // an officer has confirmed, which is what the column always should have held.
    await update('works', { id: finding.work_id }, { has_uc: true, uc_date: ucDate });
    workUpdated = { has_uc: true, uc_date: ucDate };
  }

  await appendAudit(actor, 'DOCUMENT_FINDING_ACCEPTED', 'work', finding.work_id, {
    finding_id: findingId,
    check_id: finding.check_id,
    severity: finding.severity,
    extraction_id: finding.extraction_id,
    note,
    work_updated: workUpdated,
  });

  return { finding: updated ?? { ...finding, status: 'ACCEPTED' }, work_updated: workUpdated };
}

/**
 * Officer dismisses a finding.
 *
 * A reason is required, for the same reason `PATCH /api/alerts/:id` requires one: a
 * dismissal with no stated reason is indistinguishable from a queue being cleared, and the
 * dismissals are the only evidence that a check produces noise. D-005 in particular is
 * expected to be dismissed often, and those dismissals are how anyone would know to retire
 * it.
 */
export async function dismissFinding(
  findingId: string,
  actor: string,
  reason: string,
): Promise<DocumentFinding> {
  const finding = await get<DocumentFinding>('document_findings', { id: findingId });
  if (!finding) {
    throw new ApiError(404, 'NOT_FOUND', `No finding with id '${findingId}'.`);
  }
  if (finding.status !== 'OPEN') {
    throw new ApiError(
      409,
      'ALREADY_REVIEWED',
      `This finding was already ${finding.status.toLowerCase()}.`,
    );
  }

  // Same currency guard as acceptFinding: a finding on a superseded reading must not be
  // reviewable. Dismissing has no `has_uc` side effect, but a dismissal is a record that an
  // officer judged this specific reading's finding to be noise — recording that against a
  // scan the platform has already replaced is a false audit trail, and it would let a stale
  // worklist row (one left OPEN by pre-supersede-closing data) be cleared without re-reading.
  const extraction = await get<DocumentExtraction>('document_extractions', {
    id: finding.extraction_id,
  });
  if (extraction && extraction.superseded_at !== null) {
    throw new ApiError(
      409,
      'EXTRACTION_SUPERSEDED',
      'This finding belongs to a document reading that has since been replaced by a newer ' +
        'extraction. Review the current reading\'s findings instead.',
    );
  }

  const [updated] = await update<DocumentFinding>(
    'document_findings',
    { id: findingId },
    {
      status: 'DISMISSED',
      reviewed_by: actor,
      reviewed_at: nowIso(),
      review_note: reason,
    },
  );

  await appendAudit(actor, 'DOCUMENT_FINDING_DISMISSED', 'work', finding.work_id, {
    finding_id: findingId,
    check_id: finding.check_id,
    severity: finding.severity,
    extraction_id: finding.extraction_id,
    reason,
  });

  return updated ?? { ...finding, status: 'DISMISSED' };
}

/** Open findings across the corpus, most severe first. The document-AI worklist. */
export async function openFindings(limit = 100): Promise<DocumentFinding[]> {
  const rows = await all<DocumentFinding>('document_findings', { where: { status: 'OPEN' } });
  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return rows
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
    .slice(0, limit);
}

/** Re-exported so the router can describe a finding without importing the reconciler. */
export type { Finding };
