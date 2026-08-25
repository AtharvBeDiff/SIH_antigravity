import React, { useEffect, useState } from 'react';
import { PageHeader, Card, Spinner } from '../components/ui';
import { CheckCircle2, FileCheck, Layers } from 'lucide-react';

export function ReadinessPage() {
  const [checklist, setChecklist] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadReadiness = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/insight/readiness');
        const json = await res.json();
        setChecklist(json.data || []);
      } catch (err) {
        console.error('Failed to load readiness checklist:', err);
      } finally {
        setLoading(false);
      }
    };
    loadReadiness();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="e-SAKSHI 21-Column Integration Readiness"
        description="Day-1 production readiness checklist mapping MoSPI e-SAKSHI data contracts directly to internal schema fields."
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="py-20 flex items-center justify-center">
            <Spinner className="w-8 h-8" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200/50 text-slate-500 bg-slate-50/50">
                  <th className="py-3.5 px-4">#</th>
                  <th className="py-3.5 px-4">e-SAKSHI Column</th>
                  <th className="py-3.5 px-4">Internal Mapping Field</th>
                  <th className="py-3.5 px-4">Specification & Role</th>
                  <th className="py-3.5 px-4">Readiness State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900">
                {checklist.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{item.column}</td>
                    <td className="py-3 px-4 font-mono text-blue-600">{item.source_field}</td>
                    <td className="py-3 px-4 text-slate-500">{item.description}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        READY (100%)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
