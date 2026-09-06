import React, { useEffect, useState } from 'react';
import { PageHeader, Card, StatCard, Spinner } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import { api } from '../lib/api';
import { Building2, Clock, Gauge, Info, TriangleAlert } from 'lucide-react';
import type { AgencyPerformanceReport, AgencyProfile } from '../types';

/** A rate in [0,1] as a percentage, or '—' when unmeasured. */
function pct(rate: number | null): string {
  return typeof rate === 'number' ? `${(rate * 100).toFixed(1)}%` : '—';
}

/** Days as whole months, or '—'. Months because a day figure implies precision the median does not have. */
function months(days: number | null): string {
  return typeof days === 'number' ? `${(days / 30.44).toFixed(1)} Mo` : '—';
}

/**
 * The pacing index, and the colour that goes with it.
 *
 * Slower than peers is amber, not red. Red reads as a finding, and a pacing index is
 * a comparison against a median — half of any corpus sits above its own median by
 * definition, so being above it is not by itself evidence of anything.
 */
function pacingTone(index: number | null): string {
  if (index === null) return 'text-slate-400';
  if (index >= 1.25) return 'text-amber-600';
  if (index <= 0.85) return 'text-emerald-600';
  return 'text-slate-900';
}

export function AgenciesPage() {
  const [report, setReport] = useState<AgencyPerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        setReport(await api.agencies.get());
      } catch (err) {
        console.error('Failed to load agency performance:', err);
        setError(err instanceof Error ? err.message : 'Failed to load agency performance');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Spinner className="w-8 h-8" />
        <p className="text-sm">Computing agency delivery pacing...</p>
      </div>
    );
  }

  // This page used to render four hardcoded agency rows, "14.2 Mo" average pacing and
  // "DRDA — 88.4% timely execution" without making a single API call. A failed request
  // must not fall back to anything of the kind: it shows what went wrong instead.
  if (error || !report) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Implementing Agencies — Workload & Delivery Pacing"
          description="Execution accountability at the agency, which is where it sits."
        />
        <Card className="space-y-2 border-amber-200 bg-amber-50/50">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <TriangleAlert className="w-4 h-4 text-amber-600" />
            <span>Agency performance unavailable</span>
          </h3>
          <p className="text-sm text-slate-600">
            {error ?? 'No agency data was returned.'} No figures are shown, because an
            agency comparison that has not been computed has nothing to report.
          </p>
        </Card>
      </div>
    );
  }

  const active = report.agencies.filter((a) => a.works_total > 0);

  // The slowest agency with a measured index, if any. `agencies` arrives sorted
  // slowest-first with nulls last, so this is the first row that has a number.
  const slowest: AgencyProfile | undefined = report.agencies.find((a) => a.pacing_index !== null);

  // Corpus-wide pacing over every agency that has a measurable index — a weighted
  // figure, not a mean of ratios, so a two-work agency does not count for as much as
  // a two-hundred-work one.
  const measuredAgencies = report.agencies.filter((a) => a.pacing_index !== null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Implementing Agencies — Workload & Delivery Pacing"
        description="Every figure is computed from works rows. Delivery is compared against what each agency's own mix of work takes elsewhere in the corpus, not against a flat target."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Agencies Holding Works"
          value={String(report.agencies_with_works)}
          subtitle={
            report.agencies_without_works > 0
              ? `${report.agencies_without_works} more on record with no works assigned`
              : 'Every agency on record holds at least one work'
          }
          icon={Building2}
          variant="info"
        />
        <StatCard
          title="Corpus Median Delivery"
          value={months(report.corpus_median_days)}
          subtitle={`Sanction to recorded completion, across ${report.expectation_basis_works} completed works`}
          icon={Clock}
          variant="default"
        />
        <StatCard
          title="Slowest Against Peers"
          value={slowest?.pacing_index != null ? `${slowest.pacing_index.toFixed(2)}×` : '—'}
          subtitle={
            slowest
              ? `${slowest.agency_name} — ${slowest.pacing_works_measured} works measured`
              : 'No agency has a measurable pacing index'
          }
          icon={Gauge}
          variant={slowest?.pacing_index != null && slowest.pacing_index >= 1.25 ? 'warning' : 'default'}
        />
      </div>

      {/*
        What the index is, before the table that ranks on it. A number labelled
        "1.34×" with no explanation of the denominator invites the reader to supply
        one, and the one they will supply is a target — which this is not.
      */}
      <Card className="space-y-3 border-blue-200">
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-600" />
          <span>How pacing is measured</span>
        </h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          A league table on completion rate ranks portfolios rather than agencies: an
          agency handed forty handpumps will out-complete one handed four bridges every
          time. So each completed work is compared against the median duration of works
          in the same category and sanction-size band, taken across the whole corpus.
          The <strong>pacing index</strong> is an agency&rsquo;s total actual days over its
          total expected days &mdash; 1.00× means it delivers its own mix of work at the
          corpus median, 1.30× means it takes 30% longer than the same work takes
          elsewhere.
        </p>
        <p className="text-sm text-slate-500 leading-relaxed">
          The expectation rests on {report.expectation_basis_works} completed works
          across {report.expectation_cells} category × size cells that met the minimum
          of {report.min_cell_size} works; thinner cells fall back to the category
          median, then to the corpus median, and a work with no expectation at any level
          is excluded rather than assigned an invented one. Size bands:{' '}
          {report.size_bands.map((b) => b.label).join(', ')}.
        </p>
        <p className="text-xs text-slate-500 leading-relaxed">
          This is not a quality measure &mdash; a fast build can be a bad build, and
          nothing here inspects an asset. It is not evidence of wrongdoing. And half of
          any corpus sits above its own median by construction, so an index above 1.00
          is a prompt to look, not a finding.
        </p>
        <p className="text-xs text-slate-500 leading-relaxed">
          There is deliberately no &ldquo;timely execution rate&rdquo;. Timeliness needs a
          per-work deadline, and <code className="font-mono">completion_target_date</code>{' '}
          is populated for a minority of works and is absent from the CSV ingest contract
          entirely. Scheme-timeline breaches are reported as R-006 alerts, which is where
          that finding belongs.
        </p>
      </Card>

      {report.works_unattributed > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <TriangleAlert className="w-4 h-4 text-amber-600" />
            <span>{report.works_unattributed} works belong to no agency</span>
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            These rows have a null <code className="font-mono">agency_id</code>, so they
            appear in no row below and the table does not sum to the corpus. They are a
            data-quality finding in their own right: a work with no implementing agency
            has nobody to hold to its delivery.
          </p>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200/50 text-slate-500 bg-slate-50/50">
                <th className="py-3.5 px-4">Implementing Agency</th>
                <th className="py-3.5 px-4">Type</th>
                <th className="py-3.5 px-4">Works</th>
                <th className="py-3.5 px-4">Completed</th>
                <th className="py-3.5 px-4">In Progress</th>
                <th className="py-3.5 px-4">On Hold</th>
                <th className="py-3.5 px-4">Sanctioned</th>
                <th className="py-3.5 px-4">Completion (count)</th>
                <th className="py-3.5 px-4">Median Delivery</th>
                <th className="py-3.5 px-4">Pacing vs Peers</th>
                <th className="py-3.5 px-4">Open Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-900">
              {active.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-8 px-4 text-center text-slate-500">
                    No agency in this corpus holds any works.
                  </td>
                </tr>
              )}
              {active.map((a) => (
                <tr key={a.agency_id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-900">{a.agency_name}</td>
                  <td className="py-3 px-4 text-slate-500">{a.agency_type}</td>
                  <td className="py-3 px-4 font-mono">{a.works_total}</td>
                  <td className="py-3 px-4 font-mono text-emerald-600">{a.works_completed}</td>
                  <td className="py-3 px-4 font-mono">{a.works_in_progress}</td>
                  <td className="py-3 px-4 font-mono">{a.works_on_hold}</td>
                  <td className="py-3 px-4 font-bold">{formatCurrency(a.sanctioned_inr)}</td>
                  <td className="py-3 px-4 font-bold text-blue-600">
                    {pct(a.completion_rate_by_count)}
                  </td>
                  <td className="py-3 px-4 font-mono">{months(a.median_days_to_complete)}</td>
                  <td className={`py-3 px-4 font-bold font-mono ${pacingTone(a.pacing_index)}`}>
                    {a.pacing_index === null ? '—' : `${a.pacing_index.toFixed(2)}×`}
                    {/*
                      The measured count travels with the index, always. An index over
                      two works and an index over eighty look identical otherwise, and
                      the first is not a performance figure.
                    */}
                    <span className="ml-1.5 font-normal text-slate-400">
                      {a.pacing_index === null
                        ? `(${a.works_completed === 0 ? 'nothing completed' : 'no comparable basis'})`
                        : `(n=${a.pacing_works_measured}${a.pacing_works_unmeasured > 0 ? `, ${a.pacing_works_unmeasured} excl.` : ''})`}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono">{a.open_alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-400">
        {measuredAgencies.length} of {report.agencies_with_works} agencies have a
        measurable pacing index. Computed at {report.computed_at}. Agencies are ordered
        slowest first; those without a measurable index sort last, because an agency
        that has completed nothing is not the fastest.
      </p>
    </div>
  );
}
