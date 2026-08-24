import React from 'react';
import { PageHeader, Card, StatCard } from '../components/ui';
import { Award, CheckCircle2, FileCheck, ShieldCheck, TrendingUp, Users } from 'lucide-react';

export function CompliancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory Mandates & Compliance Telemetry"
        description="Monitoring SC/ST fund reservation mandates (15% SCSP / 7.5% TSP) and statutory physical inspection quotas."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Scheduled Caste (SCSP) Allocation"
          value="16.4%"
          subtitle="Statutory Minimum: 15.0%"
          icon={Users}
          variant="success"
        />
        <StatCard
          title="Scheduled Tribe (TSP) Allocation"
          value="8.1%"
          subtitle="Statutory Minimum: 7.5%"
          icon={Users}
          variant="success"
        />
        <StatCard
          title="Field Inspection Quota"
          value="58.5%"
          subtitle="Statutory Target: ≥50% of completed assets"
          icon={ShieldCheck}
          variant="info"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-white">SC/ST Earmarked Infrastructure (R-016)</h3>
          <p className="text-xs text-text-muted">
            Under MPLADS guidelines, Members of Parliament must recommend works costing at least 15% of their annual entitlement for areas inhabited by SC population and 7.5% for ST population.
          </p>

          <div className="space-y-3 pt-2">
            <div className="p-3 rounded-lg bg-surface border border-white/5 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-white font-medium">SCSP Component (Target: 15%)</span>
                <span className="text-emerald-400 font-bold">16.4% COMPLIANT</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-400 h-full w-[82%]" />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface border border-white/5 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-white font-medium">TSP Component (Target: 7.5%)</span>
                <span className="text-emerald-400 font-bold">8.1% COMPLIANT</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-400 h-full w-[75%]" />
              </div>
            </div>
          </div>
        </Card>

        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-white">Physical Inspection Mandate (R-017)</h3>
          <p className="text-xs text-text-muted">
            District Authorities must physically inspect at least 10% of works under implementation and 50% of all completed works annually.
          </p>

          <div className="p-4 rounded-lg bg-surface border border-white/5 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Completed Works:</span>
              <strong className="text-white">65 assets</strong>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Physically Inspected & Geotagged:</span>
              <strong className="text-emerald-400">38 assets (58.5%)</strong>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Inspection Coverage Status:</span>
              <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-emerald-500/20 text-emerald-400">
                TARGET MET (≥50%)
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
