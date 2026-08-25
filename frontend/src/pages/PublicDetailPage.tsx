import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader, Card, Button, StatusBadge, Spinner } from '../components/ui';
import { formatCurrency, formatDate } from '../lib/utils';
import { ArrowLeft, Building, Calendar, CheckCircle2, Globe, MapPin } from 'lucide-react';
import type { PublicWork } from '../types';

export function PublicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [work, setWork] = useState<PublicWork | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/public/works/${id}`)
      .then(res => res.json())
      .then(json => setWork(json.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="py-24 flex justify-center">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!work) {
    return (
      <div className="py-16 text-center text-slate-500 space-y-4">
        <p className="text-slate-900 font-medium">Public project record not found.</p>
        <Button onClick={() => navigate('/public')}>Return to Public Portal</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/public')}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <PageHeader
          title={work.title}
          description={`Constituency: ${work.constituency_name} &bull; District: ${work.district_name}`}
          action={<StatusBadge status={work.status} />}
        />
      </div>

      {/* Hero Financials */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 space-y-1">
          <span className="text-xs text-slate-500">Total Sanctioned Capital</span>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(work.sanctioned_amount)}</p>
          <p className="text-xs text-slate-500">Sanction Date: {formatDate(work.sanction_date)}</p>
        </Card>
        <Card className="p-4 space-y-1">
          <span className="text-xs text-slate-500">Documented Expenditure</span>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(work.expenditure)}</p>
          <p className="text-xs text-slate-500">Direct benefit to local community</p>
        </Card>
        <Card className="p-4 space-y-1">
          <span className="text-xs text-slate-500">Physical Completion</span>
          <p className="text-xl font-bold text-emerald-400">{work.physical_progress_pct}%</p>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
            <div
              className="bg-emerald-400 h-full rounded-full"
              style={{ width: `${work.physical_progress_pct}%` }}
            />
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Project Scope & Details</h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          {work.description || 'Public capital asset sanctioned under the Member of Parliament Local Area Development Scheme.'}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-lg bg-slate-50 border border-white/5 text-xs pt-4">
          <div>
            <span className="text-slate-500">Sector Category:</span>
            <p className="font-semibold text-slate-900 mt-0.5">{work.category}</p>
          </div>
          <div>
            <span className="text-slate-500">Location:</span>
            <p className="font-semibold text-slate-900 mt-0.5">{work.location_name}</p>
          </div>
          <div>
            <span className="text-slate-500">Completion Date:</span>
            <p className="font-semibold text-slate-900 mt-0.5">{work.actual_completion_date ? formatDate(work.actual_completion_date) : 'In Progress'}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
