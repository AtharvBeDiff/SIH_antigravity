import React, { useEffect, useState } from 'react';
import { PageHeader, Card, Button, StatusBadge, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import { Link } from 'react-router-dom';
import { ArrowRight, Building, CheckCircle2, Globe, MapPin, Search } from 'lucide-react';
import type { PublicWork } from '../types';

export function PublicListPage() {
  const [works, setWorks] = useState<PublicWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadWorks = async () => {
    try {
      setLoading(true);
      const res = await api.public.list(search);
      setWorks(res || []);
    } catch (err) {
      console.error('Failed to load public works:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorks();
  }, [search]);

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-2xl bg-gradient-to-r from-secondary/20 via-surface to-purple-500/10 border border-secondary/30 space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-600/20 text-blue-600 border border-secondary/30">
          <Globe className="w-3.5 h-3.5" />
          <span>National Citizen Transparency Portal</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Public Infrastructure Projects</h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Search and monitor developmental assets sanctioned by your Member of Parliament under the MPLADS scheme.
        </p>
      </div>

      {/* Search Input */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search community projects, locations..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-secondary"
        />
      </div>

      {loading ? (
        <div className="py-24 flex justify-center">
          <Spinner className="w-8 h-8" />
        </div>
      ) : works.length === 0 ? (
        <div className="py-16 text-center text-slate-500">No public works found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {works.map(w => (
            <Card key={w.id} className="flex flex-col justify-between hover:border-white/20 transition-all p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                    {w.category}
                  </span>
                  <StatusBadge status={w.status} />
                </div>

                <h3 className="text-base font-bold text-slate-900 line-clamp-2">{w.title}</h3>

                <div className="space-y-1 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span className="truncate">{w.location_name} &bull; {w.district_name}</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1 pt-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Physical Completion</span>
                    <span className="text-slate-900 font-bold">{w.physical_progress_pct}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full"
                      style={{ width: `${w.physical_progress_pct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200/40 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-500">Sanctioned Amount</p>
                  <p className="text-sm font-bold text-slate-900">{formatCurrency(w.sanctioned_amount)}</p>
                </div>

                <Link to={`/public/${w.id}`}>
                  <Button variant="outline" size="sm">
                    <span>Citizen View</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
