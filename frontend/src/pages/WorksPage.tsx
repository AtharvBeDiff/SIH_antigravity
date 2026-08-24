import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { PageHeader, Card, Button, StatusBadge, Spinner } from '../components/ui';
import { formatCurrency } from '../lib/utils';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, Filter, Layers, MapPin, Search } from 'lucide-react';
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
      setWorks(res.data || []);
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
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-xl glass-panel">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search title, location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-secondary"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-secondary cursor-pointer"
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
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-secondary cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="APPROVED">Approved / Sanctioned</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <div className="text-xs text-text-muted">
          Showing <span className="font-semibold text-white">{works.length}</span> projects
        </div>
      </div>

      {/* Grid of Work Cards */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-text-muted">
          <Spinner className="w-8 h-8" />
          <p className="text-sm">Fetching infrastructure projects...</p>
        </div>
      ) : works.length === 0 ? (
        <div className="py-16 text-center text-text-muted">
          <p className="text-base font-semibold text-white">No projects found</p>
          <p className="text-sm mt-1">Try adjusting your filters or search terms.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {works.map((w) => (
            <Card key={w.id} className="flex flex-col justify-between hover:border-white/20 transition-all p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20">
                    {w.category}
                  </span>
                  <StatusBadge status={w.status} />
                </div>

                <h3 className="text-base font-bold text-white line-clamp-2 leading-snug">
                  {w.title}
                </h3>

                <div className="space-y-1 text-xs text-text-muted">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-text-muted" />
                    <span className="truncate">{w.location_name || 'District Jurisdiction'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-text-muted" />
                    <span>ID: <code className="font-mono text-white">{w.esakshi_work_id || w.id.slice(0, 8)}</code></span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1 pt-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-text-muted">Physical Milestone</span>
                    <span className="text-white">{w.physical_progress_pct || 0}%</span>
                  </div>
                  <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-secondary to-emerald-400 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, w.physical_progress_pct || 0))}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border/40 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-text-muted">Sanctioned Funds</p>
                  <p className="text-sm font-bold text-white">{formatCurrency(w.sanctioned_amount || 0)}</p>
                </div>

                <Link to={`/works/${w.id}`}>
                  <Button variant="outline" size="sm">
                    <span>Details</span>
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
