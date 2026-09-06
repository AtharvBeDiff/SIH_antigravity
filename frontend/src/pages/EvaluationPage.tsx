import { useEffect, useState } from 'react';
import { PageHeader, Card, StatCard, Spinner, Button } from '../components/ui';
import { Award, CheckCircle2, RefreshCw, ScanSearch, Target } from 'lucide-react';
import type { EvaluationRun } from '../types';

/** A ratio over a zero denominator is undefined. Say that, don't fill it in. */
const NOT_MEASURABLE = '—';

function pct(value: number | null | undefined): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : NOT_MEASURABLE;
}

export function EvaluationPage() {
  const [evalRun, setEvalRun] = useState<EvaluationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEval = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/insight/evaluation');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setEvalRun(json.data ?? null);
    } catch (err) {
      console.error('Failed to fetch evaluation run:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setEvalRun(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEval();
  }, []);

  const perType = Object.entries(evalRun?.per_type ?? {});
  const hasGroundTruth = (evalRun?.total_planted ?? 0) > 0;
  const coveredRules = evalRun?.covered_rule_ids ?? [];
  const unscored = evalRun?.unscored_alerts ?? 0;
  const scoredAlerts = Math.max(0, (evalRun?.total_alerts ?? 0) - unscored);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empirical Evaluation & Ground-Truth Benchmarks"
        description="Precision, recall, and F1 measured against the answer key, over the rules it has ground truth for. Metrics with no ground truth to measure against are reported as unmeasured."
        action={
          <Button variant="outline" size="sm" onClick={loadEval} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Re-Evaluate Corpus</span>
          </Button>
        }
      />

      {loading && (
        <Card className="flex items-center gap-3 text-sm text-slate-600">
          <Spinner className="w-4 h-4" />
          <span>Recomputing metrics against the answer key…</span>
        </Card>
      )}

      {!loading && error && (
        <Card className="border-rose-200 bg-rose-50 text-sm text-rose-800">
          Could not reach the evaluation endpoint ({error}). No metrics are shown, because
          none were measured.
        </Card>
      )}

      {/* The answer key is what makes any of these numbers meaningful. If it is
          empty, say so plainly instead of rendering placeholder percentages. */}
      {!loading && !error && !hasGroundTruth && (
        <Card className="border-amber-200 bg-amber-50 space-y-1.5">
          <h3 className="text-sm font-semibold text-amber-900">
            No ground truth — nothing is measured on this screen yet
          </h3>
          <p className="text-xs text-amber-800">
            The <code className="font-mono">answer_key</code> table holds{' '}
            <strong>{evalRun?.total_planted ?? 0}</strong> labelled anomalies, so recall and
            F1 have a zero denominator and are undefined. Precision needs at least one alert
            to judge; {evalRun?.total_alerts ?? 0} alert
            {(evalRun?.total_alerts ?? 0) === 1 ? '' : 's'} exist across{' '}
            {evalRun?.total_works ?? 0} works. Until a labelled corpus is generated, this page
            reports what it can measure and marks the rest unmeasured.
          </p>
        </Card>
      )}

      {/* Hero Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Overall Precision"
          value={pct(evalRun?.precision_val)}
          subtitle={`True positives / ${scoredAlerts} scored alert${scoredAlerts === 1 ? '' : 's'}`}
          icon={Target}
          variant="success"
        />
        <StatCard
          title="Overall Recall"
          value={pct(evalRun?.recall_val)}
          subtitle={`Detected / ${evalRun?.total_planted ?? 0} labelled condition${
            (evalRun?.total_planted ?? 0) === 1 ? '' : 's'
          }`}
          icon={CheckCircle2}
          variant="info"
        />
        <StatCard
          title="F1 Harmonic Mean"
          value={pct(evalRun?.f1_val)}
          subtitle="Harmonic mean of the two figures above"
          icon={Award}
          variant="default"
        />
      </div>

      {/* Scope. Without this the three figures above read as the engine's accuracy
          across all 21 rules, which is not what they measure. */}
      {!loading && !error && hasGroundTruth && (
        <Card className="space-y-3">
          <div className="flex items-start gap-2.5">
            <ScanSearch className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                What these figures cover
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Scored over {coveredRules.length} of the catalogue&rsquo;s rules — the ones the
                answer key has ground truth for.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {coveredRules.length === 0 ? (
              <span className="text-xs text-slate-400">None.</span>
            ) : (
              coveredRules.map((id) => (
                <span
                  key={id}
                  className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700"
                >
                  {id}
                </span>
              ))
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 text-xs">
            <div>
              <div className="font-mono text-lg text-slate-900">{scoredAlerts}</div>
              <div className="text-slate-500">
                Alerts scored — from a covered rule, so the answer key can judge them.
              </div>
            </div>
            <div>
              <div className="font-mono text-lg text-slate-900">{unscored}</div>
              <div className="text-slate-500">
                Alerts <strong>not</strong> scored — from a rule outside the key. Neither
                credited as correct nor penalised as false.
              </div>
            </div>
            <div>
              <div className="font-mono text-lg text-slate-900">{evalRun?.total_works ?? 0}</div>
              <div className="text-slate-500">
                Works in the corpus, seed{' '}
                <span className="font-mono">{evalRun?.seed ?? NOT_MEASURABLE}</span>.
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
            The uncovered rules are outside the key for different reasons. Most cannot be
            written down: the per-category cost outliers and duplicate detection are emergent —
            they depend on the whole corpus, not on one work — photo reuse needs images the
            generator does not produce, and the two coverage statistics are not alerts at all.
            One, the 35-day sanction-SLA early warning, is a label nobody has written yet rather
            than one the corpus cannot express. Counting any of their alerts as false positives
            would make precision <em>fall</em> as those rules did more work, which would measure
            the answer key&rsquo;s coverage and report it as the engine&rsquo;s accuracy.
          </p>
        </Card>
      )}

      {/* The number that is easiest to misread on this page. */}
      {!loading && !error && hasGroundTruth && (
        <Card className="border-slate-200 bg-slate-50 space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900">What recall does not mean</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            The answer key is the generator&rsquo;s own restatement of each rule&rsquo;s
            physical condition, so a miss means the condition did not survive the trip through
            the catalogue, the status filters, probation and the alert store — a rule disabled,
            gated on the wrong status, or reading a column nothing writes. Recall here measures
            pipeline fidelity. It does not mean the rule would catch genuine wrongdoing: no
            synthetic corpus can measure that, and this screen is not evidence of it.
          </p>
        </Card>
      )}

      {/* Breakdown Table */}
      <Card className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Performance Breakdown by Anomaly Category
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            One row per anomaly type present in the answer key. Per-type precision is not
            listed: a false positive fires on a work that was never planted, so it belongs to
            no category and cannot be attributed to one.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200/50 text-slate-500">
                <th className="py-3 px-4">Anomaly Class</th>
                <th className="py-3 px-4">Planted Samples</th>
                <th className="py-3 px-4">Detected</th>
                <th className="py-3 px-4">Missed</th>
                <th className="py-3 px-4">Recall</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-900">
              {perType.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No planted anomalies in the answer key — nothing to break down.
                  </td>
                </tr>
              ) : (
                perType.map(([type, m]) => (
                  <tr key={type} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">{type}</td>
                    <td className="py-3 px-4 font-mono">{m.planted}</td>
                    <td className="py-3 px-4 font-mono text-emerald-600">{m.detected}</td>
                    <td className="py-3 px-4 font-mono text-rose-600">{m.false_negatives}</td>
                    <td className="py-3 px-4 font-mono font-bold text-blue-600">
                      {pct(m.recall)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
