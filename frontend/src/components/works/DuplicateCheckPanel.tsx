/**
 * Semantic duplicate check — P-03's surface on the work dossier.
 *
 * An on-demand action, not a stored feature. It asks the server to rank this work's
 * same-district peers by cosine similarity of their descriptive-text embeddings and shows the
 * matches inline. Nothing here is persisted as a finding, there is no worklist and no accept/
 * dismiss — unlike `DocumentPanel` and `PhotoPanel`. Re-running replaces the result on screen.
 *
 * It is careful about the same things its siblings are:
 *
 * **It raises no alerts, and says so.** The note under the candidates states the check writes
 * nothing to `alerts`, enters no district budget, and is not scored on the evaluation page. It
 * complements the deterministic R-009 detector rather than competing with it: R-009 matches
 * shared title tokens, this matches meaning, and where R-009 *also* flagged a pair the row says
 * so — the two signals agreeing visibly rather than one silently overriding the other.
 *
 * **A null is never rendered as zero.** `distance_m` null means one of the two works carries no
 * geotag — shown as "location not comparable", never as 0 m, because 0 m means they sit at the
 * same point. `amount_diff_pct` null means an amount could not be read — shown as such, never as
 * 0%, because 0% means the two sanctioned amounts are identical, itself a duplicate signal.
 *
 * **`compared` is shown as the honest denominator.** "Compared N peers, M were similar" — and
 * `compared` 0 ("nothing comparable to check against") reads differently from `compared` > 0
 * with no matches ("checked, nothing similar").
 *
 * The keyless path is the default path. `api.works.duplicateStatus()` is called before the run
 * control is shown; when it reports `available: false` the panel shows the server's own reason
 * (which names the credential and reassures that R-009 still runs) and offers no run button.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Layers, Loader2, MapPin, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui';
import type {
  DuplicateCandidate,
  DuplicateCheckCapability,
  DuplicateCheckResult,
} from '../../types';

interface DuplicateCheckPanelProps {
  workId: string;
}

/**
 * Distance between two works, per Doctrine 11: null is "not comparable", never 0.
 *
 * A missing coordinate is not a location. 0 metres is a real answer — the two works sit at the
 * same point — and is shown as such, distinct from the null that means one of them has no geotag.
 */
function renderDistance(m: number | null): React.ReactNode {
  if (m === null) {
    return (
      <span
        className="text-slate-400"
        title="One of the two works carries no geotag, so the distance cannot be computed. This is not zero metres."
      >
        location not comparable
      </span>
    );
  }
  if (m === 0) return 'same coordinates';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km apart` : `${m} m apart`;
}

/**
 * Sanctioned-amount gap, per Doctrine 11: null is "unreadable", never 0.
 *
 * 0% means the two sanctioned amounts are identical — a duplicate signal in its own right — and
 * must not collapse into the null that means an amount could not be read.
 */
function renderAmountDiff(pct: number | null): React.ReactNode {
  if (pct === null) {
    return (
      <span
        className="text-slate-400"
        title="An amount could not be read on one of the two works. This is not a 0% difference."
      >
        amount not comparable
      </span>
    );
  }
  if (pct === 0) return 'identical sanctioned amount';
  return `${pct}% apart in sanctioned amount`;
}

export function DuplicateCheckPanel({ workId }: DuplicateCheckPanelProps) {
  const [status, setStatus] = useState<DuplicateCheckCapability | null>(null);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(0.8);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DuplicateCheckResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // A change of work must not leave a previous work's candidates on screen.
      setResult(null);
      setError('');
      const statusRes = await api.works.duplicateStatus().catch(() => null);
      if (cancelled) return;
      setStatus(statusRes);
      // Start the slider at the server's advertised default, so the first run matches the
      // documented behaviour rather than a hardcoded guess.
      if (statusRes) setThreshold(statusRes.default_threshold);
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [workId]);

  const available = status?.available === true;

  const runCheck = async () => {
    try {
      setRunning(true);
      setError('');
      const res = await api.works.duplicateCheck(workId, { threshold });
      setResult(res);
    } catch (err: any) {
      // The server's message is specific (LLM_TIMEOUT / LLM_AUTH / LLM_FAILED / NOT_FOUND). Show
      // it rather than a generic failure, so a transient model error reads as one.
      setError(err.message || 'The duplicate check could not be completed.');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking whether semantic matching is configured...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <span>Semantic duplicate check</span>
        </h3>
        <p className="text-[11px] text-slate-500 max-w-prose">
          Ranks this work's same-district peers by the similarity of their descriptive text —
          catching a work described twice in different words, which the deterministic R-009
          detector (shared title tokens) can miss. Run on demand; it raises no alerts.
        </p>
        {/* The tier label comes from the server, verbatim — it states the check raises no alerts. */}
        {status?.tier && <p className="text-[11px] text-slate-500">{status.tier}</p>}
      </div>

      {/* Capability, stated plainly rather than discovered on failure. */}
      {!available && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Semantic matching is not configured on this server
          </p>
          <p>{status?.reason ?? 'The status endpoint could not be reached.'}</p>
        </div>
      )}

      {available && (
        <div className="flex flex-wrap items-end gap-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Similarity threshold:{' '}
              <span className="font-mono text-slate-900">{(threshold * 100).toFixed(0)}%</span>
            </label>
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={running}
              className="w-full"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              A peer must score at or above this to be shown. Lower it to widen the net; the
              default is{' '}
              {status ? `${(status.default_threshold * 100).toFixed(0)}%` : '80%'}.
            </p>
          </div>
          <Button size="sm" onClick={runCheck} disabled={running}>
            {running ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Comparing...
              </span>
            ) : result ? (
              'Run again'
            ) : (
              'Run duplicate check'
            )}
          </Button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {result && <DuplicateResult result={result} />}
    </div>
  );
}

function DuplicateResult({ result }: { result: DuplicateCheckResult }) {
  const { compared, candidates, threshold, model } = result;

  return (
    <div className="space-y-3">
      {/* The honest denominator: what was compared, distinct from what matched. */}
      <p className="text-[11px] text-slate-500">
        {compared === 0
          ? 'No peer in this district had a comparable vector to check against, so nothing could be scored.'
          : `Compared ${compared} same-district peer${compared === 1 ? '' : 's'} at a ${(
              threshold * 100
            ).toFixed(0)}% similarity threshold. ${candidates.length} scored at or above it.`}
      </p>

      {compared > 0 && candidates.length === 0 ? (
        <div className="px-3 py-2.5 flex items-start gap-2 text-[11px] rounded-lg bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <span className="text-slate-600">
            No semantic duplicate above the threshold. The works in this district read as distinct.
          </span>
        </div>
      ) : candidates.length > 0 ? (
        <>
          {/*
            The distinction that keeps /evaluation honest — the same note the photo and document
            panels carry. These candidates never became alerts, so the measured precision figure
            does not describe them.
          */}
          <p className="text-[11px] text-slate-500">
            Candidates for a human to compare, not rule alerts. This check raises no alerts, does
            not enter the district alert budget, and is not covered by the measured precision on the
            evaluation page.
          </p>
          <div className="space-y-2">
            {candidates.map((c) => (
              <CandidateRow key={c.work_id} candidate={c} />
            ))}
          </div>
        </>
      ) : null}

      <p className="text-[11px] text-slate-400">
        Ranked by <span className="font-mono">{model}</span>. Similarity is the cosine similarity of
        the two works' descriptive-text embeddings.
      </p>
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: DuplicateCandidate }) {
  const pct = (candidate.similarity * 100).toFixed(1);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/works/${candidate.work_id}`}
            className="text-sm font-medium text-blue-600 hover:underline truncate"
          >
            {candidate.title}
          </Link>
          {/*
            The deterministic detector and the semantic one agreeing on the same pair is worth
            surfacing — it is the strongest form of this signal. Absence of the badge means only
            that R-009's token overlap did not fire, not that the pair is less likely a duplicate.
          */}
          {candidate.also_flagged_by_r009 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
              title="The deterministic R-009 detector flagged this exact pair too — the semantic and token-overlap signals agree."
            >
              <ShieldAlert className="w-3 h-3" />
              R-009 also flagged
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          {candidate.category} · {candidate.location_name || 'location not recorded'}
        </p>
        <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            {renderDistance(candidate.distance_m)}
          </span>
          <span>{renderAmountDiff(candidate.amount_diff_pct)}</span>
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-lg font-bold text-slate-900 leading-none">{pct}%</p>
        <p className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">similar</p>
      </div>
    </div>
  );
}
