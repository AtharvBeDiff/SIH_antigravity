import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { StatCard, Card, PageHeader, Button, Spinner } from '../components/ui';
import { Clock, ShieldAlert, CheckCircle, HelpCircle, Zap } from 'lucide-react';
import type { SLAStats } from '../types';

export function SLAPage() {
  const [stats, setStats] = useState<SLAStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await api.sla.stats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load SLA stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEvaluate = async () => {
    try {
      setEvaluating(true);
      await api.sla.evaluate();
      await loadData();
    } catch (err) {
      console.error('Failed to evaluate SLA:', err);
    } finally {
      setEvaluating(false);
    }
  };

  // Thresholds come from the response, which reads them from the rule catalogue.
  // They were written into these labels as the literals "45" and "35", so editing
  // the YAML changed which works were flagged without changing what this page said
  // the limit was.
  const limit = stats?.limitDays ?? 45;
  const warning = stats?.warningDays ?? 35;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${limit}-Day Sanction Decision SLA`}
        /*
          Describes the subtraction, because that is all this is: days between a
          work's recommendation date and today, compared to two thresholds from the
          catalogue. The previous wording promised a "predictive engine ...
          forecasting potential breaches and auto-escalating" — it forecasts nothing
          and escalates nothing, and an evaluator who asks to see the model finds
          `daysBetween`. R-018 carried the same overclaim; see
          `backend/src/detectors/delay.ts`.
        */
        description={`Days elapsed between a work's recommendation and its sanction decision. A work past ${warning} days is reported as at risk, past ${limit} days as a breach.`}
        action={
          <Button
            variant="primary"
            onClick={handleEvaluate}
            disabled={evaluating || loading}
            className="glow-primary"
          >
            <Zap className={`w-4 h-4 ${evaluating ? 'animate-spin' : ''}`} />
            {evaluating ? 'Evaluating...' : 'Run SLA Evaluation'}
          </Button>
        }
      />

      {/*
        Tiles are withheld until the numbers arrive. They previously rendered
        `stats?.x ?? 0` from the first paint, so a page still loading — or one whose
        fetch had failed — showed a confident "0 Breached".
      */}
      {loading || !stats ? (
        <Card className="p-10 flex flex-col items-center gap-3 text-sm text-slate-500">
          <Spinner className="w-5 h-5" />
          <span>Measuring pending sanction decisions…</span>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Awaiting a Decision"
              value={stats.breached + stats.atRisk + stats.safe}
              subtitle={`Of ${stats.total} works with no sanction date`}
              icon={Clock}
              variant="default"
            />
            <StatCard
              title={`Breached (>${limit} days)`}
              value={stats.breached}
              subtitle="Past the decision limit"
              icon={ShieldAlert}
              variant={stats.breached > 0 ? 'critical' : 'success'}
            />
            <StatCard
              title={`At Risk (>${warning} days)`}
              value={stats.atRisk}
              subtitle="Approaching the limit"
              icon={Clock}
              variant={stats.atRisk > 0 ? 'warning' : 'success'}
            />
            <StatCard
              title={`Within SLA (≤${warning} days)`}
              value={stats.safe}
              subtitle="Inside the warning mark"
              icon={CheckCircle}
              variant="success"
            />
          </div>

          {/*
            The two non-pending outcomes. Without them the three tiles above do not
            sum to `total` and the page looks broken — and, worse, a rejected work
            would have to be filed under one of the three, which is exactly the
            misclassification this split exists to prevent.
          */}
          {(stats.rejected > 0 || stats.notTrackable > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5 flex items-start gap-3">
                <HelpCircle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-900">
                    {stats.rejected} rejected, decision date not recorded
                  </p>
                  <p className="text-xs text-slate-500">
                    A rejection satisfies the clause as much as a sanction does, so these are
                    not breaches. There is no rejection-date field in the ingest contract, so
                    whether each decision landed inside {limit} days cannot be computed.
                  </p>
                </div>
              </Card>
              <Card className="p-5 flex items-start gap-3">
                <HelpCircle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-900">
                    {stats.notTrackable} with no measurable clock
                  </p>
                  <p className="text-xs text-slate-500">
                    No usable recommendation date, so the SLA has no start point. Reported as a
                    data-quality gap, never as a finding — a rule must not fire on a null field.
                  </p>
                </div>
              </Card>
            </div>
          )}

          <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">How this is measured</h3>
            <div className="space-y-4 text-slate-500">
              <p>
                The clock runs from the date a work was recommended to the date a sanction
                decision was taken on it. Works that already carry a sanction date are settled
                and are not counted here.
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>SLA limit:</strong> {limit} days, from rule R-020 in the rule catalogue.</li>
                <li><strong>Warning mark:</strong> {warning} days, from rule R-021.</li>
                <li>
                  {/*
                    `avgDays` is null when nothing measurable is pending. It used to
                    read `?? 0`, so "no measurable proposals" and "decisions are
                    instantaneous" rendered identically.
                  */}
                  <strong>Average age:</strong>{' '}
                  {stats.avgDays === null
                    ? '— (no pending work has a measurable age)'
                    : `${stats.avgDays} days, across ${stats.measuredCount} work(s)`}
                </li>
              </ul>
              <p className="mt-4">
                Alerts from this engine appear in the triage queue alongside every other
                finding, ordered by severity.
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
