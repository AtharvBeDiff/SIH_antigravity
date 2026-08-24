import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { PageHeader, Card, Button, SeverityChip, StatusBadge, Spinner } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import { AlertCircle, ArrowLeft, CheckCircle, FileText, History, Info, ShieldAlert, XCircle } from 'lucide-react';
import type { Alert, Work, AuditEvent } from '../types';

const DISMISS_REASONS = [
  { code: 'APPROVED_DELAY', label: 'Approved Delay / Extension by Authority' },
  { code: 'GENUINE_COST_REVISION', label: 'Genuine Material/Scope Cost Revision' },
  { code: 'DATA_ENTRY_CORRECTION', label: 'Data Entry / Transposition Error' },
  { code: 'EXEMPTED_SCHEME_CATEGORY', label: 'Exempted / Special Sanction Scheme' },
  { code: 'INSPECTION_VERIFIED_PHYSICAL', label: 'Physically Verified by Field Officer' },
  { code: 'OTHER', label: 'Other Operational Rationale' },
];

export function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Review Form state
  const [selectedAction, setSelectedAction] = useState<'ACKNOWLEDGED' | 'DISMISSED' | 'ESCALATED'>('ACKNOWLEDGED');
  const [dismissReason, setDismissReason] = useState<string>('APPROVED_DELAY');
  const [reviewNote, setReviewNote] = useState<string>('');

  const loadDetail = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const alertData = await api.alerts.get(id);
      setAlert(alertData);

      if (alertData.work_id) {
        const [workData, auditData] = await Promise.all([
          api.works.get(alertData.work_id),
          api.audit.list({ entity_id: id }),
        ]);
        setWork(workData);
        setAuditEvents(auditData.data || []);
      }
    } catch (err) {
      console.error('Failed to load alert detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [id]);

  const handleReview = async () => {
    if (!id) return;
    try {
      setSubmitting(true);
      await api.alerts.review(
        id,
        selectedAction,
        selectedAction === 'DISMISSED' ? dismissReason : undefined,
        reviewNote || undefined
      );
      await loadDetail();
    } catch (err) {
      console.error('Failed to submit review:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-text-muted">
        <Spinner className="w-8 h-8" />
        <p className="text-sm">Loading alert casework dossier...</p>
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="py-16 text-center text-text-muted space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-lg font-bold text-white">Alert Not Found</h2>
        <Button onClick={() => navigate('/alerts')}>Return to Queue</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/alerts')}
          className="p-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <PageHeader
          title={`Casework Dossier: ${alert.rule_id}`}
          description={`Logged alert for work ${work?.title || alert.work_id}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Evidence & Work Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Explainable Evidence Card */}
          <Card className="space-y-4 border-secondary/30 bg-secondary/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SeverityChip severity={alert.severity} />
                <span className="text-xs font-mono font-bold text-secondary">{alert.rule_id}</span>
              </div>
              <span className="text-xs text-text-muted">
                Confidence: <strong className="text-white">{((alert.confidence || 0.85) * 100).toFixed(0)}%</strong>
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-semibold text-white">Algorithmic Evidence Statement</h3>
              <p className="text-sm text-text-main leading-relaxed bg-surface/90 p-4 rounded-lg border border-white/5 font-mono text-xs">
                {alert.evidence_text || 'Standard rule variance violation detected against threshold parameters.'}
              </p>
            </div>

            <div className="text-xs text-text-muted flex items-center gap-2">
              <Info className="w-4 h-4 text-secondary" />
              <span>
                All evidence is reproducible and pinned to the tamper-evident hash ledger.
              </span>
            </div>
          </Card>

          {/* Associated Work Overview */}
          {work && (
            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Project Infrastructure Record</h3>
                <Link to={`/works/${work.id}`} className="text-xs text-secondary hover:underline">
                  View Full Asset Page →
                </Link>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg bg-surface border border-white/5">
                <div>
                  <p className="text-xs text-text-muted">Sanctioned Capital</p>
                  <p className="text-sm font-bold text-white mt-0.5">{formatCurrency(work.sanctioned_amount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Expenditure</p>
                  <p className="text-sm font-bold text-white mt-0.5">{formatCurrency(work.expenditure || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Physical Progress</p>
                  <p className="text-sm font-bold text-white mt-0.5">{work.physical_progress_pct || 0}%</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Lifecycle Status</p>
                  <div className="mt-0.5"><StatusBadge status={work.status} /></div>
                </div>
              </div>
            </Card>
          )}

          {/* Audit Chain Ledger for this Alert */}
          <Card className="space-y-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-secondary" />
              <span>Immutable Action Audit Trail</span>
            </h3>

            {auditEvents.length === 0 ? (
              <p className="text-xs text-text-muted">No state mutations recorded for this alert entity yet.</p>
            ) : (
              <div className="divide-y divide-border/40">
                {auditEvents.map((evt) => (
                  <div key={evt.seq} className="py-2.5 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-secondary">#{evt.seq} {evt.action}</span>
                      <span className="text-text-muted">{new Date(evt.created_at).toLocaleString('en-IN')}</span>
                    </div>
                    <p className="text-text-muted">
                      Actor: <strong className="text-white">{evt.actor}</strong> &bull; Hash: <code className="text-xs font-mono">{evt.this_hash.slice(0, 16)}...</code>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Officer Action Panel */}
        <div className="space-y-6">
          <Card className="space-y-5 border-secondary/20">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-white">Officer Triage Decision</h3>
              <p className="text-xs text-text-muted">
                Your decision will be stamped onto the audit hash ledger.
              </p>
            </div>

            {/* Current State Indicator */}
            <div className="p-3 rounded-lg bg-surface border border-white/5 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Current Decision Status:</span>
                <strong className="text-white">{alert.status}</strong>
              </div>
              {alert.reviewed_by && (
                <p className="text-text-muted">
                  Reviewed by <span className="text-secondary">{alert.reviewed_by}</span> on {alert.reviewed_at?.slice(0, 10)}
                </p>
              )}
            </div>

            {/* Action Select */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-muted">Select Action</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAction('ACKNOWLEDGED')}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    selectedAction === 'ACKNOWLEDGED'
                      ? 'bg-secondary/20 border-secondary text-secondary'
                      : 'bg-surface border-border text-text-muted hover:text-white'
                  }`}
                >
                  Acknowledge
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedAction('DISMISSED')}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    selectedAction === 'DISMISSED'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-surface border-border text-text-muted hover:text-white'
                  }`}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedAction('ESCALATED')}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    selectedAction === 'ESCALATED'
                      ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                      : 'bg-surface border-border text-text-muted hover:text-white'
                  }`}
                >
                  Escalate
                </button>
              </div>
            </div>

            {/* Dismissal Reason Code (Mandatory for Dismiss) */}
            {selectedAction === 'DISMISSED' && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-amber-300">
                  Mandatory Dismissal Reason Code
                </label>
                <select
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  className="w-full bg-surface border border-amber-500/40 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  {DISMISS_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes Input */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-muted">
                Official Rationale Note
              </label>
              <textarea
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Enter justification or field verification notes..."
                className="w-full bg-surface border border-border rounded-lg p-2.5 text-xs text-white placeholder-text-muted focus:outline-none focus:border-secondary"
              />
            </div>

            <Button
              variant="primary"
              onClick={handleReview}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? 'Recording Audit...' : `Commit ${selectedAction} Decision`}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
