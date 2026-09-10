/**
 * Inspection evidence panel — P-10's surface on the work dossier.
 *
 * The third of the three evidence panels, beside `DocumentPanel` and `PhotoPanel`, and the one
 * with the sharpest claim: **an inspector stood at the site and wrote down what they saw, and
 * until now nothing compared that against what the work record says.** A work could read
 * COMPLETED on every list in this product while an inspection filed against it said
 * WORK_NOT_STARTED, because the inspection sat beside the record instead of being checked
 * against it. This panel is where that comparison surfaces.
 *
 * Four things it is careful about, all of them easy to erode:
 *
 * **A comparison that was never run is not a clean comparison.** `comparison === null` means
 * nobody pressed the button. It renders as an absence, never as an all-clear.
 *
 * **Zero findings out of four checks and zero out of zero mean opposite things.** `checks_run`
 * carries which I-checks were *able* to run — an inspection with no GPS fix and no geotagged
 * photographs can be compared on almost nothing, and calling that "no discrepancies" would be a
 * claim nobody made. All three states of that column are branched on below, `Array.isArray()`
 * rather than `!== null`, because that guard absorbs both the SQL NULL the nullable column
 * permits and the `undefined` that `db.ts`'s `select('*')` yields for a column the database does
 * not have — `.length` on either throws mid-render, and there is no ErrorBoundary in this app,
 * so one bad row would blank the entire dossier rather than this panel.
 *
 * **The unit is read off the row, never inferred from the check id.** Two checks measure a
 * distance in metres and one measures a lag in days over the same `deviation` column. A panel
 * that guessed from `check_id` would print "40 days" as "40 metres" the first time a check id
 * moved.
 *
 * **The record side names a column, never a person.** `record_source` is
 * `works.status`, `work_photos.exif_latitude/exif_longitude` and so on. Nothing here says an
 * agency, an officer or any elected representative claimed anything: no column records who
 * entered a work's status, so attributing it would be a fabrication — and Doctrine 3 puts
 * accountability on the work and its implementing agency regardless.
 *
 * Findings carry `I-0xx` ids. They raise no alerts, do not enter the per-district alert budget,
 * carry no verification_status, and are not scored against the evaluation answer key. The
 * footer says so.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Button, SeverityChip } from '../ui';
import { formatDate } from '../../lib/utils';
import type { InspectionEvidenceBundle, InspectionFinding } from '../../types';

interface InspectionEvidencePanelProps {
  workId: string;
}

/**
 * Render a `deviation` in the unit the row says it is in.
 *
 * `unit` comes from `inspection_findings.deviation_unit`, not from the check id. When it is
 * missing — a row written before the column existed, or a check that grew a magnitude without a
 * unit — the number is shown bare and labelled as unitless rather than assumed to be metres.
 * A wrong unit is worse than no unit: "412" reads as a rounding error, "412 metres" reads as a
 * fact.
 */
function formatDeviation(value: number, unit: string | null): string {
  if (unit === 'METRES') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
  }
  if (unit === 'DAYS') {
    return `${Math.round(value)} day${Math.round(value) === 1 ? '' : 's'}`;
  }
  return `${value} (unit not recorded)`;
}

/** The label for the magnitude, again driven by the stored unit rather than the check id. */
function deviationLabel(unit: string | null): string {
  if (unit === 'METRES') return 'Distance between the two locations';
  if (unit === 'DAYS') return 'Gap between the two dates';
  return 'Measured gap';
}

export function InspectionEvidencePanel({ workId }: InspectionEvidencePanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [tier, setTier] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  /** check id → one-line description, so a finding can say more than "I-001". */
  const [catalogue, setCatalogue] = useState<Record<string, string>>({});
  const [bundles, setBundles] = useState<InspectionEvidenceBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comparing, setComparing] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      setError('');
      const rows = await api.inspections.evidenceForWork(workId);
      setBundles(rows || []);
    } catch (err: any) {
      setError(err.message || 'Could not load inspections for this work.');
    }
  }, [workId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // One call, not two: unlike `/api/photos/status`, the inspection status response already
      // carries the whole I-catalogue, so fetching `/inspections/checks` as well would be a
      // second round trip for a payload we already hold. The endpoint still exists and is still
      // in the API client — this panel simply does not need it.
      const statusRes = await api.inspections.status().catch(() => null);
      if (cancelled) return;
      if (statusRes) {
        setAvailable(statusRes.available === true);
        setTier(statusRes.tier ?? '');
        setReason(statusRes.reason ?? null);
        setCatalogue(Object.fromEntries((statusRes.checks ?? []).map((c) => [c.id, c.description])));
      } else {
        // The status call is how the panel learns whether comparison can run. If it could not be
        // reached, that is unknown — not available, and not unavailable either.
        setAvailable(null);
      }
      await reload();
      if (!cancelled) setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [workId, reload]);

  const handleCompare = async (inspectionId: string) => {
    try {
      setComparing((s) => ({ ...s, [inspectionId]: true }));
      setError('');
      // The response carries `comparison`, `findings` and `checks_run`, but all three are
      // persisted (migration 017) and come back with the bundle on reload. Holding a second copy
      // in component state would shadow the stored one for inspections compared in this browser
      // session and read `undefined` for every other row on the page.
      await api.inspections.compare(inspectionId);
      await reload();
    } catch (err: any) {
      setError(err.message || 'The comparison could not be run.');
    } finally {
      setComparing((s) => ({ ...s, [inspectionId]: false }));
    }
  };

  const handleAccept = async (finding: InspectionFinding) => {
    try {
      setError('');
      await api.inspections.acceptFinding(finding.id);
      await reload();
    } catch (err: any) {
      setError(err.message || 'Could not accept the finding.');
    }
  };

  const handleDismiss = async (finding: InspectionFinding) => {
    // A reason is required by the API. Dismissals are the only evidence a check produces noise —
    // I-001 is expected to be dismissed on large or linear sites, and that record is how anyone
    // would know to widen its tolerance.
    const reasonText = window.prompt(
      `Why is ${finding.check_id} not a real discrepancy?\n\n` +
        'Recorded against your name in the audit ledger, and used as the evidence for whether ' +
        'this check is worth keeping.',
    );
    if (reasonText === null || reasonText.trim() === '') return;
    try {
      setError('');
      await api.inspections.dismissFinding(finding.id, reasonText.trim());
      await reload();
    } catch (err: any) {
      setError(err.message || 'Could not dismiss the finding.');
    }
  };

  if (loading) {
    return (
      <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Reading the inspection record...
      </div>
    );
  }

  const catalogueIds = Object.keys(catalogue);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-blue-600" />
          <span>Inspector evidence vs the work record</span>
        </h3>
        {/*
          The tier label, verbatim from the server. It says this is deterministic arithmetic over
          values already on record — no model is consulted — which is the claim the feature
          supports and the reason it works with no credential configured.
        */}
        {tier && <p className="text-[11px] text-slate-500">{tier}</p>}
      </div>

      {/*
        Stated plainly rather than discovered on failure, the same discipline as the document and
        photo panels. `available` is unconditionally true server-side, so in practice this renders
        only when the status endpoint could not be reached at all — and it says that, rather than
        asserting the feature is switched off.
      */}
      {available !== true && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {available === null
              ? 'Could not confirm that comparison is available on this server'
              : 'Comparison is not available on this server'}
          </p>
          <p>
            {reason ??
              'The status endpoint could not be reached. Running a comparison may still work — ' +
                'it needs no model and no credential — but nothing has confirmed that.'}
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {/*
        Gated on `!error`, and that gate is the whole point. `reload()` catches a failed fetch into
        `error` and leaves `bundles` at its initial `[]`, so without this the panel would fall
        through to the sentence below and state, as fact, that no inspection has been filed —
        a specific claim about the corpus that nothing established. The query failed; the panel
        does not know what is in there. The red strip above says the read failed, but it does not
        repair a false sentence printed underneath it.
      */}
      {error ? null : bundles.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">
          No inspection has been filed against this work. Nothing has been compared with the
          record — which is an absence of evidence, not a clean result.
        </p>
      ) : (
        <div className="space-y-3">
          {bundles.map((b) => (
            <InspectionRow
              key={b.id}
              bundle={b}
              catalogue={catalogue}
              catalogueIds={catalogueIds}
              busy={comparing[b.id] === true}
              onCompare={() => handleCompare(b.id)}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      {/*
        The distinction that keeps /evaluation honest, stated once for the panel rather than per
        row. Rendered whenever there is anything at all here, not only when a finding exists — an
        officer looking at a compared-and-clean inspection is exactly as entitled to know that
        this queue is not the alert queue.
      */}
      {bundles.length > 0 && (
        <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
          Inspection-versus-record comparisons, not catalogued rules. They raise no alerts, do not
          enter the district alert budget, and are not covered by the measured precision on the
          evaluation page. Accepting one records your judgement and changes no work record — the
          correction to the record belongs in e-SAKSHI.
        </p>
      )}
    </div>
  );
}

interface InspectionRowProps {
  bundle: InspectionEvidenceBundle;
  catalogue: Record<string, string>;
  catalogueIds: string[];
  busy: boolean;
  onCompare: () => void;
  onAccept: (f: InspectionFinding) => void;
  onDismiss: (f: InspectionFinding) => void;
}

function InspectionRow({
  bundle,
  catalogue,
  catalogueIds,
  busy,
  onCompare,
  onAccept,
  onDismiss,
}: InspectionRowProps) {
  const { comparison } = bundle;
  const open = bundle.findings.filter((f) => f.status === 'OPEN');
  const accepted = bundle.findings.filter((f) => f.status === 'ACCEPTED');
  const dismissed = bundle.findings.filter((f) => f.status === 'DISMISSED');
  // SUPERSEDED normally means "belongs to an older comparison", and the bundle carries only the
  // current comparison's findings. But `inspection_compare.ts` has no transaction: if the
  // rollback after a failed insert restores `superseded_at: null` on a comparison and then fails
  // to flip its findings back to OPEN, a SUPERSEDED finding is left on a comparison that is
  // current again. It is invisible to the worklist (which filters on `status === 'OPEN'`), so
  // this panel is the only place it can surface — and it must at minimum stop the all-clear
  // below from rendering over the top of it.
  const superseded = bundle.findings.filter((f) => f.status === 'SUPERSEDED');
  const reviewed = bundle.findings.filter((f) => f.status !== 'OPEN');

  // Array.isArray, not `!== null`. The column is nullable by design — migration 017 gives it no
  // NOT NULL and deliberately no DEFAULT — so any row written by something other than
  // `compareInspection` (a backfill, a data repair, a future migration) carries SQL NULL, and a
  // strict `!== null` guard would sail past an `undefined` into `.length` and throw during
  // render. There is no ErrorBoundary in this app, so that unmounts the whole dossier. It is also
  // the same guard the photo panel uses, where `undefined` is not hypothetical at all: migration
  // 016 added `checks_run` to an existing `photo_analyses` table, and `db.ts` selects '*', which
  // cannot return a column the database does not have. One idiom across all three panels.
  const checksRun: string[] | null = Array.isArray(comparison?.checks_run)
    ? comparison.checks_run
    : null;
  // Which catalogued checks did NOT run. Named rather than counted, and derived from the
  // server's own catalogue rather than a hard-coded "four" — a fifth check added tomorrow shows
  // up here without touching this file.
  const didNotRun = checksRun === null ? [] : catalogueIds.filter((id) => !checksRun.includes(id));
  // …but an empty `didNotRun` means "everything ran" only if we know what everything is. When
  // the status call failed the catalogue is `{}`, so `didNotRun` is empty for the wrong reason,
  // and a green tick would be claiming full coverage off a number nobody measured.
  const coverageKnown = catalogueIds.length > 0;

  const hasGps = bundle.latitude != null && bundle.longitude != null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="p-3 flex items-start justify-between gap-3 border-b border-slate-100">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-slate-900">
            Inspected {formatDate(bundle.inspection_date)} — recorded status{' '}
            <span className="font-mono text-xs">{bundle.overall_status}</span>
          </p>
          <p
            className="text-[11px] text-slate-500"
            title="The inspector's name as recorded on the inspection. It is not authenticated — see the API contract §11."
          >
            Filed by {bundle.inspector_name}
            {bundle.synced === false && ' · not yet synced'}
          </p>
          {/*
            The inspector's own GPS fix. Absent means the device recorded no location — shown as
            such, never as (0, 0), which is a real point in the ocean.
          */}
          <p className="text-[11px] flex items-center gap-1 text-slate-500">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            {hasGps ? (
              <a
                href={`https://www.openstreetmap.org/?mlat=${bundle.latitude}&mlon=${bundle.longitude}#map=17/${bundle.latitude}/${bundle.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {bundle.latitude.toFixed(5)}, {bundle.longitude.toFixed(5)}
              </a>
            ) : (
              <span className="text-slate-400">No location recorded on this inspection</span>
            )}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onCompare}
          disabled={busy}
          title={
            comparison
              ? 'Compare again. The previous comparison is kept and marked superseded.'
              : 'Compare what the inspector recorded against the work record and its photographs'
          }
        >
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Comparing...
            </span>
          ) : comparison ? (
            'Compare again'
          ) : (
            'Compare with the record'
          )}
        </Button>
      </div>

      {comparison === null ? (
        <p className="p-3 text-[11px] text-slate-500">
          This inspection has not been compared with the work record. Nothing has been checked, so
          nothing here is clean — press <span className="font-medium">Compare with the record</span>{' '}
          to run the checks.
        </p>
      ) : (
        <>
          {/*
            The corpus the comparison had, counted at comparison time. Three numbers rather than
            one, because "no photographs at all" and "photographs, none of them geotagged" fail
            different checks, and an officer reading a clean result deserves to know which.
          */}
          <p className="px-3 pt-3 text-[11px] text-slate-500">
            Compared against {comparison.photos_on_record} photograph
            {comparison.photos_on_record === 1 ? '' : 's'} on this work
            {comparison.photos_on_record > 0 && (
              <>
                {' '}
                ({comparison.photos_with_geotag} geotagged, {comparison.photos_with_timestamp} with
                a capture time)
              </>
            )}
            , on {formatDate(comparison.compared_at)} by {comparison.compared_by}.
          </p>

          {/*
            State one of three: measured, and nothing could be compared. The counts above explain
            why. This is emphatically not a clean result and says so.
          */}
          {checksRun !== null && checksRun.length === 0 && (
            <div className="border-t border-slate-100 mt-3 px-3 py-2.5 flex items-start gap-2 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <span className="text-slate-600">
                None of the checks could run against this inspection, so nothing was compared with
                the work record. This is not a clean result.
              </span>
            </div>
          )}

          {/*
            State two of three, and the reason the column is nullable. `compareInspection` always
            writes `checks_run`, so a NULL here means the row came from somewhere else — a
            backfill, a data repair, a hand-written insert. Whatever the cause, which checks ran
            was not recorded, and neither the amber block above nor the green one below may speak
            for it: one would claim a measurement nobody took, the other would call an inspection
            clean on evidence that was never written down. The copy states what is observable —
            the record is missing — rather than guessing why.
          */}
          {checksRun === null && (
            <div className="border-t border-slate-100 mt-3 px-3 py-2.5 flex items-start gap-2 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
              <span className="text-slate-600">
                This comparison has no record of which checks ran — the findings below are what it
                produced, but the absence of a finding cannot be read as a passed check. Compare
                again to record it.
              </span>
            </div>
          )}

          {open.length > 0 && (
            <div className="border-t border-slate-100 mt-3">
              <div className="px-3 pt-3 pb-1">
                {/*
                  Both quantities, because this is the only count on the card. Counting open
                  findings alone understates the disagreement in the ordinary state where an
                  officer has confirmed some and not yet reached the rest — and the confirmed ones
                  are the ones most certainly against the record.
                */}
                <p className="text-xs font-semibold text-slate-900">
                  {open.length} open disagreement{open.length === 1 ? '' : 's'} between the
                  inspector's evidence and the record
                  {accepted.length > 0 && `, ${accepted.length} already confirmed on review`}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {open.map((f) => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    description={catalogue[f.check_id]}
                    onAccept={() => onAccept(f)}
                    onDismiss={() => onDismiss(f)}
                  />
                ))}
              </div>
            </div>
          )}

          {/*
            Findings the officer accepted are confirmed real and must never read as "clean". This
            renders whenever any finding is accepted — not only when the open list is empty —
            because "accepted some, not yet all" is the ordinary intermediate state of a review.
          */}
          {accepted.length > 0 && (
            <div className="border-t border-slate-100 mt-3 px-3 py-2.5 flex items-start gap-2 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <span className="text-slate-600">
                {accepted.length} disagreement{accepted.length === 1 ? '' : 's'} confirmed and
                accepted on review ({accepted.map((f) => f.check_id).join(', ')}). Accepting raised
                no alert and changed no work record.
              </span>
            </div>
          )}

          {/*
            A finding stamped SUPERSEDED but still hanging off the current comparison — what a
            half-completed rollback in `inspection_compare.ts` looks like from the officer's side:
            a real finding that no longer appears in any worklist. Surfacing it is the point, and
            it also has to block the all-clear below, which otherwise renders because it only
            excludes OPEN and ACCEPTED.
          */}
          {superseded.length > 0 && (
            <div className="border-t border-slate-100 mt-3 px-3 py-2.5 flex items-start gap-2 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <span className="text-slate-600">
                {superseded.length} finding{superseded.length === 1 ? '' : 's'} on this comparison{' '}
                {superseded.length === 1 ? 'is' : 'are'} marked superseded (
                {superseded.map((f) => f.check_id).join(', ')}) even though the comparison itself is
                current. {superseded.length === 1 ? 'It was' : 'They were'} raised by this run and
                never reviewed, and {superseded.length === 1 ? 'it does' : 'they do'} not appear in
                the worklist. Compare again to resolve the inconsistency.
              </span>
            </div>
          )}

          {/*
            Reached only when at least one check actually ran and no finding is open, accepted, or
            stranded at superseded. Dismissed findings leave this standing — the officer judged
            them not real — but the sentence has to say so, or the all-clear implies the checks
            were silent when in fact they fired and a person overruled them.

            The checks that could NOT run are named alongside, because a green tick over "1 of 4
            ran" is the exact false comfort this whole feature exists to remove. The tick is green
            only when the catalogue was fetched and every check in it ran — if the catalogue is
            unknown, so is coverage, and an unknown is not a pass.
          */}
          {open.length === 0 &&
            accepted.length === 0 &&
            superseded.length === 0 &&
            checksRun !== null &&
            checksRun.length > 0 && (
              <div className="border-t border-slate-100 mt-3 px-3 py-2.5 flex items-start gap-2 text-[11px]">
                {coverageKnown && didNotRun.length === 0 ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                )}
                <span className="text-slate-600">
                  No disagreement across the {checksRun.length} check
                  {checksRun.length === 1 ? '' : 's'} that ran ({checksRun.join(', ')}).
                  {!coverageKnown &&
                    ' The check catalogue could not be loaded, so whether that is all of them is unknown.'}
                  {coverageKnown &&
                    didNotRun.length > 0 &&
                    ` ${didNotRun.join(', ')} could not run against this inspection, so ${
                      didNotRun.length === 1 ? 'that comparison was' : 'those comparisons were'
                    } never made — this is not a full all-clear.`}
                  {dismissed.length > 0 &&
                    ` ${dismissed.length} finding${dismissed.length === 1 ? '' : 's'} ${
                      dismissed.length === 1 ? 'was' : 'were'
                    } raised and dismissed on review — this reads clean because an officer judged ${
                      dismissed.length === 1 ? 'it' : 'them'
                    } not real, not because nothing was flagged.`}
                </span>
              </div>
            )}

          {reviewed.length > 0 && (
            <div className="border-t border-slate-100 mt-3 px-3 py-2 space-y-1">
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
        </>
      )}
    </div>
  );
}

function FindingRow({
  finding,
  description,
  onAccept,
  onDismiss,
}: {
  finding: InspectionFinding;
  description: string | undefined;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  // The keyed photograph is signed on demand, not on load: an officer reading a work should not
  // mint a signed URL for every finding's image before deciding to look at any of them.
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState('');

  const toggleImage = async () => {
    if (finding.photo_id === null) return;
    if (imgUrl !== null) {
      setImgUrl(null);
      return;
    }
    try {
      setImgLoading(true);
      setImgError('');
      const { url } = await api.photos.url(finding.photo_id);
      setImgUrl(url);
    } catch (err: any) {
      setImgError(err.message || 'Could not produce a link to the stored image.');
    } finally {
      setImgLoading(false);
    }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <SeverityChip severity={finding.severity} />
        <span className="text-[11px] font-mono text-blue-600">{finding.check_id}</span>
        {/*
          The catalogue description, not just the id. A finding that says "I-001" and nothing else
          is unactionable.
        */}
        {description && <span className="text-[11px] text-slate-500">{description}</span>}
      </div>

      <p className="text-xs text-slate-700">{finding.detail}</p>

      {(finding.observed_value !== null || finding.record_value !== null) && (
        <div className="grid grid-cols-2 gap-3 text-[11px] bg-slate-50 rounded-md p-2">
          <div>
            <span className="text-slate-500">Inspector recorded:</span>
            <p className="font-medium text-slate-900">{finding.observed_value ?? '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Work record:</span>
            <p className="font-medium text-slate-900">{finding.record_value ?? '—'}</p>
            {/*
              The column the record value was read from — `works.status`,
              `works.physical_progress_pct`, `work_photos.exif_latitude/exif_longitude`,
              `work_photos.exif_taken_at`, `works.latitude/longitude`. Always a column on the
              record side, never `inspections.*`: these two headings are fixed for all four
              checks, so a check that put its inspector-side value in `record_value` would print
              it under "Work record" and label both values with each other's provenance. I-003 did
              exactly that until a review caught it — see the note in `inspection_reconcile.ts`.
              Named instead of a person on purpose: no column records who entered a work's status,
              so attributing this side to an author would be a fabrication the schema cannot
              support.
            */}
            {finding.record_source && (
              <p className="text-slate-400 font-mono mt-0.5">{finding.record_source}</p>
            )}
          </div>
        </div>
      )}

      {/*
        The magnitude, in the unit the row stores. Never inferred from `check_id`: two of these
        checks measure metres and one measures days over this same column.
      */}
      {finding.deviation !== null && (
        <p className="text-[11px] text-slate-500">
          {deviationLabel(finding.deviation_unit)}:{' '}
          {formatDeviation(finding.deviation, finding.deviation_unit)}
        </p>
      )}

      {/*
        I-001 and I-003 key on a specific photograph — one measures a distance to its geotag, the
        other a gap to its capture time — so both can open the image the measurement came from.
        I-002 and I-004 compare against columns on `works` and leave this null.
      */}
      {finding.photo_id !== null && (
        <div className="space-y-2">
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
            {imgUrl !== null ? 'Hide the photograph' : 'View the photograph this was measured to'}
          </button>
          {imgError && <p className="text-[11px] text-red-700">{imgError}</p>}
          {imgUrl !== null && (
            <img
              src={imgUrl}
              alt="Site photograph this finding was measured against"
              className="max-h-80 w-auto rounded-md"
            />
          )}
        </div>
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
