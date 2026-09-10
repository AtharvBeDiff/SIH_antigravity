/**
 * Photo AI panel — P-06's surface on the work dossier.
 *
 * The photo counterpart of `DocumentPanel`, and it is careful about the same things one
 * modality over:
 *
 * **A null observation is rendered as "not determined", never as a fact.** Every field a
 * vision model returns is nullable, and null means the model could not tell — not that the
 * asset is uncategorised or the site unbuilt. `observed()` below is the only way a reading
 * reaches the screen. The same holds for the EXIF geotag: an absent coordinate is null and is
 * shown as "no geotag", never as `0` — `(0, 0)` is a real point in the ocean.
 *
 * **Findings are labelled as not being rule alerts.** They carry `V-0xx` ids: V-001 is
 * deterministic geotag trigonometry, V-002/003/004 compare a model's blind reading against the
 * record. They raise no alerts, do not enter the per-district alert budget, and are not scored
 * against the evaluation answer key. The banner says so.
 *
 * **Zero findings out of four checks and zero out of zero are shown differently.** A photo the
 * model could read nothing from ran no visual checks; saying "clean" about it would be a claim
 * nobody made.
 *
 * The keyless path is the default path. `api.photos.status()` is called before anything is
 * rendered; when it reports `available: false` the panel shows the server's own reason and
 * disables analysis while leaving upload working — storing a photo is useful even when reading
 * it is not configured. Same shape as `DocumentPanel`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Button, SeverityChip } from '../ui';
import { formatDate } from '../../lib/utils';
import type {
  PhotoAiStatus,
  PhotoAnalysis,
  PhotoBundle,
  PhotoCheck,
  PhotoFinding,
} from '../../types';

/** What the model is allowed to be handed. Mirrors `PHOTO_MIME_TYPES` — images only, no PDF. */
const ACCEPT = 'image/jpeg,image/png,image/webp';

interface PhotoPanelProps {
  workId: string;
}

/**
 * Render an observed value, or state that the model could not determine it.
 *
 * The em dash is the difference between "the model could not tell what this asset is" — which
 * is what null means — and any claim about the asset itself, which this component never makes
 * on the model's behalf.
 */
function observed(value: string | null): React.ReactNode {
  if (value === null || value === '') {
    return (
      <span className="text-slate-400" title="The model could not determine this from the photo">
        —
      </span>
    );
  }
  return String(value);
}

/** Read a File as base64 without the data-URL prefix. */
async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked, because spreading a multi-megabyte Uint8Array into String.fromCharCode overflows
  // the argument limit and throws on exactly the file sizes this feature accepts.
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function PhotoPanel({ workId }: PhotoPanelProps) {
  const [status, setStatus] = useState<PhotoAiStatus | null>(null);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [bundles, setBundles] = useState<PhotoBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Upload form
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [duplicateNote, setDuplicateNote] = useState<string[]>([]);

  // Per-photo analysis state, keyed by photo id.
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      setError('');
      const rows = await api.photos.forWork(workId);
      setBundles(rows || []);
    } catch (err: any) {
      setError(err.message || 'Could not load photos for this work.');
    }
  }, [workId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // Capability, catalogue and photos together. The catalogue turns a "V-001" in a finding
      // row into a sentence the officer can act on; without it the UI prints an opaque id.
      const [statusRes, checksRes] = await Promise.all([
        api.photos.status().catch(() => null),
        api.photos.checks().catch(() => null),
      ]);
      if (cancelled) return;
      setStatus(statusRes);
      if (checksRes?.checks) {
        setChecks(
          Object.fromEntries(checksRes.checks.map((c: PhotoCheck) => [c.id, c.description])),
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
      const result = await api.photos.upload({
        work_id: workId,
        caption: caption.trim() || undefined,
        filename: file.name,
        content_base64: await toBase64(file),
        content_type: file.type || 'image/jpeg',
      });
      // Byte-identical content already filed against other works — the deterministic half of
      // the photo-reuse concern (Doctrine 7). Not an error, but worth seeing at the moment it
      // happens: the same photograph on two works is exactly what an officer should notice.
      if (result.duplicate_of?.length) setDuplicateNote(result.duplicate_of);
      setFile(null);
      setCaption('');
      setShowUpload(false);
      await reload();
    } catch (err: any) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async (photoId: string) => {
    try {
      setAnalyzing((s) => ({ ...s, [photoId]: true }));
      setError('');
      // The response carries `checks_run`, but it is also persisted on the analysis row now
      // (migration 016), so the reload below brings it back with the bundle. Holding a second
      // copy in component state would only shadow the stored one for photos analysed in this
      // browser session — and read `undefined` for every other photo on the page.
      await api.photos.analyze(photoId);
      await reload();
    } catch (err: any) {
      setError(err.message || 'Analysis failed.');
    } finally {
      setAnalyzing((s) => ({ ...s, [photoId]: false }));
    }
  };

  const handleAccept = async (finding: PhotoFinding) => {
    try {
      setError('');
      await api.photos.accept(finding.id);
      await reload();
    } catch (err: any) {
      setError(err.message || 'Could not accept the finding.');
    }
  };

  const handleDismiss = async (finding: PhotoFinding) => {
    // A reason is required by the API. It is the only evidence a check produces noise — V-002
    // and the softer geotag tier are expected to be dismissed often, and those dismissals are
    // how anyone would know to tune them.
    const reason = window.prompt(
      `Why is ${finding.check_id} not a real discrepancy?\n\n` +
        'Recorded against your name in the audit ledger, and used as the evidence for whether ' +
        'this check is worth keeping.',
    );
    if (reason === null || reason.trim() === '') return;
    try {
      setError('');
      await api.photos.dismiss(finding.id, reason.trim());
      await reload();
    } catch (err: any) {
      setError(err.message || 'Could not dismiss the finding.');
    }
  };

  if (loading) {
    return (
      <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Reading the photo shelf...
      </div>
    );
  }

  const available = status?.available === true;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-600" />
            <span>Evidence photographs</span>
          </h3>
          {/*
            The tier label comes from the server, verbatim. It says the reading is the AI step
            and the geotag check alongside it is deterministic — the claim the feature supports.
          */}
          {status?.tier && <p className="text-[11px] text-slate-500">{status.tier}</p>}
        </div>
        <Button size="sm" onClick={() => setShowUpload((v) => !v)} disabled={uploading}>
          {showUpload ? 'Close' : '+ Add a photo'}
        </Button>
      </div>

      {/* Capability, stated plainly rather than discovered on failure. */}
      {!available && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Analysis is not configured on this server
          </p>
          <p>{status?.reason ?? 'The status endpoint could not be reached.'}</p>
          <p className="opacity-80">
            Adding a photo still works, and its geotag is still read on upload. Only the model
            analysis step is unavailable.
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
          <p className="font-semibold">This exact image is already on file</p>
          <p className="mt-1">
            The same photograph (byte-for-byte) is filed against {duplicateNote.length} other
            work{duplicateNote.length === 1 ? '' : 's'}: {duplicateNote.join(', ')}. The upload
            was accepted — this is a note, not a rejection — but the same photo standing in for
            two different works is worth a look.
          </p>
        </div>
      )}

      {showUpload && (
        <form
          onSubmit={handleUpload}
          className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Photo</label>
            <input
              type="file"
              accept={ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              JPEG, PNG or WebP, up to{' '}
              {status ? `${Math.floor(status.max_upload_bytes / (1024 * 1024))} MB` : '5 MB'}. Its
              geotag and capture time, if present, are read on upload.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Caption <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="e.g. north elevation, handpump ward 4"
              className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowUpload(false);
                setFile(null);
                setCaption('');
              }}
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
                  <Upload className="w-3 h-3" /> Store photo
                </span>
              )}
            </Button>
          </div>
        </form>
      )}

      {bundles.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">
          No photographs are on file for this work. Evidence photos are uploaded here by an
          officer — they are not drawn from e-SAKSHI.
        </p>
      ) : (
        <div className="space-y-3">
          {bundles.map((b) => (
            <PhotoRow
              key={b.id}
              bundle={b}
              checks={checks}
              analysisEnabled={available}
              busy={analyzing[b.id] === true}
              onAnalyze={() => handleAnalyze(b.id)}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PhotoRowProps {
  bundle: PhotoBundle;
  checks: Record<string, string>;
  analysisEnabled: boolean;
  busy: boolean;
  onAnalyze: () => void;
  onAccept: (f: PhotoFinding) => void;
  onDismiss: (f: PhotoFinding) => void;
}

function PhotoRow({
  bundle,
  checks,
  analysisEnabled,
  busy,
  onAnalyze,
  onAccept,
  onDismiss,
}: PhotoRowProps) {
  const { analysis } = bundle;
  const open = bundle.findings.filter((f) => f.status === 'OPEN');
  const reviewed = bundle.findings.filter((f) => f.status !== 'OPEN');
  // A finding the officer ACCEPTED is a confirmed real discrepancy that is still true of this
  // analysis — the bundle keeps it (filtered by `analysis_id`, not by status). It must suppress
  // the "no discrepancies" all-clear below, or the panel affirms cleanliness in the same breath
  // as the "accepted" line for the very discrepancy that was just confirmed. A DISMISSED finding
  // is the opposite — the officer judged it not real — so it leaves the all-clear standing.
  const accepted = bundle.findings.filter((f) => f.status === 'ACCEPTED');
  // V-004 is intrinsic to the image: `photo_reconcile.ts` stores `portal_value: null` for it
  // because there is nothing on the portal to compare an authenticity concern against. Saying
  // "does not match the work record" about an accepted V-004 would assert a comparison that was
  // never performed, so the two kinds are counted and worded separately below.
  const acceptedVsRecord = accepted.filter((f) => f.portal_value !== null);
  const acceptedIntrinsic = accepted.filter((f) => f.portal_value === null);
  // A dismissed finding leaves the all-clear standing — the officer judged it not real — but the
  // all-clear must not then imply the checks were silent. They were not: they raised something and
  // a person overruled it, which is a different fact and the only evidence a check produces noise.
  const dismissed = bundle.findings.filter((f) => f.status === 'DISMISSED');
  // SUPERSEDED normally means "belongs to an older reading", and the bundle would not carry it.
  // But `photos.ts` has no transaction: if the rollback that follows a failed insert restores
  // `superseded_at: null` on this analysis and then fails to flip its findings back to OPEN, a
  // SUPERSEDED finding is left sitting on a reading that is current again. It is invisible to the
  // worklist (which filters `status === 'OPEN'`), so the panel is the only place it can surface —
  // and it must at minimum stop the all-clear from rendering over the top of it.
  const superseded = bundle.findings.filter((f) => f.status === 'SUPERSEDED');

  // `db.ts` selects '*', and '*' cannot return a column the database does not have. On a
  // deployment where migration 016 has not been applied the key is simply absent, so this reads
  // `undefined`, not `null` — and a strict `!== null` guard would sail past it into `.length` and
  // throw during render. There is no ErrorBoundary in this app, so that unmounts the root and
  // blanks the whole dossier. Migration 008 is unapplied on the live database today, so "code
  // ahead of migrations" is the normal condition here, not a hypothetical.
  const checksRun: string[] | null = Array.isArray(analysis?.checks_run)
    ? analysis.checks_run
    : null;
  // V-004 is intrinsic: `photo_reconcile.ts` gives it `portal_value: null` because there is
  // nothing on the portal to compare an authenticity concern against. A reading where V-004 was
  // the only check that ran compared the image with itself and nothing with the work record, so
  // the two subsets are counted separately — the same split the accepted-findings block makes.
  const portalChecks = checksRun?.filter((c) => c !== 'V-004') ?? [];
  const intrinsicChecks = checksRun?.filter((c) => c === 'V-004') ?? [];

  // The image is signed on demand, not on load: an officer viewing a work should not mint a
  // signed URL for every photo before deciding to look at any.
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState('');

  const toggleImage = async () => {
    if (imgUrl !== null) {
      setImgUrl(null);
      return;
    }
    try {
      setImgLoading(true);
      setImgError('');
      const { url } = await api.photos.url(bundle.id);
      setImgUrl(url);
    } catch (err: any) {
      setImgError(err.message || 'Could not produce a link to the stored image.');
    } finally {
      setImgLoading(false);
    }
  };

  const hasGeotag = bundle.exif_latitude !== null && bundle.exif_longitude !== null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="p-3 flex items-start justify-between gap-3 border-b border-slate-100">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-slate-900 truncate">
            {bundle.caption ?? <span className="text-slate-500 italic">Untitled photo</span>}
          </p>
          <p className="text-[11px] text-slate-500">
            Added {formatDate(bundle.uploaded_at)}
            {bundle.size_bytes !== null && ` · ${Math.ceil(bundle.size_bytes / 1024)} KB`}
            {bundle.exif_taken_at && ` · taken ${formatDate(bundle.exif_taken_at)}`}
          </p>
          {/*
            The geotag, read deterministically at upload. Absent means the image carried no
            location (every messaging app strips it) — shown as such, never as (0, 0).
          */}
          <p className="text-[11px] flex items-center gap-1 text-slate-500">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            {hasGeotag ? (
              <a
                href={`https://www.openstreetmap.org/?mlat=${bundle.exif_latitude}&mlon=${bundle.exif_longitude}#map=17/${bundle.exif_latitude}/${bundle.exif_longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {bundle.exif_latitude!.toFixed(5)}, {bundle.exif_longitude!.toFixed(5)}
              </a>
            ) : (
              <span className="text-slate-400">No geotag on this image</span>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onAnalyze}
            disabled={!analysisEnabled || busy}
            title={
              analysisEnabled
                ? analysis
                  ? 'Read the photo again. The previous reading is kept and marked superseded.'
                  : 'Read the photo and compare it against this work'
                : 'No model credential is configured on the server'
            }
          >
            {busy ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Reading...
              </span>
            ) : analysis ? (
              'Re-analyse'
            ) : (
              'Analyse photo'
            )}
          </Button>
          <button
            onClick={toggleImage}
            disabled={imgLoading}
            className="text-[11px] text-slate-500 hover:text-slate-900 flex items-center gap-1"
          >
            {imgLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : imgUrl !== null ? (
              <EyeOff className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            {imgUrl !== null ? 'Hide' : 'View'}
          </button>
        </div>
      </div>

      {imgError && <p className="px-3 pt-2 text-[11px] text-red-700">{imgError}</p>}

      {imgUrl !== null && (
        <div className="border-b border-slate-100 bg-slate-900/5 p-3">
          <img
            src={imgUrl}
            alt={bundle.caption ?? 'Evidence photograph'}
            className="max-h-96 w-auto mx-auto rounded-md"
          />
        </div>
      )}

      {analysis === null ? (
        <p className="p-3 text-[11px] text-slate-500">
          Not yet analysed. Nothing has been read from this photo, so no comparison against the
          work record has been made.
        </p>
      ) : (
        <AnalysisDetail analysis={analysis} />
      )}

      {/*
        A property of the READING, not of the findings, so it is stated independently of them.
        This caveat used to live inside the all-clear block, which meant it vanished the moment
        any finding existed — so a photo nothing could be checked against, carrying one accepted
        geotag finding, said nothing at all about the checks that never ran.

        Gated on the checks the reconciler actually ran, not on `fields_found`. The two answer
        different questions: `asset_description` counts toward `fields_found` but no check reads
        it, so a photo the model only described scored 1 and claimed a comparison that never
        happened; and V-001 compares the EXIF geotag with no reading at all, so `fields_found = 0`
        never meant nothing ran either.
      */}
      {analysis !== null && checksRun !== null && checksRun.length === 0 && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            None of the four checks could run against this photo, so nothing was compared with the
            work record. This is not a clean result.
          </span>
        </div>
      )}

      {/*
        The third state, and the reason the column is nullable. A reading stored before migration
        016 — or read back on a deployment where 016 has not been applied, where the column is
        absent from the row entirely — has no record of which checks ran. Neither the amber block
        above nor the green one below may speak for it: one would claim a measurement nobody took,
        the other would call a photo clean on evidence that was never written down.
      */}
      {analysis !== null && checksRun === null && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            This reading predates check recording, so which of the four checks ran was never
            stored — the findings below are what it produced, but the absence of a finding cannot
            be read as a passed check. Re-analyse to record it.
          </span>
        </div>
      )}

      {open.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="px-3 pt-3 pb-1">
            {/*
              Both quantities, because this is the only count on the card. Counting open findings
              alone understated the photo's disagreement with the record in the ordinary state
              where an officer has confirmed some findings and not yet reached the rest — and the
              confirmed ones are the ones most certainly against the record.
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
        Findings the officer accepted are confirmed real and must never read as "clean". This
        renders whenever any finding is accepted — not only when the open list is empty — because
        "accepted some, not yet all" is the ordinary intermediate state of a review.

        The checks are named inline rather than deferred to "the list below": that list mixes
        accepted with dismissed findings and prints bare check ids, so it cannot carry the claim.
      */}
      {analysis !== null && accepted.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            {acceptedVsRecord.length > 0 && (
              <>
                {acceptedVsRecord.length} discrepanc
                {acceptedVsRecord.length === 1 ? 'y' : 'ies'} against the work record confirmed and
                accepted on review ({acceptedVsRecord.map((f) => f.check_id).join(', ')}).{' '}
              </>
            )}
            {acceptedIntrinsic.length > 0 && (
              <>
                {acceptedIntrinsic.length} finding{acceptedIntrinsic.length === 1 ? '' : 's'} about
                the image itself confirmed as warranting a human look (
                {acceptedIntrinsic.map((f) => f.check_id).join(', ')}) — there is nothing on the
                portal to compare {acceptedIntrinsic.length === 1 ? 'it' : 'them'} against, so
                this is not a record mismatch.{' '}
              </>
            )}
            Accepting raised no alert and changed no work record.
          </span>
        </div>
      )}

      {/*
        A finding stamped SUPERSEDED but still attached to the current reading. The bundle filters
        by `analysis_id`, never by status, so this is what a half-completed rollback in `photos.ts`
        looks like from the officer's side: a real finding that no longer appears in any worklist.
        Surfacing it is the whole point — but it also has to block the all-clear below, which
        otherwise renders because it only excludes OPEN and ACCEPTED.
      */}
      {analysis !== null && superseded.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2.5 flex items-start gap-2 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            {superseded.length} finding{superseded.length === 1 ? '' : 's'} on this reading{' '}
            {superseded.length === 1 ? 'is' : 'are'} marked superseded (
            {superseded.map((f) => f.check_id).join(', ')}) even though the reading itself is
            current. {superseded.length === 1 ? 'It was' : 'They were'} raised by this analysis and
            never reviewed, and {superseded.length === 1 ? 'it does' : 'they do'} not appear in the
            worklist. Re-analyse the photo to resolve the inconsistency.
          </span>
        </div>
      )}

      {/*
        Reached only when at least one check actually ran and no finding is open, accepted, or
        stranded at superseded. Dismissed findings (the officer judged them not real) leave this
        standing. "Nothing could be compared" and "nothing was recorded" are now their own blocks
        further up, so this sentence no longer has to carry three opposite meanings under one
        emerald check.

        Split by what each check actually compares. V-004 examines the image alone, so a reading
        where it was the only check that ran has verified nothing against the portal record — the
        emerald tick and the phrase "no discrepancies with the work record" would both be false.

        V-004 needs care beyond that. It is gated on a non-null `integrity_concern`, and a NONE
        from the model is folded to null in `photo_ai.ts`, so V-004 only ever appears in
        `checks_run` when it actually raised a finding. Reaching this block at all means that
        finding was dismissed — so this must not say V-004 "raised nothing".
      */}
      {analysis !== null &&
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
                  No discrepancies between the reading and the work record across the{' '}
                  {portalChecks.length} check{portalChecks.length === 1 ? '' : 's'} that compared
                  them ({portalChecks.join(', ')}).
                  {intrinsicChecks.length > 0 &&
                    ` ${intrinsicChecks.join(', ')} also ran, but examines the image itself rather than the record.`}
                </>
              ) : (
                <>
                  The only check that ran ({intrinsicChecks.join(', ')}) examines the image itself.
                  Nothing on this reading was compared with the work record, so this is not a clean
                  result against the portal.
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
          Photo-versus-record comparisons, not catalogued rules. They raise no alerts, do not enter
          the district alert budget, and are not covered by the measured precision on the
          evaluation page.
        </p>
      )}

      {reviewed.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2 space-y-1">
          {reviewed.map((f) => (
            <p key={f.id} className="text-[11px] text-slate-500">
              <span className="font-mono">{f.check_id}</span>{' '}
              {f.status === 'ACCEPTED'
                ? 'accepted'
                : f.status === 'DISMISSED'
                  ? 'dismissed'
                  : 'superseded'}
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

function AnalysisDetail({ analysis }: { analysis: PhotoAnalysis }) {
  // POSSIBLE or LIKELY only. A NONE from the model is folded to null server-side ('none' is a
  // NULL_SENTINEL in photo_ai.ts), which is exactly why there is no third branch below.
  const concern = analysis.integrity_concern;

  return (
    <div className="p-3 space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-[11px]">
        <Field label="Asset seen" value={observed(analysis.asset_category)} />
        <Field label="Construction stage" value={observed(analysis.construction_stage)} />
        <Field label="Description" value={observed(analysis.asset_description)} />
      </div>

      {/*
        Integrity is its own block, not a table cell. A raised concern (V-004, capped at MEDIUM)
        is a prompt for a human look, explicitly not a determination that the photo is fake.
      */}
      {concern === 'POSSIBLE' || concern === 'LIKELY' ? (
        <div
          className={`flex items-start gap-2 rounded-md p-2 text-[11px] ${
            concern === 'LIKELY'
              ? 'bg-red-50 text-red-800'
              : 'bg-amber-50 text-amber-900'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">Integrity concern: {concern.toLowerCase()}.</span>{' '}
            {analysis.integrity_note ??
              'The reading flagged this photo for a human look. It is not a determination that the image is fake.'}
          </span>
        </div>
      ) : (
        /*
          One branch, not two, because the database cannot distinguish the two cases. 'none' is a
          NULL_SENTINEL in photo_ai.ts, so a model that assessed the image and found nothing stores
          the same null as a model that never assessed it at all. Every available proxy is a guess:
          `checks_run.includes('V-004')` reads "assessed, clean" as "not assessed" and would print
          a caveat over every clean photo, while `fields_found > 0` reads "described the asset but
          skipped integrity" as "assessed, clean" — and that case is reachable, printing this line
          directly beneath the card's own "none of the four checks could run" block. So the line
          claims only what is true under either reading, and says so.
        */
        <p className="text-[11px] text-slate-500">
          The reading recorded no integrity concern. A reading that assessed the image and found
          nothing and one that never assessed it store the same value here, so this is not an
          authenticity clearance.
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        {/*
          Countable completeness in place of a confidence score. A clean, fully-read photo reads
          at most three of four dimensions, because a folded (null) integrity concern is not
          counted — so "3 of 4" is not a shortfall.
        */}
        {analysis.fields_found} of {analysis.fields_expected} dimensions read by{' '}
        <span className="font-mono">{analysis.model}</span>
        {analysis.latency_ms !== null && ` in ${(analysis.latency_ms / 1000).toFixed(1)}s`}, on{' '}
        {formatDate(analysis.analyzed_at)} by {analysis.analyzed_by}.
        {/* Array.isArray, not `!== null`: the column is absent (undefined) wherever migration
            016 has not been applied, and `.length` on undefined throws mid-render. */}
        {Array.isArray(analysis.checks_run) &&
          ` ${analysis.checks_run.length} check${analysis.checks_run.length === 1 ? '' : 's'} run.`}{' '}
        A dash means the model could not determine that dimension.
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
  finding: PhotoFinding;
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
          The catalogue description, not just the id. A finding that says "V-001" and nothing
          else is unactionable.
        */}
        {description && <span className="text-[11px] text-slate-500">{description}</span>}
      </div>

      <p className="text-xs text-slate-700">{finding.detail}</p>

      {(finding.observed_value !== null || finding.portal_value !== null) && (
        <div className="grid grid-cols-2 gap-3 text-[11px] bg-slate-50 rounded-md p-2">
          <div>
            <span className="text-slate-500">In the photo:</span>
            <p className="font-medium text-slate-900">{finding.observed_value ?? '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">On the portal:</span>
            <p className="font-medium text-slate-900">{finding.portal_value ?? '—'}</p>
          </div>
        </div>
      )}

      {/*
        Only V-001 carries a magnitude, and it is a distance in metres — not a percentage. It is
        labelled as metres so it is never read as one.
      */}
      {finding.deviation !== null && (
        <p className="text-[11px] text-slate-500">
          Distance from the work's recorded location:{' '}
          {finding.deviation >= 1000
            ? `${(finding.deviation / 1000).toFixed(1)} km`
            : `${Math.round(finding.deviation)} m`}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onAccept}>
          Accept
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
