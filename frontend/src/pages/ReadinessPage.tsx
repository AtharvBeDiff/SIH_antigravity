import { useEffect, useState } from 'react';
import { PageHeader, Card, Spinner } from '../components/ui';
import { CheckCircle2, CircleSlash, MinusCircle } from 'lucide-react';

type MappingState = 'INGESTED' | 'NOT_INGESTED' | 'OUT_OF_CONTRACT';

interface ReadinessItem {
  requested_field: string;
  description: string;
  csv_column: string | null;
  target_field: string | null;
  state: MappingState;
  evidence: string;
  notes: string;
}

const STATE_STYLES: Record<MappingState, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  INGESTED: {
    label: 'Ingested',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Icon: CheckCircle2,
  },
  NOT_INGESTED: {
    label: 'Not ingested',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: MinusCircle,
  },
  OUT_OF_CONTRACT: {
    label: 'Not a source field',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
    Icon: CircleSlash,
  },
};

export function ReadinessPage() {
  const [checklist, setChecklist] = useState<ReadinessItem[]>([]);
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

  const counts = checklist.reduce<Record<MappingState, number>>(
    (acc, item) => {
      acc[item.state] = (acc[item.state] ?? 0) + 1;
      return acc;
    },
    { INGESTED: 0, NOT_INGESTED: 0, OUT_OF_CONTRACT: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="DRISHTI Proposed Integration Schema"
        description="The fields DRISHTI would request from the source system, and — for each one — where it lands in our schema and whether anything populates it today. This is a target mapping, not a certification."
      />

      {/* The point of this screen is which rows are NOT wired. Lead with that count
          rather than a green summary. */}
      {!loading && checklist.length > 0 && (
        <Card className="text-xs text-slate-600 space-y-1">
          <p>
            <strong className="text-slate-900">{checklist.length}</strong> fields requested ·{' '}
            <strong className="text-emerald-700">{counts.INGESTED}</strong> populated by the CSV
            ingest today ·{' '}
            <strong className="text-amber-700">{counts.NOT_INGESTED}</strong> mapped but not
            populated ·{' '}
            <strong className="text-slate-700">{counts.OUT_OF_CONTRACT}</strong> DRISHTI-internal
          </p>
          <p className="text-slate-500">
            No official MoSPI basis was located for a fixed column list, so this is DRISHTI's own
            proposed schema and is not presented as an external requirement. Each row's state is
            checkable at the source location shown.
          </p>
        </Card>
      )}

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
                  <th className="py-3.5 px-4">Requested Field</th>
                  <th className="py-3.5 px-4">CSV Column</th>
                  <th className="py-3.5 px-4">Target Field</th>
                  <th className="py-3.5 px-4">State</th>
                  <th className="py-3.5 px-4">Notes &amp; Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-900">
                {checklist.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Could not load the integration schema.
                    </td>
                  </tr>
                ) : (
                  checklist.map((item, idx) => {
                    const stateStyle = STATE_STYLES[item.state] ?? STATE_STYLES.OUT_OF_CONTRACT;
                    return (
                      <tr key={item.requested_field} className="hover:bg-slate-50 transition-colors align-top">
                        <td className="py-3 px-4 font-mono text-slate-500">{idx + 1}</td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {item.requested_field}
                          <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                            {item.description}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          {item.csv_column ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-3 px-4 font-mono text-blue-600">
                          {item.target_field ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${stateStyle.className}`}
                          >
                            <stateStyle.Icon className="w-3 h-3" />
                            {stateStyle.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500 max-w-md">
                          {item.notes}
                          <div className="font-mono text-[10px] text-slate-400 mt-1">
                            {item.evidence}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
