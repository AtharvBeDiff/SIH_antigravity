/**
 * Document AI panel — P-04's surface on the work dossier.
 *
 * Three things this component is careful about, all of them things that would be easy to get
 * wrong and hard to notice afterwards:
 *
 * **A null is rendered as "not read", never as a number.** Every extracted field is nullable
 * and null means the model could not read it. A blank cell or a `0` in an amount column would
 * turn a failed reading into a claim about what a certificate says. `field()` below is the
 * only way values reach the screen.
 *
 * **Findings are labelled as not being rule alerts.** They carry `D-0xx` ids, raise no alerts,
 * do not enter the per-district alert budget, and are not scored against the evaluation answer
 * key. The banner says so, because the officer's next question after seeing a red row is
 * "is this one of the measured ones", and the honest answer is no.
 *
 * **Zero findings out of eight checks and zero out of zero are shown differently.** They look
 * identical if you only render `findings.length === 0`, and they mean opposite things: a clean
 * document versus a document nothing could be checked against.
 *
 * The keyless path is the default path. `api.documents.status()` is called before anything is
 * rendered, and when it reports `available: false` the panel shows the server's own reason and
 * disables extraction while leaving upload working — storing a file is useful even when
 * reading it is not configured. Same shape as `AskPage.tsx`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  FileText,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Button, SeverityChip } from '../ui';
import { formatCurrency, formatDate } from '../../lib/utils';
import type {
  DocumentAiStatus,
  DocumentBundle,
  DocumentCheck,
  DocumentExtraction,
  DocumentFinding,
} from '../../types';

/**
 * The kinds an officer can file, with the label shown in the picker. Kept in step with
 * `DOCUMENT_KINDS` in `backend/src/services/document_ai.ts` — a value not in that list gets
 * stored but cannot be read, and the upload response says so via `readable_kind: null`.
 */
const DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'UTILISATION_CERTIFICATE', label: 'Utilisation certificate' },
  { value: 'COMPLETION_CERTIFICATE', label: 'Completion certificate' },
  { value: 'BILL', label: 'Bill / invoice' },
];

/** What the model is allowed to be handed. Mirrors `VISION_MIME_TYPES`. */
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

interface DocumentPanelProps {
  workId: string;
  /** Called after an accepted D-007 finding, which is the one path that writes to `works`. */
  onWorkChanged?: () => void;
}

/**
 * Render an extracted value, or state that it was not read.
 *
 * The em dash is not decoration. It is the difference between "this certificate does not state
 * an amount" — which this component never claims, because it cannot know it — and "the model
 * did not return one", which is what null actually means.
 */
function field(value: string | number | null, kind: 'money' | 'date' | 'text'): React.ReactNode {
  if (value === null || value === '') {
    return <span className="text-slate-400" title="The model did not return this field">—</span>;
  }
  if (kind === 'money' && typeof value === 'number') return formatCurrency(value);
  if (kind === 'date' && typeof value === 'string') return formatDate(value);
  return String(value);
}

/** Read a File as base64 without the data-URL prefix. */
async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked, because spreading a multi-megabyte Uint8Array into String.fromCharCode
  // overflows the argument limit and throws on exactly the file sizes this feature accepts.
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function DocumentPanel({ workId, onWorkChanged }: DocumentPanelProps) {
  const [status, setStatus] = useState<DocumentAiStatus | null>(null);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [bundles, setBundles] = useState<DocumentBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Upload form
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState(DOC_TYPES[0]!.value);
  const [uploading, setUploading] = useState(false);
  const [duplicateNote, setDuplicateNote] = useState<string[]>([]);

  // Per-document extraction state, keyed by document id.
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      setError('');
      const rows = await api.documents.forWork(workId);
      setBundles(rows || []);
    } catch (err: any) {
      setError(err.message || 'Could not load documents for this work.');
    }
  }, [workId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // Capability, catalogue and documents together. The catalogue is what turns a `D-003`
      // in a finding row into a sentence the officer can act on; without it the UI would
      // print an opaque identifier, which is the failure the R-catalogue endpoint exists to
      // prevent for alerts.
      const [statusRes, checksRes] = await Promise.all([
        api.documents.status().catch(() => null),
        api.documents.checks().catch(() => null),
      ]);
      if (cancelled) return;
      setStatus(statusRes);
      if (checksRes?.checks) {
        setChecks(
          Object.fromEntries(checksRes.checks.map((c: DocumentCheck) => [c.id, c.description])),
        );
      }
      await reload();
      if (!cancelled) setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [workId, reload]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    try {
      setUploading(true);
      setError('');
      setDuplicateNote([]);
      const result = await api.documents.upload({
        work_id: workId,
        type: docType,
        filename: file.name,
        content_base64: await toBase64(file),
        content_type: file.type || 'application/pdf',
      });
      // Byte-identical content already filed against other works. Not an error — a re-upload
      // correcting metadata is routine — but the same completion certificate on two works is
      // worth seeing at the moment it happens.
      if (result.duplicate_of?.length) setDuplicateNote(result.duplicate_of);
      setFile(null);
      setShowUpload(false);
      await reload();
    } catch (err: any) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleExtract = async (documentId: string) => {
    try {
      setExtracting((s) => ({ ...s, [documentId]: true }));
      setError('');
      // The response carries `checks_run`, but it is also persisted on the extraction row now
      // (migration 016), so the reload below brings it back with the bundle. Holding a second
      // copy in component state would only shadow the stored one for documents extracted in
      // this browser session — and read `undefined` for every other document on the page.
      await api.documents.extract(documentId);
      await reload();
    } catch (err: any) {
      setError(err.message || 'Extraction failed.');
    } finally {
      setExtracting((s) => ({ ...s, [documentId]: false }));
    }
  };

  const handleAccept = async (finding: DocumentFinding) => {
    try {
      setError('');
      const result = await api.documents.accept(finding.id);
      await reload();
      // Accepting D-007 sets `has_uc`, which gates R-003, so the dossier's own figures are
      // now stale. Ask the parent to refetch rather than patching a local copy.
      if (result.work_updated) onWorkChanged?.();
    } catch (err: any) {
      setError(err.message || 'Could not accept the finding.');
    }
  };

  const handleDismiss = async (finding: DocumentFinding) => {
    // A reason is required by the API. It is the only evidence a check produces noise —
    // D-005 in particular is expected to be dismissed often, and those dismissals are how
    // anyone would know to retire it.
    const reason = window.prompt(
      `Why is ${finding.check_id} not a real discrepancy?\n\n` +
        'Recorded against your name in the audit ledger, and used as the evidence for ' +
        'whether this check is worth keeping.',
    );
    if (reason === null || reason.trim() === '') return;
    try {
      setError('');
      await api.documents.dismiss(finding.id, reason.trim());
      await reload();
    } catch (err: any) {
      setError(err.message || 'Could not dismiss the finding.');
    }
  };

  const openFile = async (documentId: string) => {
    try {
      const { url } = await api.documents.url(documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message || 'Could not produce a link to the stored file.');
    }
  };

  if (loading) {
    return (
      <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Reading the document shelf...
      </div>
    );
  }

  const available = status?.available === true;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-blue-600" />
            <span>Certificates &amp; bills</span>
          </h3>
          {/*
            The tier label comes from the server, verbatim. It says extraction is the AI step
            and the comparison is arithmetic — the claim the feature can actually support.
          */}
          {status?.tier && <p className="text-[11px] text-slate-500">{status.tier}</p>}
        </div>
        <Button
          size="sm"
          onClick={() => setShowUpload((v) => !v)}
          disabled={uploading}
        >
          {showUpload ? 'Close' : '+ File a document'}
        </Button>
      </div>

      {/* Capability, stated plainly rather than discovered on failure. */}
      {!available && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Reading is not configured on this server
          </p>
          <p>{status?.reason ?? 'The status endpoint could not be reached.'}</p>
          <p className="opacity-80">
            Filing a document still works. Only the extraction step is unavailable.
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {duplicateNote.length > 0 && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
          <p className="font-semibold">Byte-identical content is already on file</p>
          <p className="mt-1">
            The same file is filed against {duplicateNote.length} other work
            {duplicateNote.length === 1 ? '' : 's'}: {duplicateNote.join(', ')}. The upload was
            accepted — this is a note, not a rejection.
          </p>
        </div>
      )}

      {showUpload && (
        <form onSubmit={handleUpload} className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Document kind</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              The kind selects which checks run, so it is asked rather than guessed.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">File</label>
            <input
              type="file"
              accept={ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              JPEG, PNG, WebP or PDF, up to{' '}
              {status ? `${Math.floor(status.max_upload_bytes / (1024 * 1024))} MB` : '5 MB'}.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowUpload(false); setFile(null); }}
              className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900"
            >
              Cancel
            </button>
            <Button type="submit" size="sm" disabled={!file || uploading}>
              {uploading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Storing...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Upload className="w-3 h-3" /> Store file
                </span>
              )}
            </Button>
          </div>
        </form>
      )}

      {bundles.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">
          No certificates or bills are on file for this work.
          {' '}
          {/*
            Said explicitly because the dossier's "UC Filed" figure comes from `works.has_uc`,
            a portal flag, and an officer reading YES there could reasonably assume a document
            is behind it. Nothing in e-SAKSHI requires one to be.
          */}
          The portal's UC flag is a field on the work record, not evidence of a stored
          certificate.
        </p>
      ) : (
        <div className="space-y-3">
          {bundles.map((b) => (
            <DocumentRow
              key={b.id}
              bundle={b}
              checks={checks}
              extractionEnabled={available}
              busy={extracting[b.id] === true}
              onExtract={() => handleExtract(b.id)}
              onOpen={() => openFile(b.id)}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DocumentRowProps {
  bundle: DocumentBundle;
  checks: Record<string, string>;
  extractionEnabled: boolean;
  busy: boolean;
  onExtract: () => void;
  onOpen: () => void;
  onAccept: (f: DocumentFinding) => void;
  onDismiss: (f: DocumentFinding) => void;
}

function DocumentRow({
  bundle,
  checks,
  extractionEnabled,
  busy,
  onExtract,
  onOpen,
  onAccept,
  onDismiss,
}: DocumentRowProps) {
  const { extraction } = bundle;
  const open = bundle.findings.filter((f) => f.status === 'OPEN');
  const reviewed = bundle.findings.filter((f) => f.status !== 'OPEN');
  // An ACCEPTED finding is a discrepancy the officer confirmed is real — it must suppress the
  // "no discrepancies" all-clear below. A DISMISSED finding is the opposite (officer judged it
  // not real), so it leaves the all-clear standing. The bundle filters by extraction_id, not
  // status, so ACCEPTED findings of the current extraction stay in the bundle after review.
  const accepted = bundle.findings.filter((f) => f.status === 'ACCEPTED');
  // D-008 is intrinsic to the document — `document_reconcile.ts` stores `portal_value: null` for
  // it, because an internal-consistency concern has nothing on the portal to be compared against.
  // An accepted D-008 must therefore not be described as a mismatch against the record.
  const acceptedVsRecord = accepted.filter((f) => f.portal_value !== null);
  const acceptedIntrinsic = accepted.filter((f) => f.portal_value === null);
  // A dismissed finding leaves the all-clear standing — the officer judged it not real — but the
  // all-clear must not then imply the checks were silent. They were not: they raised something and
  // a person overruled it, which is a different fact and the only evidence a check produces noise.
  const dismissed = bundle.findings.filter((f) => f.status === 'DISMISSED');
  // SUPERSEDED normally means "belongs to an older extraction", and the bundle would not carry it.
  // But `documents.ts` has no transaction: if the rollback after a failed insert restores
  // `superseded_at: null` on this extraction and then fails to flip its findings back to OPEN, a
  // SUPERSEDED finding is stranded on an extraction that is current again. `openFindings()` filters
  // `status === 'OPEN'`, so it appears in no worklist — this panel is the only place it can surface.
  const superseded = bundle.findings.filter((f) => f.status === 'SUPERSEDED');

  // `db.ts` selects '*', and '*' cannot return a column the database does not have. Where
  // migration 016 is unapplied the key is absent, so this reads `undefined`, not `null`, and a
  // strict `!== null` guard would fall straight through to `.length` and throw during render.
  // There is no ErrorBoundary in this app, so that blanks the entire dossier. Migration 008 is
  // unapplied on the live database today — this is a live condition, not a hypothetical.
  const checksRun: string[] | null = Array.isArray(extraction?.checks_run)
    ? extraction.checks_run
    : null;
  // D-008 is intrinsic: it compares the document against itself and carries `portal_value: null`.
  // An extraction where D-008 was the only check that ran verified nothing against the portal, so
  // the all-clear below must not claim a file-versus-record comparison for it.
  const portalChecks = checksRun?.filter((c) => c !== 'D-008') ?? [];
  const intrinsicChecks = checksRun?.filter((c) => c === 'D-008') ?? [];
  // An accepted D-007 is the one finding in the product that writes back to the work: it sets
  // has_uc and uc_date, which ungates R-003 and flips the Expenditure card on the dossier above.
  // The officer's next question after seeing that flag move is "what moved it" — so say it here.
  const acceptedUc = accepted.some((f) => f.check_id === 'D-007');

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="p-3 flex items-start justify-between gap-3 border-b border-slate-100">
        <div className="min-w-0 space-y-0.5">
          <button
            onClick={onOpen}
            className="text-sm font-medium text-slate-900 hover:text-blue-600 flex items-center gap-1.5 text-left"
          >
            <FileText className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{bundle.filename}</span>
          </button>
          <p className="text-[11px] text-slate-500">
            {bundle.type} &middot; filed {formatDate(bundle.uploaded_at)}
            {bundle.size_bytes !== null && ` · ${Math.ceil(bundle.size_bytes / 1024)} KB`}
          </p>
          {bundle.readable_kind === null && (
            <p className="text-[11px] text-amber-700">
              This type names no kind the platform can read, so no checks apply to it.
            </p>
          )}
        </div>

        {bundle.readable_kind !== null && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExtract}
            disabled={!extractionEnabled || busy}
            title={
              extractionEnabled
                ? extraction
                  ? 'Read the file again. The previous reading is kept and marked superseded.'
                  : 'Read the file and compare it against this work'
                : 'No model credential is configured on the server'
            }
          >
            {busy ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Reading...
              </span>
            ) : extraction ? (
              'Re-read'
            ) : (
              'Read document'
            )}
          </Button>
        )}
      </div>

      {extraction === null ? (
        <p className="p-3 text-[11px] text-slate-500">
          Not yet read. Nothing has been extracted from this file, so no comparison against the
          work record has been made.
        </p>
      ) : (
        <ExtractionDetail extraction={extraction} />
      )}

      {/*
        A property of the EXTRACTION, not of the findings, so it is stated independently of them
        — and with an amber icon, because an emerald check over "this is not a clean result" was
        the icon contradicting the sentence beside it.

        Gated on the checks the reconciler actually ran, not on `fields_found`. The gap between
        those two questions is wide here: `sanction_reference`, `work_reference` and
        `signatory_name` all count toward `fields_found` but no D-check reads any of them, so a
        utilisation certificate could read three of its six expected fields, compare nothing, and
        still clear this gate.
      */}
      {extraction !== null && checksRun !== null && checksRun.length === 0 && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            None of the eight checks could run against this file, so nothing was compared with the
            portal record. This is not a clean result.
          </span>
        </div>
      )}

      {/*
        The third state, and the reason the column is nullable. An extraction stored before
        migration 016 — or read back where 016 has not been applied, where the column is absent
        from the row entirely — has no record of which checks ran. Neither the amber block above
        nor the green one below may speak for it: one would claim a measurement nobody took, the
        other would call a document clean on evidence that was never written down.
      */}
      {extraction !== null && checksRun === null && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            This reading predates check recording, so which of the eight checks ran was never
            stored — the findings below are what it produced, but the absence of a finding cannot
            be read as a passed check. Re-extract to record it.
          </span>
        </div>
      )}

      {open.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="px-3 pt-3 pb-1 flex items-center justify-between">
            {/*
              Both quantities, because this is the only count on the card. Counting open findings
              alone understated the document's disagreement with the record in the ordinary state
              where an officer has confirmed some findings and not yet reached the rest.
            */}
            <p className="text-xs font-semibold text-slate-900">
              {open.length} open discrepanc{open.length === 1 ? 'y' : 'ies'} against the portal
              record
              {accepted.length > 0 && `, ${accepted.length} already confirmed on review`}
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {open.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                description={checks[f.check_id]}
                onAccept={() => onAccept(f)}
                onDismiss={() => onDismiss(f)}
              />
            ))}
          </div>
        </div>
      )}

      {/*
        Findings the officer accepted are confirmed real and must never read as "clean". Renders
        whenever any finding is accepted — not only when the open list is empty — because
        "accepted some, not yet all" is the ordinary intermediate state of a review. The checks
        are named inline: the reviewed list below mixes accepted with dismissed findings and
        prints bare ids, so it cannot carry the claim.
      */}
      {extraction !== null && accepted.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            {acceptedVsRecord.length > 0 && (
              <>
                {acceptedVsRecord.length} discrepanc
                {acceptedVsRecord.length === 1 ? 'y' : 'ies'} against the portal record confirmed
                and accepted on review ({acceptedVsRecord.map((f) => f.check_id).join(', ')}).{' '}
              </>
            )}
            {acceptedIntrinsic.length > 0 && (
              <>
                {acceptedIntrinsic.length} finding{acceptedIntrinsic.length === 1 ? '' : 's'} about
                the document's own internal consistency confirmed on review (
                {acceptedIntrinsic.map((f) => f.check_id).join(', ')}) — there is nothing on the
                portal to compare {acceptedIntrinsic.length === 1 ? 'it' : 'them'} against, so
                this is not a record mismatch.{' '}
              </>
            )}
            {acceptedUc
              ? 'Accepting raised no alert, but D-007 was among the accepted findings — that set the UC Filed flag and UC date on this work, which is why the Expenditure card above reads as it does.'
              : 'Accepting raised no alert and changed no work record.'}
          </span>
        </div>
      )}

      {/*
        A finding stamped SUPERSEDED but still attached to the current extraction. The bundle
        filters by `extraction_id`, never by status, so this is what a half-completed rollback in
        `documents.ts` looks like from the officer's side: a real finding that reaches no worklist.
        It must also block the all-clear below, which otherwise fires because it excludes only OPEN
        and ACCEPTED.
      */}
      {extraction !== null && superseded.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            {superseded.length} finding{superseded.length === 1 ? '' : 's'} on this extraction{' '}
            {superseded.length === 1 ? 'is' : 'are'} marked superseded (
            {superseded.map((f) => f.check_id).join(', ')}) even though the extraction itself is
            current. {superseded.length === 1 ? 'It was' : 'They were'} raised by this reading and
            never reviewed, and {superseded.length === 1 ? 'it does' : 'they do'} not appear in the
            worklist. Re-extract the document to resolve the inconsistency.
          </span>
        </div>
      )}

      {/*
        Reached only when at least one check actually ran and no finding is open, accepted, or
        stranded at superseded. Dismissed findings leave this standing. "Nothing could be compared"
        and "nothing was recorded" are their own blocks further up, so this sentence no longer has
        to carry three opposite meanings under one emerald check.

        Split by what each check actually compares. D-008 reads the document against itself, so an
        extraction where it was the only check that ran has verified nothing against the portal —
        both the emerald tick and the phrase "file and the portal record" would be false.
      */}
      {extraction !== null &&
        open.length === 0 &&
        accepted.length === 0 &&
        superseded.length === 0 &&
        checksRun !== null &&
        checksRun.length > 0 && (
          <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
            {portalChecks.length > 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
            )}
            <span className="text-slate-600">
              {portalChecks.length > 0 ? (
                <>
                  No discrepancies between the file and the portal record across the{' '}
                  {portalChecks.length} check{portalChecks.length === 1 ? '' : 's'} that compared
                  them ({portalChecks.join(', ')}).
                  {intrinsicChecks.length > 0 &&
                    ` ${intrinsicChecks.join(', ')} also ran, but reads the document against itself rather than against the record.`}
                </>
              ) : (
                <>
                  The only check that ran ({intrinsicChecks.join(', ')}) reads the document against
                  itself. Nothing in this file was compared with the portal record, so this is not a
                  clean result against the portal.
                </>
              )}
              {dismissed.length > 0 &&
                ` ${dismissed.length} finding${dismissed.length === 1 ? '' : 's'} ${
                  dismissed.length === 1 ? 'was' : 'were'
                } raised and dismissed on review — this reads clean because an officer judged ${
                  dismissed.length === 1 ? 'it' : 'them'
                } not real, not because nothing was flagged.`}
            </span>
          </div>
        )}

      {/*
        The distinction that keeps /evaluation honest. Hoisted out of the open-findings block,
        where it became unreachable once every finding had been reviewed — which is exactly the
        screen where a confirmed finding is most likely to be mistaken for a tracked rule alert.
      */}
      {bundle.findings.length > 0 && (
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
          Document-versus-record comparisons, not catalogued rules. They raise no alerts, do not
          enter the district alert budget, and are not covered by the measured precision on the
          evaluation page.
        </p>
      )}

      {reviewed.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2 space-y-1">
          {reviewed.map((f) => (
            <p key={f.id} className="text-[11px] text-slate-500">
              <span className="font-mono">{f.check_id}</span>{' '}
              {/*
                Three-way, not binary. A binary accepted/dismissed ternary printed a SUPERSEDED
                finding as a dismissal — and `reviewed_by ?? 'unknown'` attributed it to a person.
                A platform whose claim is that every review decision is attributable must not
                invent one: no reviewer means no clause, not the word "unknown".
              */}
              {f.status === 'ACCEPTED'
                ? 'accepted'
                : f.status === 'DISMISSED'
                  ? 'dismissed'
                  : 'superseded by a later reading'}
              {f.reviewed_by && ` by ${f.reviewed_by}`}
              {f.reviewed_at && ` on ${formatDate(f.reviewed_at)}`}
              {f.review_note && ` — "${f.review_note}"`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ExtractionDetail({ extraction }: { extraction: DocumentExtraction }) {
  return (
    <div className="p-3 space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-[11px]">
        <Field label="Certified amount" value={field(extraction.certified_amount, 'money')} />
        <Field label="Certificate date" value={field(extraction.certificate_date, 'date')} />
        <Field label="Sanction reference" value={field(extraction.sanction_reference, 'text')} />
        <Field label="Work reference" value={field(extraction.work_reference, 'text')} />
        <Field label="Agency named" value={field(extraction.agency_named, 'text')} />
        <Field label="Signatory" value={field(extraction.signatory_name, 'text')} />
        {(extraction.period_from !== null || extraction.period_to !== null) && (
          <Field
            label="Period"
            value={
              <>
                {field(extraction.period_from, 'date')} to {field(extraction.period_to, 'date')}
              </>
            }
          />
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        {/*
          Countable completeness in place of a confidence score. A model's self-reported
          confidence has no calibration on this corpus; "5 of 6 fields read" is checkable
          against the document by anyone who opens it.
        */}
        {extraction.fields_found} of {extraction.fields_expected} expected fields read by{' '}
        <span className="font-mono">{extraction.model}</span>
        {extraction.latency_ms !== null && ` in ${(extraction.latency_ms / 1000).toFixed(1)}s`},
        {' '}on {formatDate(extraction.extracted_at)} by {extraction.extracted_by}.
        {/* Array.isArray, not `!== null`: the column is absent (undefined) wherever migration
            016 has not been applied, and `.length` on undefined throws mid-render. */}
        {Array.isArray(extraction.checks_run) &&
          ` ${extraction.checks_run.length} check${extraction.checks_run.length === 1 ? '' : 's'} run.`}
        {' '}A dash means the field was not read, not that the document omits it.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-slate-500">{label}:</span>
      <p className="font-medium text-slate-900 mt-0.5">{value}</p>
    </div>
  );
}

function FindingRow({
  finding,
  description,
  onAccept,
  onDismiss,
}: {
  finding: DocumentFinding;
  description: string | undefined;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <SeverityChip severity={finding.severity} />
        <span className="text-[11px] font-mono text-blue-600">{finding.check_id}</span>
        {/*
          The catalogue description, not just the id. A finding that says "D-001" and nothing
          else is unactionable.
        */}
        {description && <span className="text-[11px] text-slate-500">{description}</span>}
      </div>

      <p className="text-xs text-slate-700">{finding.detail}</p>

      {(finding.document_value !== null || finding.portal_value !== null) && (
        <div className="grid grid-cols-2 gap-3 text-[11px] bg-slate-50 rounded-md p-2">
          <div>
            <span className="text-slate-500">On the document:</span>
            <p className="font-medium text-slate-900">{finding.document_value ?? '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">On the portal:</span>
            <p className="font-medium text-slate-900">{finding.portal_value ?? '—'}</p>
          </div>
        </div>
      )}

      {finding.deviation_pct !== null && (
        <p className="text-[11px] text-slate-500">
          Difference: {finding.deviation_pct.toFixed(1)}%
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onAccept}>
          {/*
            Accepting D-007 is the only path in this feature that writes to `works`. Named
            here so the officer knows the button has a consequence beyond the queue.
          */}
          {finding.check_id === 'D-007' ? 'Accept — record the UC on the work' : 'Accept'}
        </Button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
        >
          <X className="w-3 h-3" /> Dismiss
        </button>
      </div>
    </div>
  );
}
