import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { PageHeader, Card, Button, SeverityChip, Spinner } from '../components/ui';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, ChevronRight, Filter, Search, XCircle } from 'lucide-react';
import type { Alert } from '../types';

export function QueuePage() {
  const { selectedDistrict } = useAppState();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('OPEN');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const loadAlerts = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {
        page_size: '50',
      };
      if (selectedDistrict) params['district_id'] = selectedDistrict;
      if (filterSeverity) params['severity'] = filterSeverity;
      if (filterStatus) params['status'] = filterStatus;

      const res = await api.alerts.list(params);
      setAlerts(res.data || []);
    } catch (err) {
      console.error('Failed to load alert queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [selectedDistrict, filterSeverity, filterStatus]);

  const filteredAlerts = alerts.filter((a: any) => {
    if (!searchTerm) return true;
    const title = a.works?.title || '';
    const text = a.evidence_text || '';
    return (
      title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      text.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.rule_id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Officer Triage & Casework Queue"
        description="Prioritized risk alerts ranked by severity and algorithmic confidence."
      />

      {/* Control & Filter Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-xl glass-panel">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search works, rules, evidence..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-secondary"
            />
          </div>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-secondary cursor-pointer"
          >
            <option value="">All Severities</option>
            <option value="CRITICAL">Critical Only</option>
            <option value="HIGH">High Only</option>
            <option value="MEDIUM">Medium Only</option>
            <option value="LOW">Low Only</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-secondary cursor-pointer"
          >
            <option value="OPEN">Open (Active Budget)</option>
            <option value="BACKLOG">Backlog (Overflow)</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="DISMISSED">Dismissed</option>
            <option value="ESCALATED">Escalated</option>
          </select>
        </div>

        <div className="text-xs text-text-muted">
          Showing <span className="font-semibold text-white">{filteredAlerts.length}</span> alerts
        </div>
      </div>

      {/* Alert List */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-text-muted">
            <Spinner className="w-8 h-8" />
            <p className="text-sm">Loading triage queue...</p>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2 text-center text-text-muted">
            <CheckCircle2 className="w-10 h-10 text-emerald-400/80 mb-2" />
            <p className="text-base font-semibold text-white">Queue Empty</p>
            <p className="text-sm max-w-sm">No open alerts match your selected filters and district parameters.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filteredAlerts.map((alert: any) => (
              <div
                key={alert.id}
                className="p-5 hover:bg-white/[0.02] transition-colors flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4"
              >
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityChip severity={alert.severity} />
                    <span className="text-xs font-mono font-bold text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20">
                      {alert.rule_id}
                    </span>
                    <span className="text-xs text-text-muted">
                      Rank #{alert.severity_rank}
                    </span>
                    {!alert.in_budget && (
                      <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                        Backlog
                      </span>
                    )}
                  </div>

                  <div>
                    <h4 className="text-base font-semibold text-white truncate">
                      {alert.works?.title || `Work ${alert.work_id}`}
                    </h4>
                    <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                      {alert.evidence_text || 'Automated compliance rule triggered based on financial & physical milestone analysis.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-text-muted">
                    <span>Category: <strong className="text-white">{alert.works?.category || 'General'}</strong></span>
                    <span>Status: <strong className="text-white">{alert.works?.status || 'N/A'}</strong></span>
                    {alert.confidence && (
                      <span>Confidence: <strong className="text-white">{(alert.confidence * 100).toFixed(0)}%</strong></span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0 w-full lg:w-auto justify-end pt-2 lg:pt-0 border-t lg:border-t-0 border-border/30">
                  <Link to={`/alerts/${alert.id}`}>
                    <Button variant="primary" size="sm">
                      <span>Investigate</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
