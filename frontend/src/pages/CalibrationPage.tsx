import React, { useEffect, useState } from 'react';
import { PageHeader, Card, StatCard, Spinner } from '../components/ui';
import { CheckCircle, Database, Hourglass, Scale, Sparkles, TriangleAlert } from 'lucide-react';
import type { CalibrationSnapshot } from '../types';

/** A rate in [0,1] as a percentage string, or '—' when unmeasured. */
function pct(rate: number | null | undefined): string {
  return typeof rate === 'number' ? `${(rate * 100).toFixed(2)}%` : '—';
}

/** A deviation already expressed as a percentage, or '—' when unmeasured. */
function dev(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '—';
}

export function CalibrationPage() {
  const [snapshot, setSnapshot] = useState<CalibrationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadCalibration = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/insight/calibration');
        if (!res.ok) throw new Error(`calibration request failed (${res.status})`);
        const json = await res.json();
        setSnapshot(json.data ?? null);
      } catch (err) {
        console.error('Failed to load calibration:', err);
        setError(err instanceof Error ? err.message : 'Failed to load calibration');
      } finally {
        setLoading(false);
      }
    };
    loadCalibration();
  }, []);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Spinner className="w-8 h-8" />
        <p className="text-sm">Computing corpus calibration...</p>
      </div>
    );
  }

  // No snapshot means no measurement. The page previously fell back to a set of
  // plausible constants (0.198 corpus, 0.1924 target, 2.9% deviation) and a
  // hardcoded "well within statistical tolerance" verdict, so a failed request
  // rendered a confident calibration report for a corpus nobody had measured.
  if (error || !snapshot) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Corpus Calibration & Benchmark Alignment"
          description="Compares the corpus against the published MPLADS completion figures."
        />
        <Card className="space-y-2 border-amber-200 bg-amber-50/50">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <TriangleAlert className="w-4 h-4 text-amber-600" />
            <span>Calibration unavailable</span>
          </h3>
          <p className="text-sm text-slate-600">
            {error ?? 'No calibration snapshot has been computed yet.'} No figures are
            shown, because a calibration that has not been measured has no result to
            report.
          </p>
        </Card>
      </div>
    );
  }

  const { reference } = snapshot;
  const period = reference ? `${reference.period_start} to ${reference.period_end}` : null;

  // Deviation is only a "pass" if it was actually measured. Unmeasured is neutral,
  // not successful.
  const worstDeviation = Math.max(
    snapshot.deviation_pct ?? -1,
    snapshot.deviation_pct_by_count ?? -1,
  );
  const measured = worstDeviation >= 0;
  const withinTolerance = measured && worstDeviation <= 15;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Corpus Calibration & Benchmark Alignment"
        description="Compares the corpus against the published MPLADS completion figures — by value and by count, each against its own reference."
      />

      {/* By value */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Completion by value</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Corpus Rate"
            value={pct(snapshot.corpus_completion_rate)}
            subtitle="Sanctioned value on works recorded complete"
            icon={Database}
            variant="info"
          />
          <StatCard
            title="Published Benchmark"
            value={pct(snapshot.target_completion_rate)}
            subtitle="₹3,387.38 Cr completed of ₹6,680.29 Cr sanctioned"
            icon={Scale}
            variant="default"
          />
          <StatCard
            title="Deviation"
            value={dev(snapshot.deviation_pct)}
            subtitle="Relative to the by-value benchmark"
            icon={CheckCircle}
            variant={snapshot.deviation_pct === null ? 'default' : 'info'}
          />
        </div>
      </div>

      {/* By count */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Completion by count</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Corpus Rate"
            value={pct(snapshot.corpus_completion_rate_by_count)}
            subtitle="Works recorded complete, as a share of all works"
            icon={Database}
            variant="info"
          />
          <StatCard
            title="Published Benchmark"
            value={pct(snapshot.target_completion_rate_by_count)}
            subtitle="69,061 works completed of 1,11,600 sanctioned"
            icon={Scale}
            variant="default"
          />
          <StatCard
            title="Deviation"
            value={dev(snapshot.deviation_pct_by_count)}
            subtitle="Relative to the by-count benchmark"
            icon={CheckCircle}
            variant={snapshot.deviation_pct_by_count === null ? 'default' : 'info'}
          />
        </div>
      </div>

      {/*
        The vintage adjustment. This is about the *published figures*, not the corpus
        — arithmetic on the four Standing Committee totals — which is why it sits in
        its own card rather than among the corpus tiles above.

        `assumption` is rendered next to the rate, always, from the same payload. The
        78.66% rests on sanctioning being uniform across the window, and the published
        aggregates carry no monthly split to check it against. A rate shown without
        that sentence is an estimate presented as a measurement.
      */}
      {snapshot.vintage_adjustment && (
        <Card className="space-y-4 border-blue-200">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Hourglass className="w-4 h-4 text-blue-600" />
              <span>Vintage-adjusted delivery (by value)</span>
            </h3>
            <p className="text-xs text-slate-500">
              The headline 50.71% charges works sanctioned days before the window closed
              with failing a deadline that had not arrived. Restricting the denominator to
              value whose {snapshot.vintage_adjustment.deadline_days}-day deadline has
              passed measures delivery instead of the sanction curve.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              title="Adjusted Completion"
              value={pct(snapshot.vintage_adjustment.adjusted_rate_by_value)}
              subtitle={`Against ₹${snapshot.vintage_adjustment.matured_sanctioned_cr.toFixed(0)} Cr past deadline`}
              icon={Hourglass}
              variant="info"
            />
            <StatCard
              title="Published Headline"
              value={pct(snapshot.vintage_adjustment.unadjusted_rate_by_value)}
              subtitle={`Against all ₹${(snapshot.vintage_adjustment.matured_sanctioned_cr / snapshot.vintage_adjustment.matured_fraction).toFixed(0)} Cr sanctioned`}
              icon={Scale}
              variant="default"
            />
            <StatCard
              title="Genuinely Overdue"
              value={`₹${snapshot.vintage_adjustment.overdue_cr.toFixed(0)} Cr`}
              subtitle="Past deadline, not recorded complete"
              icon={TriangleAlert}
              variant="warning"
            />
          </div>

          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
            <p className="text-xs font-semibold text-amber-900">
              Estimate, not a measurement — read the assumption
            </p>
            <p className="text-xs text-amber-900 leading-relaxed">
              {snapshot.vintage_adjustment.assumption}
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">
              {snapshot.vintage_adjustment.count_basis_note}
            </p>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            The adjusted figure is the more useful one in both directions: it is a smaller
            headline gap than 50.71%, and a firmer accusation. ₹
            {snapshot.vintage_adjustment.overdue_cr.toFixed(0)} Cr sits on works that are
            past their deadline and are not recorded complete — that is money with a
            question attached, rather than an aggregate that partly reflects how recently
            the scheme sanctioned things.
          </p>
        </Card>
      )}

      {/* Why the two figures differ, and what calibration is for */}
      <Card className="space-y-4 border-blue-200">
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span>Why two benchmarks, and why calibration matters</span>
        </h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          Completion by value and completion by count differ by more than eleven
          points in the published data, because the works that finish are
          systematically cheaper than the works that stall. Quoting one figure
          against the other's denominator overstates or understates delivery by that
          margin, so both are reported here against their own reference.
        </p>
        <p className="text-sm text-slate-500 leading-relaxed">
          Calibration exists because a corpus with an unrealistic completion profile
          silently changes detector behaviour: thresholds tuned against a corpus that
          completes 80% of its works will not hold on data that completes 60%. The
          deviation figures above are a measurement of that risk, not a score to
          pass.
          {measured && !withinTolerance && (
            <> The current corpus deviates by {worstDeviation.toFixed(2)}%, which is
            wide enough that detector thresholds should be re-checked against it.</>
          )}
        </p>
        {period && (
          <p className="text-xs text-slate-400">
            Benchmark source: {reference.source}, covering {period}.
          </p>
        )}
      </Card>

      {/* A small deviation here is not evidence of anything about the scheme. The
          generator draws its status mix from these very figures, so agreement is
          arithmetic, not a finding. Said plainly, because the number invites the
          opposite reading. */}
      <Card className="border-slate-200 bg-slate-50 space-y-1.5">
        <h3 className="text-sm font-semibold text-slate-900">
          The corpus is calibrated to these figures by construction
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          This is synthetic data. <code className="font-mono">data-gen</code> draws each
          work&rsquo;s status from a mix weighted to the published completion rate, and gives
          completed works a lower amount ceiling derived algebraically from the by-value figure.
          A close deviation is therefore the draw agreeing with its own weights — it confirms
          the generator works, and says nothing about the scheme. The weights were deliberately
          not tuned to close the residual gap: fitting one seed&rsquo;s output to a target would
          make this screen report a number it had been made to produce.
        </p>
        <p className="text-xs text-slate-600 leading-relaxed">
          What the deviation is <em>for</em> is the case above: it bounds how far detector
          thresholds tuned on this corpus can be trusted on real data. Read it as a caveat on
          the rules, not as a result about MPLADS.
        </p>
      </Card>
    </div>
  );
}
