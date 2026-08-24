import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { PageHeader, Card, Button, StatusBadge, SeverityChip, Spinner } from '../components/ui';
import { formatCurrency, formatDate } from '../lib/utils';
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Download, FileText, IndianRupee, Layers, MapPin, ShieldAlert, User } from 'lucide-react';
import type { Work, Alert, Payment, Document } from '../types';

export function WorkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [work, setWork] = useState<(Work & { alerts?: Alert[]; payments?: Payment[]; documents?: Document[] }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const loadWork = async () => {
      try {
        setLoading(true);
        const data = await api.works.get(id);
        setWork(data);
      } catch (err) {
        console.error('Failed to fetch work detail:', err);
      } finally {
        setLoading(false);
      }
    };
    loadWork();
  }, [id]);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-text-muted">
        <Spinner className="w-8 h-8" />
        <p className="text-sm">Retrieving work asset record...</p>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="py-16 text-center text-text-muted space-y-4">
        <p className="text-base font-semibold text-white">Work record not found</p>
        <Button onClick={() => navigate('/works')}>Return to Directory</Button>
      </div>
    );
  }

  const payments = work.payments || [];
  const documents = work.documents || [];
  const alerts = work.alerts || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/works')}
          className="p-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <PageHeader
          title={work.title}
          description={`Asset Dossier &bull; e-SAKSHI ID: ${work.esakshi_work_id || work.id.slice(0, 8)}`}
          action={<StatusBadge status={work.status} />}
        />
      </div>

      {/* Primary Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <p className="text-xs text-text-muted font-medium">Sanctioned Capital</p>
          <p className="text-xl font-bold text-white">{formatCurrency(work.sanctioned_amount || 0)}</p>
          <p className="text-xs text-text-muted">Sanction Date: {work.sanction_date ? formatDate(work.sanction_date) : 'N/A'}</p>
        </Card>
        <Card className="p-4 space-y-1">
          <p className="text-xs text-text-muted font-medium">Released Funds</p>
          <p className="text-xl font-bold text-white">{formatCurrency(work.released_amount || 0)}</p>
          <p className="text-xs text-text-muted">
            {work.sanctioned_amount ? `${((work.released_amount / work.sanctioned_amount) * 100).toFixed(0)}% disbursed` : 'N/A'}
          </p>
        </Card>
        <Card className="p-4 space-y-1">
          <p className="text-xs text-text-muted font-medium">Expenditure</p>
          <p className="text-xl font-bold text-white">{formatCurrency(work.expenditure || 0)}</p>
          <p className="text-xs text-text-muted">UC Filed: {work.has_uc ? 'YES' : 'PENDING'}</p>
        </Card>
        <Card className="p-4 space-y-1">
          <p className="text-xs text-text-muted font-medium">Physical Milestone</p>
          <p className="text-xl font-bold text-emerald-400">{work.physical_progress_pct || 0}%</p>
          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mt-2">
            <div
              className="bg-emerald-400 h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, work.physical_progress_pct || 0))}%` }}
            />
          </div>
        </Card>
      </div>

      {/* Grid: Main Info + Alerts Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Metadata & Attributes */}
          <Card className="space-y-4">
            <h3 className="text-base font-semibold text-white">Project Specification</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-text-muted">Category:</span>
                <p className="font-semibold text-white mt-0.5">{work.category}</p>
              </div>
              <div>
                <span className="text-text-muted">Location:</span>
                <p className="font-semibold text-white mt-0.5">{work.location_name || 'District HQ'}</p>
              </div>
              <div>
                <span className="text-text-muted">MP Recommendation:</span>
                <p className="font-semibold text-white mt-0.5">{work.mp_name || 'Hon. Member of Parliament'}</p>
              </div>
              <div>
                <span className="text-text-muted">GPS Coordinates:</span>
                <p className="font-mono text-white mt-0.5">
                  {work.latitude && work.longitude ? `${work.latitude.toFixed(4)}, ${work.longitude.toFixed(4)}` : 'Geotagging Pending'}
                </p>
              </div>
              <div>
                <span className="text-text-muted">Special Allocation:</span>
                <p className="font-semibold text-white mt-0.5">
                  {work.is_scsp ? 'SCSP Component' : work.is_tsp ? 'TSP Component' : 'General Scheme'}
                </p>
              </div>
              <div>
                <span className="text-text-muted">Target Completion:</span>
                <p className="font-semibold text-white mt-0.5">{work.completion_target_date || 'Standard 24 Months'}</p>
              </div>
            </div>
          </Card>

          {/* Payments & Disbursements Table */}
          <Card className="space-y-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-secondary" />
              <span>Financial Disbursements & Installments</span>
            </h3>

            {payments.length === 0 ? (
              <p className="text-xs text-text-muted py-4 text-center">No individual installment payment records logged.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/50 text-text-muted">
                      <th className="py-2.5 px-3">Inst. #</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Disbursement Date</th>
                      <th className="py-2.5 px-3">Purpose / Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30 text-white">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 px-3 font-mono">#{p.installment_number}</td>
                        <td className="py-2.5 px-3 font-bold">{formatCurrency(p.amount)}</td>
                        <td className="py-2.5 px-3 text-text-muted">{formatDate(p.payment_date)}</td>
                        <td className="py-2.5 px-3 text-text-muted">{p.purpose || 'Milestone advance'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Associated Alerts */}
        <div className="space-y-6">
          <Card className="space-y-4 border-destructive/20 bg-destructive/5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-destructive" />
                <span>Corroborated Risk Alerts</span>
              </h3>
              <span className="text-xs font-bold text-destructive">{alerts.length}</span>
            </div>

            {alerts.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-muted space-y-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                <p className="text-white font-medium">Zero Compliance Flags</p>
                <p>All financial and milestone parameters conform to guidelines.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((a) => (
                  <div key={a.id} className="p-3.5 rounded-lg bg-surface border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <SeverityChip severity={a.severity} />
                      <span className="text-xs font-mono text-secondary">{a.rule_id}</span>
                    </div>
                    <p className="text-xs text-text-muted line-clamp-2">{a.evidence_text}</p>
                    <Link to={`/alerts/${a.id}`}>
                      <Button variant="outline" size="sm" className="w-full mt-2">
                        Inspect Evidence
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
