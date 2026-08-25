import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { PageHeader, Card } from '../components/ui';
import { Activity } from 'lucide-react';
import type { HeatmapPoint } from '../types';

export function HeatmapPage() {
  const { selectedDistrict } = useAppState();
  const [data, setData] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await api.heatmap.get(selectedDistrict ? { district_id: selectedDistrict } : undefined);
      setData(res.data || []);
    } catch (err) {
      console.error('Failed to load heatmap data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDistrict]);

  // Group by month for a simple visualization if a full github calendar is too complex to build from scratch here.
  // We'll build a simplified github-style calendar.
  
  // 1. Generate last 365 days
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const activityMap = new Map<string, HeatmapPoint>();
  data.forEach(p => activityMap.set(p.date, p));

  const getColor = (count: number) => {
    if (count === 0) return 'bg-surface border-white/5';
    if (count <= 2) return 'bg-emerald-900 border-emerald-800';
    if (count <= 5) return 'bg-emerald-700 border-emerald-600';
    if (count <= 10) return 'bg-emerald-500 border-emerald-400';
    return 'bg-emerald-400 border-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.5)]';
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activity Heatmap"
        description="System-wide telemetry of physical progress, fund releases, and inspections."
        action={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/10 border border-secondary/20 text-secondary text-sm">
            <Activity className="w-4 h-4" />
            <span>Live Pulse</span>
          </div>
        }
      />

      <Card className="p-6 overflow-x-auto">
        <h3 className="text-lg font-semibold text-white mb-6">Annual Operational Velocity</h3>
        
        {loading ? (
          <div className="h-40 flex items-center justify-center text-text-muted">Loading telemetry...</div>
        ) : (
          <div className="min-w-[800px]">
            <div className="flex flex-wrap gap-1">
              {days.map(day => {
                const point = activityMap.get(day);
                const count = point?.count || 0;
                return (
                  <div
                    key={day}
                    title={`${day}: ${count} actions (Sanctioned: ${point?.worksSanctioned || 0}, Completed: ${point?.worksCompleted || 0}, Payments: ${point?.payments || 0}, Inspections: ${point?.inspections || 0})`}
                    className={`w-3.5 h-3.5 rounded-[2px] border ${getColor(count)} transition-colors hover:border-white cursor-pointer`}
                  />
                );
              })}
            </div>
            <div className="mt-6 flex items-center justify-end gap-2 text-xs text-text-muted">
              <span>Less</span>
              <div className="flex gap-1">
                <div className="w-3.5 h-3.5 rounded-[2px] border bg-surface border-white/5" />
                <div className="w-3.5 h-3.5 rounded-[2px] border bg-emerald-900 border-emerald-800" />
                <div className="w-3.5 h-3.5 rounded-[2px] border bg-emerald-700 border-emerald-600" />
                <div className="w-3.5 h-3.5 rounded-[2px] border bg-emerald-500 border-emerald-400" />
                <div className="w-3.5 h-3.5 rounded-[2px] border bg-emerald-400 border-emerald-300" />
              </div>
              <span>More</span>
            </div>
          </div>
        )}
      </Card>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
         <Card className="p-6">
            <h4 className="text-sm font-semibold text-white mb-2">Sanctions vs Completions</h4>
            <p className="text-xs text-text-muted">Visualizes the flow of newly sanctioned projects against those physically completed and verified.</p>
         </Card>
         <Card className="p-6">
            <h4 className="text-sm font-semibold text-white mb-2">Payment Velocity</h4>
            <p className="text-xs text-text-muted">Tracks the volume and frequency of tranche releases across the district.</p>
         </Card>
         <Card className="p-6">
            <h4 className="text-sm font-semibold text-white mb-2">Field Inspections</h4>
            <p className="text-xs text-text-muted">Monitors the on-ground verification activity by nodal officers.</p>
         </Card>
      </div>
    </div>
  );
}
