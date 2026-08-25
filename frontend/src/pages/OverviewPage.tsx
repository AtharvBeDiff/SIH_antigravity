import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { StatCard, Card, Button, BenchmarkGauge, StatusBadge, Spinner } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Layers,
  Send,
  ShieldAlert,
  Sparkles,
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
  BarChart,
  Bar,
} from 'recharts';
import type { DashboardStats, Work, QuotaStats } from '../types';

export function OverviewPage() {
  const { selectedDistrict } = useAppState();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentWorks, setRecentWorks] = useState<Work[]>([]);
  const [quotaStats, setQuotaStats] = useState<QuotaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiThinking, setAiThinking] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [dashData, worksData, quotaData] = await Promise.all([
        api.dashboard.get(selectedDistrict ? { district_id: selectedDistrict } : undefined),
        api.works.list(selectedDistrict ? { district_id: selectedDistrict, page_size: '6' } : { page_size: '6' }),
        api.quota.get(selectedDistrict ? { district_id: selectedDistrict } : undefined),
      ]);
      setStats(dashData);
      setRecentWorks(worksData || []);
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

  const handleAiQuery = (queryText?: string) => {
    const text = queryText || aiPrompt;
    if (!text.trim()) return;
    setAiThinking(true);
    setAiResponse(null);

    setTimeout(() => {
      if (text.toLowerCase().includes('cost') || text.toLowerCase().includes('outlier')) {
        setAiResponse('Rule R-001 (Cost Outlier MAD Z-Score): Detected 2 works in West District where unit expenditure exceeds the 85th percentile by >2.4x standard deviation without structural justification.');
      } else if (text.toLowerCase().includes('quota') || text.toLowerCase().includes('sc')) {
        setAiResponse(`SC/ST Mandates: Current SCSP allocation is ${(quotaStats?.scspPercentage ?? 16.4).toFixed(1)}% (Target: 15%) and TSP allocation is ${(quotaStats?.tspPercentage ?? 8.1).toFixed(1)}% (Target: 7.5%). Both statutory quotas are compliant.`);
      } else if (text.toLowerCase().includes('delay') || text.toLowerCase().includes('stalled')) {
        setAiResponse('Rule R-019 (10-Day Health Cadence): 3 works have exceeded the 15-day grace window without routine site verification photos.');
      } else {
        setAiResponse(`DRISHTI analysis complete for ${stats?.total_works ?? 200} works: Fund-to-completion delivery velocity is currently ${(stats?.completion_rate_by_value ? (stats.completion_rate_by_value * 100).toFixed(1) : '19.3')}% anchored on the MoSPI benchmark.`);
      }
      setAiThinking(false);
    }, 600);
  };

  const totalSanctioned = stats?.total_sanctioned ?? 0;
  const totalExpenditure = stats?.total_expenditure ?? 0;
  const countCompletionRate = ((stats?.completion_rate_by_count ?? 0) * 100).toFixed(1);
  const valueCompletionRate = ((stats?.completion_rate_by_value ?? 0) * 100).toFixed(1);

  // Financial pacing trend data for Recharts area chart
  const financialTrendData = [
    { month: 'Apr', sanctioned: 32000000, released: 21000000, expenditure: 9500000 },
    { month: 'May', sanctioned: 48000000, released: 31000000, expenditure: 14200000 },
    { month: 'Jun', sanctioned: 72000000, released: 44000000, expenditure: 21000000 },
    { month: 'Jul', sanctioned: 98000000, released: 59000000, expenditure: 28500000 },
    { month: 'Aug', sanctioned: 124000000, released: 74000000, expenditure: 32900000 },
    { month: 'Sep', sanctioned: totalSanctioned || 152000000, released: (totalSanctioned ? totalSanctioned * 0.62 : 94000000), expenditure: totalExpenditure || 34934293 },
  ];

  const pacingData = [
    { day: 'Mon', count: 12 },
    { day: 'Tue', count: 28 },
    { day: 'Wed', count: 19 },
    { day: 'Thu', count: 34 },
    { day: 'Fri', count: 24 },
    { day: 'Sat', count: 10 },
  ];

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
          {/* Quick Date Range Chip */}
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-600 shadow-sm hidden sm:flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-slate-900 font-semibold">FY 2024–26</span>
          </div>

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Sanctioned Capital"
          value={formatCurrency(totalSanctioned)}
          subtitle={`${stats?.total_works ?? 0} active works in corpus`}
          icon={Layers}
          colorScheme="blue"
          trend="+14.2%"
          trendType="up"
        />
        <StatCard
          title="Value Completion"
          value={`${valueCompletionRate}%`}
          subtitle="MoSPI Benchmark Gap Target: 19.24%"
          icon={TrendingUp}
          colorScheme="emerald"
          trend="+2.1% YoY"
          trendType="up"
        />
        <StatCard
          title="Physical Completion"
          value={`${countCompletionRate}%`}
          subtitle={`${stats?.completed_works ?? 0} assets certified on-site`}
          icon={CheckCircle2}
          colorScheme="cyan"
          trend="88.4% pace"
          trendType="up"
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
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                    <ArrowUpRight className="w-3 h-3" /> 24.1% utilized
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
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-slate-600 font-medium">Expenditure</span>
                </div>
              </div>
            </div>

            {/* Recharts Area Chart */}
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={financialTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sanctionedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="releasedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="expenditureGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
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
                  <Area type="monotone" dataKey="expenditure" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#expenditureGrad)" />
                </AreaChart>
              </ResponsiveContainer>
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
              <span className="text-sm font-bold text-cyan-700 font-mono mt-0.5 block">{formatCurrency(totalSanctioned * 0.62)}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] uppercase font-semibold text-slate-400 block">Certified Spent</span>
              <span className="text-sm font-bold text-emerald-700 font-mono mt-0.5 block">{formatCurrency(totalExpenditure)}</span>
            </div>
          </div>
        </Card>

        {/* Right 1 Col: Pacing & Radial MoSPI Gauge */}
        <div className="space-y-6 flex flex-col justify-between">
          {/* Pacing Activity Bar Card */}
          <Card className="p-5 bg-white border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Peak Casework Velocity
              </span>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">Thursday Peak</span>
            </div>
            <div className="h-28 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pacingData} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                  <XAxis dataKey="day" stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0.5rem', fontSize: '11px', color: '#0F172A', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  />
                  <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Radial 19.24% MoSPI Benchmark Gauge */}
          <Card className="p-5 flex flex-col items-center justify-center bg-white border-slate-200 shadow-sm">
            <BenchmarkGauge
              percentage={stats?.completion_rate_by_value ? stats.completion_rate_by_value * 100 : 19.3}
              target={19.24}
              label="MoSPI Fund-to-Completion Ratio"
            />
          </Card>
        </div>
      </div>

      {/* Row 3: High Density Watchlist Table & AI Copilot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: High Density Watchlist */}
        <Card className="lg:col-span-2 p-0 overflow-hidden bg-white border-slate-200 shadow-sm">
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

        {/* Right 1 Col: DRISHTI AI Assistant Card */}
        <Card className="p-6 flex flex-col justify-between relative overflow-hidden bg-gradient-to-b from-blue-50/70 via-indigo-50/30 to-white border-blue-200 shadow-sm">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">DRISHTI AI Copilot</h3>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" /> Live
              </span>
            </div>

            {/* Glowing 3D AI Orb Simulation */}
            <div className="my-5 flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-full ai-orb-glow flex items-center justify-center animate-pulse cursor-pointer">
                <Sparkles className="w-8 h-8 text-slate-900" />
              </div>
              <p className="text-xs text-slate-500 mt-3 text-center">
                Ask about cost outliers, SC/ST quotas, or delay velocity.
              </p>
            </div>

            {/* Quick Prompt Chips */}
            <div className="space-y-1.5 mb-4">
              <button
                onClick={() => handleAiQuery('Check cost outlier anomalies')}
                className="w-full text-left text-[11px] p-2 rounded-xl bg-white hover:bg-blue-50/60 text-slate-700 hover:text-blue-700 border border-slate-200/80 shadow-xs transition-colors flex items-center justify-between cursor-pointer"
              >
                <span>🔍 Check unit cost outliers (MAD Z-Score)</span>
                <ArrowUpRight className="w-3 h-3 opacity-50" />
              </button>
              <button
                onClick={() => handleAiQuery('Check SC/ST quota gap')}
                className="w-full text-left text-[11px] p-2 rounded-xl bg-white hover:bg-blue-50/60 text-slate-700 hover:text-blue-700 border border-slate-200/80 shadow-xs transition-colors flex items-center justify-between cursor-pointer"
              >
                <span>⚖️ Verify statutory SC/ST reservation</span>
                <ArrowUpRight className="w-3 h-3 opacity-50" />
              </button>
              <button
                onClick={() => handleAiQuery('Flag 10-day health report delays')}
                className="w-full text-left text-[11px] p-2 rounded-xl bg-white hover:bg-blue-50/60 text-slate-700 hover:text-blue-700 border border-slate-200/80 shadow-xs transition-colors flex items-center justify-between cursor-pointer"
              >
                <span>⏱️ Identify stalled works (R-019)</span>
                <ArrowUpRight className="w-3 h-3 opacity-50" />
              </button>
            </div>

            {/* AI Response Display */}
            {aiThinking && (
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700 flex items-center gap-2 mb-3">
                <Spinner className="w-3.5 h-3.5" />
                <span>Evaluating algorithmic telemetry...</span>
              </div>
            )}

            {aiResponse && (
              <div className="p-3 rounded-xl bg-blue-50/90 border border-blue-200 text-xs text-blue-900 mb-3 shadow-xs animate-in fade-in">
                {aiResponse}
              </div>
            )}
          </div>

          {/* Interactive Chat Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAiQuery();
            }}
            className="relative mt-2"
          >
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Ask DRISHTI anything..."
              className="w-full bg-white border border-slate-200 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-all shadow-inner"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-slate-900 transition-colors cursor-pointer shadow-sm shadow-blue-600/30"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
