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
      setAlerts(res || []);
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
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search works, rules, evidence..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
            />
          </div>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
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
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="OPEN">Open (Active Budget)</option>
            <option value="BACKLOG">Backlog (Overflow)</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="DISMISSED">Dismissed</option>
            <option value="ESCALATED">Escalated</option>
          </select>
        </div>

        <div className="text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-900">{filteredAlerts.length}</span> alerts
        </div>
      </div>

      {/* Alert Feed */}
      {loading ? (
        <div className="p-12 flex justify-center items-center">
          <Spinner className="w-8 h-8 text-blue-600" />
        </div>
      ) : filteredAlerts.length === 0 ? (
        <Card className="p-12 text-center flex flex-col items-center justify-center bg-white border-slate-200">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-3" />
          <p className="text-base font-semibold text-slate-900">Queue Empty</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            All flagged anomalies in the current filter scope have been triaged and resolved.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredAlerts.map((alert: any) => (
            <Card
              key={alert.id}
              className="p-5 dashboard-card-hover bg-white border-slate-200 shadow-xs group"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <SeverityChip severity={alert.severity} />
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                      {alert.rule_id}
                    </span>
                    <span className="text-xs text-slate-400">
                      Created {new Date(alert.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <h4 className="text-base font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors">
                    {alert.works?.title || 'Unknown Work Item'}
                  </h4>

                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {alert.evidence_text || 'No evidence summary available.'}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-slate-500 pt-1">
                    <span>Category: <strong className="text-slate-800 font-medium">{alert.works?.category || 'General'}</strong></span>
                    <span>Status: <strong className="text-slate-800 font-medium">{alert.works?.status || 'N/A'}</strong></span>
                    {alert.confidence && (
                      <span>Confidence: <strong className="text-slate-800 font-medium">{(alert.confidence * 100).toFixed(0)}%</strong></span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-center">
                  <Link to={`/alerts/${alert.id}`}>
                    <Button variant="primary" size="sm" className="bg-blue-600 hover:bg-blue-700 text-slate-900 shadow-sm shadow-blue-600/25">
                      <span>Triage Dossier</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
