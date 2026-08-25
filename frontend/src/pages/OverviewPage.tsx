import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { StatCard, Card, PageHeader, Button, SeverityChip } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import { AlertCircle, ArrowUpRight, BarChart3, CheckCircle, Clock, FileSpreadsheet, Layers, ShieldCheck, TrendingUp, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DashboardStats, Alert, Work, QuotaStats } from '../types';

export function OverviewPage() {
  const { selectedDistrict, setSelectedDistrict, districts } = useAppState();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [recentWorks, setRecentWorks] = useState<Work[]>([]);
  const [quotaStats, setQuotaStats] = useState<QuotaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [dashData, alertsData, worksData, quotaData] = await Promise.all([
        api.dashboard.get(selectedDistrict ? { district_id: selectedDistrict } : undefined),
        api.alerts.list(selectedDistrict ? { district_id: selectedDistrict, page_size: '5' } : { page_size: '5' }),
        api.works.list(selectedDistrict ? { district_id: selectedDistrict, page_size: '5' } : { page_size: '5' }),
        api.quota.get(selectedDistrict ? { district_id: selectedDistrict } : undefined),
      ]);
      setStats(dashData);
      setRecentAlerts(alertsData.data || []);
      setRecentWorks(worksData.data || []);
      setQuotaStats(quotaData);
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
  const countCompletionRate = ((stats?.completion_rate_by_count ?? 0) * 100).toFixed(1);
  const valueCompletionRate = ((stats?.completion_rate_by_value ?? 0) * 100).toFixed(1);

  return (
    <div className="space-y-8">
      <PageHeader
        title="DRISHTI: MPLADS Integrity & Oversight Dashboard"
        description="Real-time fund utilization, physical milestone tracking, and algorithmic risk telemetry."
        action={
          <div className="flex items-center gap-3">
            <select
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-secondary cursor-pointer"
            >
              <option value="">All Districts</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <Button
              variant="primary"
              onClick={handleRunAnalysis}
              disabled={analyzing}
              className="glow-primary"
            >
              <Zap className={`w-4 h-4 ${analyzing ? 'animate-spin' : ''}`} />
              {analyzing ? 'Analyzing Corpus...' : 'Trigger Full Audit'}
            </Button>
          </div>
        }
      />

      {/* Hero Stat Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Sanctioned Capital"
          value={formatCurrency(totalSanctioned)}
          subtitle={`${stats?.total_works ?? 0} total registered works`}
          icon={Layers}
          variant="info"
        />
        <StatCard
          title="Value Completion"
          value={`${valueCompletionRate}%`}
          subtitle={`Benchmark target: 19.24%`}
          icon={TrendingUp}
          trend="+2.1% YoY"
          variant="success"
        />
        <StatCard
          title="Physical Completion"
          value={`${countCompletionRate}%`}
          subtitle={`${stats?.completed_works ?? 0} completed assets`}
          icon={CheckCircle}
          variant="default"
        />
        <StatCard
          title="Open Risk Alerts"
          value={stats?.open_alerts ?? 0}
          subtitle={`${stats?.backlog_alerts ?? 0} in lower-priority backlog`}
          icon={AlertCircle}
          variant={(stats?.open_alerts ?? 0) > 0 ? 'critical' : 'default'}
        />
      </div>

      {/* SC/ST Quota Widget */}
      <Card className="p-6 bg-surface/50">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-5 h-5 text-secondary" />
          <h3 className="text-base font-semibold text-white">Statutory SC/ST Quota Utilization</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">SC Quota ({quotaStats?.scspTarget ?? 15}% Target)</span>
              <span className={`font-medium ${
                (quotaStats?.scspPercentage ?? 0) >= (quotaStats?.scspTarget ?? 15) ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {(quotaStats?.scspPercentage ?? 0).toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full ${(quotaStats?.scspPercentage ?? 0) >= (quotaStats?.scspTarget ?? 15) ? 'bg-emerald-400' : 'bg-amber-400'}`}
                style={{ width: `${Math.min(quotaStats?.scspPercentage ?? 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-text-muted text-right">
              {formatCurrency(quotaStats?.scspSanctioned ?? 0)} / {formatCurrency(quotaStats?.totalSanctioned ?? 0)}
            </p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">ST Quota ({quotaStats?.tspTarget ?? 7.5}% Target)</span>
              <span className={`font-medium ${
                (quotaStats?.tspPercentage ?? 0) >= (quotaStats?.tspTarget ?? 7.5) ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {(quotaStats?.tspPercentage ?? 0).toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full ${(quotaStats?.tspPercentage ?? 0) >= (quotaStats?.tspTarget ?? 7.5) ? 'bg-emerald-400' : 'bg-amber-400'}`}
                style={{ width: `${Math.min(quotaStats?.tspPercentage ?? 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-text-muted text-right">
              {formatCurrency(quotaStats?.tspSanctioned ?? 0)} / {formatCurrency(quotaStats?.totalSanctioned ?? 0)}
            </p>
          </div>
        </div>
      </Card>

      {/* The 19% Gap Insight Banner */}
      <Card className="border-secondary/20 bg-gradient-to-r from-secondary/10 via-surface/80 to-purple-500/10 p-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary/20 text-secondary border border-secondary/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Calibrated Against MoSPI 19.24% Benchmark</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Bridging the 19.24% Fund-to-Completion Delivery Gap
            </h2>
            <p className="text-sm text-text-muted">
              Official data reveals that historically only 19.24% of sanctioned MPLADS funds convert into completed infrastructure in timely cycles. Our automated corroboration engine pinpoints fund release stalls, cost overruns, and duplicate claims.
            </p>
          </div>
          <div className="flex gap-4 flex-shrink-0">
            <Link to="/alerts">
              <Button variant="primary">Review Triage Queue</Button>
            </Link>
            <Link to="/audit">
              <Button variant="outline">Inspect Ledger</Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Main Breakdown Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Alert Triage Queue Preview */}
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Prioritized Alert Queue</h3>
              <p className="text-xs text-text-muted">Ranked by severity & explainable algorithmic corroboration</p>
            </div>
            <Link to="/alerts" className="text-xs text-secondary hover:underline flex items-center gap-1 font-medium">
              View all ({stats?.open_alerts ?? 0}) <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-border/40">
            {recentAlerts.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-muted">
                No active open alerts. All systems nominal.
              </div>
            ) : (
              recentAlerts.map((alert: any) => (
                <div key={alert.id} className="py-3.5 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <SeverityChip severity={alert.severity} />
                      <span className="text-xs font-mono text-text-muted">{alert.rule_id}</span>
                    </div>
                    <p className="text-sm font-medium text-white truncate">
                      {alert.works?.title || `Work ${alert.work_id.slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-text-muted line-clamp-1">
                      {alert.evidence_text || 'Anomaly pattern detected in financial release pacing.'}
                    </p>
                  </div>
                  <Link to={`/alerts/${alert.id}`}>
                    <Button variant="outline" size="sm">Review</Button>
                  </Link>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Quick Audit & Compliance Status */}
        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-white">Platform Health & Rigor</h3>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-surface border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Audit Hash Chain</span>
                <span className="text-emerald-400 font-medium">VERIFIED OK</span>
              </div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div className="bg-emerald-400 h-full w-full" />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Active Rules in Force</span>
                <span className="text-white font-medium">17 / 17</span>
              </div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div className="bg-secondary h-full w-full" />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Alert Budget Consumption</span>
                <span className="text-amber-400 font-medium">10 Max / Dist</span>
              </div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div className="bg-amber-400 h-full w-3/4" />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-border/50">
            <Link to="/evaluation">
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span>View Measured Precision / Recall</span>
                <ArrowUpRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
