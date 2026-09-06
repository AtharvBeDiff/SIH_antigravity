import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { StatCard, Card, Button, BenchmarkGauge, StatusBadge } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import { BENCHMARK_PCT_BY_COUNT, BENCHMARK_PCT_BY_VALUE } from '../lib/scheme_reference';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Layers,
  ShieldAlert,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { SEVERITY_RANK } from '../types';
import type { DashboardStats, SeverityLevel, Work } from '../types';

/** Bar colour per severity band. */
function severityTone(severity: string): string {
  if (severity === 'CRITICAL') return 'bg-rose-500';
  if (severity === 'HIGH') return 'bg-orange-500';
  if (severity === 'MEDIUM') return 'bg-amber-500';
  return 'bg-slate-400';
}

export function OverviewPage() {
  const { selectedDistrict } = useAppState();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentWorks, setRecentWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [dashData, worksData] = await Promise.all([
        api.dashboard.get(selectedDistrict ? { district_id: selectedDistrict } : undefined),
        api.works.list(selectedDistrict ? { district_id: selectedDistrict, page_size: '6' } : { page_size: '6' }),
      ]);
      setStats(dashData);
      setRecentWorks(worksData || []);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDistrict]);

  const handleRunAnalysis = async () => {
    try {
      setAnalyzing(true);
      await api.analyze.run();
      await loadData();
    } catch (err) {
      console.error('Failed to run analysis:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const totalSanctioned = stats?.total_sanctioned ?? 0;
  const totalExpenditure = stats?.total_expenditure ?? 0;
  const totalReleased = stats?.total_released ?? 0;
  const countCompletionRate = ((stats?.completion_rate_by_count ?? 0) * 100).toFixed(1);
  const valueCompletionRate = ((stats?.completion_rate_by_value ?? 0) * 100).toFixed(1);

  /*
    The monthly series, straight from `DashboardStats.trend`.

    What stood here was a six-element array of literal rupee figures — Apr through Aug
    hardcoded, September's three values falling back to hardcoded numbers when the
    dashboard hadn't loaded — rendered as a smooth rising area chart. It described a
    scheme trajectory nobody had measured, and it was the most confident-looking thing
    on the landing page.

    `trend` is `null` when there is nothing dated to roll up, and the chart renders an
    explanatory panel in that case rather than a flat line at zero. The expenditure
    area is gone: `works.expenditure` carries no date, so there is no month to plot it
    against — see `TrendPoint`.
  */
  const trend = stats?.trend ?? null;

  /** Utilisation as a share of what was released, or null when nothing was released. */
  const utilisationPct = totalReleased > 0 ? (totalExpenditure / totalReleased) * 100 : null;

  const openAlerts = stats?.open_alerts ?? 0;
  const backlogAlerts = stats?.backlog_alerts ?? 0;

  /*
    The severity mix, ordered by the catalogue's own severity ladder rather than by
    count, so the bands sit in a stable order across districts and reloads. Severities
    absent from the response are omitted rather than shown as zero — the backend only
    emits a key for a severity that has at least one open or backlogged alert.
  */
  const severityMix: [string, number][] = (
    Object.keys(SEVERITY_RANK) as SeverityLevel[]
  )
    .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])
    .map((s) => [s, stats?.alerts_by_severity?.[s] ?? 0] as [string, number])
    .filter(([, n]) => n > 0);
  const severityMax = severityMix.reduce((m, [, n]) => Math.max(m, n), 0);

  /**
   * The window the corpus actually covers, as "Apr 2023 – Sep 2026", or null when there
   * is no series to read it from. Derived from the trend's first and last month keys,
   * which are `YYYY-MM` strings.
   */
  const observedWindow: string | null = (() => {
    if (!trend || trend.length === 0) return null;
    const label = (key: string) => {
      const [y, m] = key.split('-').map(Number);
      if (!y || !m) return key;
      // `Date.UTC` with day 1 — a month key has no day, and constructing from the
      // local-time constructor would shift the month across the date line.
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    };
    const first = label(trend[0]!.month);
    const last = label(trend[trend.length - 1]!.month);
    return first === last ? first : `${first} – ${last}`;
  })();

  return (
    <div className="space-y-6">
      {/* Dashboard Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            MPLADS Intelligence Dashboard
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Continuous algorithmic integrity telemetry, 10-day field cadence & fund pacing.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/*
            The observed window, read off the trend series. This chip said
            "FY 2024–26" as a literal — a range nobody checked the corpus against, and
            wrong for any corpus that does not happen to span it. It now shows the
            months the data actually covers, and hides itself when there is no series.
          */}
          {observedWindow !== null && (
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-600 shadow-sm hidden sm:flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-slate-900 font-semibold">{observedWindow}</span>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="border-slate-200 text-slate-700 bg-white hover:bg-slate-50 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Report</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleRunAnalysis}
            disabled={analyzing}
            className="shadow-md shadow-blue-600/25 bg-blue-600 hover:bg-blue-700 text-slate-900"
          >
            <Zap className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
            <span>{analyzing ? 'Analyzing...' : 'Trigger Full Audit'}</span>
          </Button>
        </div>
      </div>

      {/* Row 1: Modern 4 KPI Cards */}
      {/*
        No `trend` on the first three cards. They previously carried "+14.2%",
        "+2.1% YoY" and "88.4% pace" as string literals — none computed, none
        sourced, and all three rendered with an upward arrow regardless of the data
        underneath. A year-on-year figure is not derivable from DashboardStats at
        all, which carries no prior-period aggregate to compare against. The risk
        card's trend stays because it is derived from open_alerts.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Sanctioned Capital"
          value={formatCurrency(totalSanctioned)}
          subtitle={`${stats?.total_works ?? 0} active works in corpus`}
          icon={Layers}
          colorScheme="blue"
        />
        <StatCard
          title="Value Completion"
          value={`${valueCompletionRate}%`}
          subtitle={`Published benchmark: ${BENCHMARK_PCT_BY_VALUE.toFixed(2)}% by value`}
          icon={TrendingUp}
          colorScheme="emerald"
        />
        <StatCard
          title="Physical Completion"
          value={`${countCompletionRate}%`}
          subtitle={`${stats?.completed_works ?? 0} works recorded complete · benchmark ${BENCHMARK_PCT_BY_COUNT.toFixed(2)}% by count`}
          icon={CheckCircle2}
          colorScheme="cyan"
        />
        <StatCard
          title="Corroborated Risk Flags"
          value={stats?.open_alerts ?? 0}
          subtitle={`${stats?.backlog_alerts ?? 0} in lower-priority backlog`}
          icon={ShieldAlert}
          colorScheme="rose"
          trend={(stats?.open_alerts ?? 0) > 0 ? "Requires Review" : "Nominal"}
          trendType={(stats?.open_alerts ?? 0) > 0 ? "down" : "up"}
        />
      </div>

      {/* Row 2: Analytics & Pacing Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Main Financial Flow Area Chart */}
        <Card className="lg:col-span-2 p-6 flex flex-col justify-between bg-white border-slate-200 shadow-sm">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Capital Velocity & Disbursements
                </span>
                <div className="flex items-baseline gap-3 mt-1">
                  <h3 className="text-2xl font-bold text-slate-900">
                    {formatCurrency(totalExpenditure)}
                  </h3>
                  {/*
                    Was the literal string "24.1% utilized" with an upward arrow. It is
                    now expenditure over released — the denominator that makes
                    utilisation mean something, since money not yet released cannot
                    have been spent — and it renders '—' rather than a number when
                    nothing has been released.
                  */}
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                    <ArrowUpRight className="w-3 h-3" />
                    {utilisationPct === null
                      ? '— of released spent'
                      : `${utilisationPct.toFixed(1)}% of released spent`}
                  </span>
                </div>
              </div>

              {/* Chart Legend */}
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="text-slate-600 font-medium">Sanctioned</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
                  <span className="text-slate-600 font-medium">Released</span>
                </div>
                {/*
                  No expenditure entry. `works.expenditure` has no date anywhere in the
                  schema, so it cannot be bucketed by month — see `TrendPoint`. The
                  total is in the tile below and in the headline above.
                */}
              </div>
            </div>

            {/* Recharts Area Chart */}
            <div className="h-64 w-full">
              {trend === null ? (
                <div className="h-full flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 text-center">
                  <p className="text-sm font-semibold text-slate-700">
                    No monthly series to chart
                  </p>
                  <p className="text-xs text-slate-500 max-w-md leading-relaxed">
                    Nothing in the corpus carries a date the series can be bucketed on.
                    This panel shows sanctions by <code className="font-mono">sanction_date</code>{' '}
                    and releases by <code className="font-mono">payments.payment_date</code>;
                    with neither present there is nothing to plot, and a flat line at
                    zero would be a claim rather than an absence.
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sanctionedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="releasedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke="#94A3B8"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `₹${(v / 10000000).toFixed(0)}Cr`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#E2E8F0',
                        borderRadius: '0.75rem',
                        fontSize: '11px',
                        color: '#0F172A',
                        boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.1)',
                      }}
                      formatter={(val: any) => [formatCurrency(Number(val)), '']}
                    />
                    <Area type="monotone" dataKey="sanctioned" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#sanctionedGrad)" />
                    <Area type="monotone" dataKey="released" stroke="#06B6D4" strokeWidth={2} fillOpacity={1} fill="url(#releasedGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Segmented Bottom Stats Bar */}
          <div className="grid grid-cols-3 gap-3 pt-4 mt-2 border-t border-slate-100">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] uppercase font-semibold text-slate-400 block">Sanctioned</span>
              <span className="text-sm font-bold text-slate-900 font-mono mt-0.5 block">{formatCurrency(totalSanctioned)}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] uppercase font-semibold text-slate-400 block">Released to Agencies</span>
              {/* `total_released`, not `total_sanctioned * 0.62`. The column was always there. */}
              <span className="text-sm font-bold text-cyan-700 font-mono mt-0.5 block">{formatCurrency(totalReleased)}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] uppercase font-semibold text-slate-400 block">Certified Spent</span>
              <span className="text-sm font-bold text-emerald-700 font-mono mt-0.5 block">{formatCurrency(totalExpenditure)}</span>
            </div>
          </div>
        </Card>

        {/* Right 1 Col: Severity mix & Radial benchmark gauge */}
        <div className="space-y-6 flex flex-col justify-between">
          {/*
            What stood here was a "Peak Casework Velocity" bar chart over a
            Monday-to-Friday `pacingData` literal, captioned "Thursday Peak". Nothing in
            the schema records when an officer opened a case, so no day-of-week series
            can be computed from this corpus at all — the chart was not a stale figure,
            it was a measurement of nothing.

            The severity mix replaces it because it is a real breakdown of a real
            number: `alerts_by_severity` counts OPEN and BACKLOG alerts by severity, and
            the severities come from the rule catalogue.
          */}
          <Card className="p-5 bg-white border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Open Findings by Severity
              </span>
              <span className="text-xs font-bold text-slate-900 font-mono">
                {openAlerts + backlogAlerts}
              </span>
            </div>
            {severityMix.length === 0 ? (
              <p className="text-xs text-slate-500 leading-relaxed py-4">
                No open or backlogged findings in this scope. Run a full audit to
                evaluate the corpus against the rule catalogue.
              </p>
            ) : (
              <div className="space-y-2.5">
                {severityMix.map(([severity, n]) => (
                  <div key={severity} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700">{severity}</span>
                      <span className="font-mono text-slate-500">{n}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${severityTone(severity)}`}
                        style={{ width: `${severityMax > 0 ? (n / severityMax) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
              Bars are scaled to the largest band, not to the total — a severity mix is
              read by comparing bands, and {backlogAlerts} of these are backlogged past
              the district alert budget rather than reviewed and closed.
            </p>
          </Card>

          {/* Radial benchmark gauge — by value, against the 50.71% published figure */}
          <Card className="p-5 flex flex-col items-center justify-center bg-white border-slate-200 shadow-sm">
            <BenchmarkGauge
              percentage={
                typeof stats?.completion_rate_by_value === 'number'
                  ? stats.completion_rate_by_value * 100
                  : null
              }
              target={BENCHMARK_PCT_BY_VALUE}
              label="Fund-to-Completion Ratio (by value)"
            />
          </Card>
        </div>
      </div>

      {/* Row 3: High Density Watchlist Table */}
      <div className="grid grid-cols-1 gap-6">
        <Card className="p-0 overflow-hidden bg-white border-slate-200 shadow-sm">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                High-Priority Asset Watchlist
              </h3>
              <p className="text-xs text-slate-500">
                Active e-SAKSHI works ranked by financial pacing and physical completion.
              </p>
            </div>
            <Link to="/works">
              <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:text-blue-800">
                View All Works <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/80">
                  <th className="py-3 px-4 font-semibold uppercase text-[10px]">e-SAKSHI ID / Project</th>
                  <th className="py-3 px-4 font-semibold uppercase text-[10px]">Category</th>
                  <th className="py-3 px-4 font-semibold uppercase text-[10px]">Status</th>
                  <th className="py-3 px-4 font-semibold uppercase text-[10px]">Physical Progress</th>
                  <th className="py-3 px-4 font-semibold uppercase text-[10px]">Sanctioned</th>
                  <th className="py-3 px-4 text-right font-semibold uppercase text-[10px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {recentWorks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No works found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  recentWorks.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {w.title}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {w.esakshi_work_id || `ID: ${w.id.slice(0, 8)}`} &bull; {w.location_name}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-[11px] text-slate-600 font-medium bg-slate-100 px-2 py-0.5 rounded">
                          {w.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={w.status} />
                      </td>
                      <td className="py-3.5 px-4 min-w-[140px]">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-mono text-slate-600">{w.physical_progress_pct ?? 0}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${(w.physical_progress_pct ?? 0) >= 100 ? 'bg-emerald-500' : (w.physical_progress_pct ?? 0) > 50 ? 'bg-blue-600' : 'bg-amber-500'}`}
                            style={{ width: `${Math.min(w.physical_progress_pct ?? 0, 100)}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-bold font-mono text-slate-900">
                        {formatCurrency(w.sanctioned_amount)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <Link to={`/works/${w.id}`}>
                          <Button variant="outline" size="sm" className="px-2.5 py-1 text-[11px] bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700">
                            <Eye className="w-3 h-3" /> Dossier
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
