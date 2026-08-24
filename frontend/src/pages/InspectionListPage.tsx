import React, { useEffect, useState } from 'react';
import { PageHeader, Card, Button, Spinner } from '../components/ui';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, MapPin, Plus, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useAppState } from '../state';
import type { Inspection } from '../types';

export function InspectionListPage() {
  const { isOnline } = useAppState();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);

  const loadInspections = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/inspections');
      const json = await res.json();
      setInspections(json.data || []);
    } catch (err) {
      console.error('Failed to load inspections:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInspections();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Field Inspection PWA"
        description="On-site physical verification, geotagging, and offline checklist submission for field officers."
        action={
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
            }`}>
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{isOnline ? 'Online (Direct Sync)' : 'Offline Mode (Local Storage)'}</span>
            </div>

            <Link to="/inspection/new">
              <Button variant="primary" size="sm">
                <Plus className="w-4 h-4" />
                <span>New Field Inspection</span>
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full py-20 flex justify-center">
            <Spinner className="w-8 h-8" />
          </div>
        ) : inspections.length === 0 ? (
          <Card className="col-span-full py-16 text-center text-text-muted space-y-3">
            <ClipboardCheck className="w-10 h-10 text-secondary mx-auto" />
            <p className="text-white font-medium">No recorded field inspections</p>
            <p className="text-xs max-w-sm mx-auto">Start a new physical inspection to verify assets and geotag project deliverables.</p>
            <Link to="/inspection/new">
              <Button variant="primary" size="sm">Create First Inspection</Button>
            </Link>
          </Card>
        ) : (
          inspections.map((ins) => (
            <Card key={ins.id} className="space-y-3 hover:border-white/20 transition-colors p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-secondary/10 text-secondary border border-secondary/20 font-mono">
                  {ins.inspection_date}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                  ins.overall_status === 'SATISFACTORY'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {ins.overall_status}
                </span>
              </div>

              <h4 className="text-sm font-bold text-white">
                Inspector: {ins.inspector_name || 'Field Officer'}
              </h4>

              <div className="flex items-center gap-2 text-xs text-text-muted">
                <MapPin className="w-3.5 h-3.5 text-text-muted" />
                <span className="font-mono text-[11px]">{ins.latitude?.toFixed(4)}, {ins.longitude?.toFixed(4)}</span>
              </div>

              {ins.notes && (
                <p className="text-xs text-text-muted line-clamp-2 bg-surface p-2 rounded border border-white/5">
                  "{ins.notes}"
                </p>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
