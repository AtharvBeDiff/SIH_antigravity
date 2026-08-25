import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { PageHeader, Card, Button, StatusBadge, Spinner } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, MapPin, Search } from 'lucide-react';
import type { Work } from '../types';

export function WorksPage() {
  const { selectedDistrict } = useAppState();
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const loadWorks = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {
        page_size: '50',
      };
      if (selectedDistrict) params['district_id'] = selectedDistrict;
      if (categoryFilter) params['category'] = categoryFilter;
      if (statusFilter) params['status'] = statusFilter;
      if (search) params['search'] = search;

      const res = await api.works.list(params);
      setWorks(res || []);
    } catch (err) {
      console.error('Failed to load works:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorks();
  }, [selectedDistrict, categoryFilter, statusFilter, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Infrastructure Works Directory"
        description="Comprehensive repository of sanctioned, ongoing, and completed MPLADS capital projects."
      />

      {/* Filters */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search title, location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="">All Sectors</option>
            <option value="ROADS">Roads & Pathways</option>
            <option value="EDUCATION">Education</option>
            <option value="HEALTH">Health & Family Welfare</option>
            <option value="WATER">Drinking Water</option>
            <option value="SANITATION">Sanitation</option>
            <option value="COMMUNITY">Community Infrastructure</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="APPROVED">Approved / Sanctioned</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <div className="text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-900">{works.length}</span> projects
        </div>
      </div>

      {/* Grid of Work Cards */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Spinner className="w-8 h-8 text-blue-600" />
          <p className="text-sm">Fetching infrastructure projects...</p>
        </div>
      ) : works.length === 0 ? (
        <div className="py-16 text-center text-slate-500">
          <p className="text-base font-semibold text-slate-900">No projects found</p>
          <p className="text-xs mt-1">Try adjusting your filters or search terms.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {works.map((w) => (
            <Card key={w.id} className="flex flex-col justify-between dashboard-card-hover bg-white border-slate-200 shadow-xs p-5 group">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                    {w.category}
                  </span>
                  <StatusBadge status={w.status} />
                </div>

                <h3 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug group-hover:text-blue-600 transition-colors">
                  {w.title}
                </h3>

                <div className="space-y-1 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{w.location_name || 'District Jurisdiction'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>ID: <code className="font-mono text-slate-700 font-medium">{w.esakshi_work_id || w.id.slice(0, 8)}</code></span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5 pt-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-500">Physical Milestone</span>
                    <span className="text-slate-900 font-mono font-bold">{w.physical_progress_pct || 0}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-600 to-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, w.physical_progress_pct || 0))}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase font-semibold text-slate-400">Sanctioned Funds</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{formatCurrency(w.sanctioned_amount || 0)}</p>
                </div>

                <Link to={`/works/${w.id}`}>
                  <Button variant="outline" size="sm" className="bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700">
                    <span>Details</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1" />
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
