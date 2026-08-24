import React, { useEffect, useState } from 'react';
import { PageHeader, Card, StatCard, Spinner } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import { Building2, CheckCircle2, Clock, Layers, Users } from 'lucide-react';

export function AgenciesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Implementing Agencies Performance & Workload"
        description="Tracking execution speed, project concentration, and delayed works per government department."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Active Implementing Agencies"
          value="4"
          subtitle="PWD, DRDA, Urban Local Bodies, Irrigation"
          icon={Building2}
          variant="info"
        />
        <StatCard
          title="Average Delivery Pacing"
          value="14.2 Mo"
          subtitle="From administrative sanction to completion"
          icon={Clock}
          variant="default"
        />
        <StatCard
          title="Top Performing Agency"
          value="DRDA"
          subtitle="88.4% timely execution rate"
          icon={CheckCircle2}
          variant="success"
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/50 text-text-muted bg-surface/50">
                <th className="py-3.5 px-4">Implementing Agency</th>
                <th className="py-3.5 px-4">Agency Type</th>
                <th className="py-3.5 px-4">Assigned Projects</th>
                <th className="py-3.5 px-4">Completed</th>
                <th className="py-3.5 px-4">Total Sanctioned</th>
                <th className="py-3.5 px-4">Completion Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30 text-white">
              {[
                { name: 'Public Works Department (PWD)', type: 'State PWD', total: 78, done: 36, amount: 184500000, rate: '46.1%' },
                { name: 'Rural Development Agency (DRDA)', type: 'DRDA', total: 64, done: 32, amount: 122000000, rate: '50.0%' },
                { name: 'Municipal Corporation', type: 'Urban Local Body', total: 38, done: 14, amount: 89000000, rate: '36.8%' },
                { name: 'Irrigation & Flood Control Dept', type: 'Line Department', total: 20, done: 8, amount: 45000000, rate: '40.0%' },
              ].map((row, i) => (
                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4 font-bold text-white">{row.name}</td>
                  <td className="py-3 px-4 text-text-muted">{row.type}</td>
                  <td className="py-3 px-4 font-mono">{row.total}</td>
                  <td className="py-3 px-4 font-mono text-emerald-400">{row.done}</td>
                  <td className="py-3 px-4 font-bold">{formatCurrency(row.amount)}</td>
                  <td className="py-3 px-4 font-bold text-secondary">{row.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
