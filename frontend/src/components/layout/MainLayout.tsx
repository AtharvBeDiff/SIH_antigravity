import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  AlertCircle,
  ClipboardCheck,
  ShieldAlert,
  FileText,
  Menu,
  Building2,
  Users,
  Clock,
  ShieldCheck,
  Sparkles,
  Award,
  Scale,
  FileSpreadsheet,
  Globe,
  Layers,
  Activity,
  Search,
  Bell,
  CheckCircle2,
  ChevronDown,
  Bot,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { SyntheticBanner } from '../ui';
import { useAppState } from '../../state';

export function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const { meta, selectedDistrict, setSelectedDistrict, districts } = useAppState();

  const navGroups = [
    {
      title: 'Casework & Overview',
      items: [
        { name: 'Dashboard', path: '/', icon: LayoutDashboard },
        { name: 'Triage Queue', path: '/alerts', icon: AlertCircle, badge: '14', badgeColor: 'rose' },
        { name: 'Works Directory', path: '/works', icon: Layers },
        { name: 'Agencies', path: '/agencies', icon: Building2 },
        { name: 'Compliance', path: '/compliance', icon: ShieldCheck },
        { name: 'District Digest', path: '/digest', icon: FileText },
        { name: '45-Day SLA Engine', path: '/sla', icon: Clock },
        { name: 'Activity Heatmap', path: '/heatmap', icon: Activity },
      ],
    },
    {
      title: 'AI Decision Rigor',
      items: [
        { name: '17 Rules Matrix', path: '/rules', icon: ShieldAlert },
        { name: 'Audit Hash Ledger', path: '/audit', icon: Sparkles },
        { name: 'Data Ingestion', path: '/ingest', icon: FileSpreadsheet },
        { name: 'Empirical Evaluation', path: '/evaluation', icon: Award },
        { name: 'Corpus Calibration', path: '/calibration', icon: Scale },
        { name: '21-Col Readiness', path: '/readiness', icon: ClipboardCheck },
      ],
    },
    {
      title: 'Field & Citizen',
      items: [
        { name: 'Field Inspection PWA', path: '/inspection', icon: ClipboardCheck },
        { name: 'Citizen Public Portal', path: '/public', icon: Globe },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden font-sans">
      {meta?.is_synthetic && <SyntheticBanner />}

      <div className="flex-1 flex overflow-hidden">
        {/* Modern Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 270, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="flex-shrink-0 border-r border-slate-200 bg-white h-full flex flex-col z-20"
            >
              {/* Brand Header */}
              <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                    <ShieldAlert className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="font-bold text-base tracking-tight text-slate-900 flex items-center gap-1.5">
                      DRISHTI
                      <span className="text-[10px] uppercase font-semibold px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 border border-blue-200">
                        AI
                      </span>
                    </span>
                    <span className="block text-[10px] text-slate-400 font-mono leading-none">
                      MPLADS Integrity Hub
                    </span>
                  </div>
                </div>
              </div>

              {/* Navigation Menu */}
              <nav className="flex-1 px-3.5 py-4 space-y-6 overflow-y-auto scrollbar-hide">
                {navGroups.map((grp, idx) => (
                  <div key={idx} className="space-y-1">
                    <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {grp.title}
                    </p>
                    {grp.items.map((item) => {
                      const isActive =
                        location.pathname === item.path ||
                        (item.path !== '/' && location.pathname.startsWith(item.path));
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={cn(
                            'flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 group',
                            isActive
                              ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/25'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <item.icon
                              className={cn(
                                'w-4 h-4 transition-colors',
                                isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'
                              )}
                            />
                            <span>{item.name}</span>
                          </div>
                          {item.badge && (
                            <span
                              className={cn(
                                'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-rose-50 text-rose-600 border border-rose-200'
                              )}
                            >
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </nav>

              {/* DRISHTI AI Copilot Bottom Card */}
              <div className="p-3.5 border-t border-slate-200 space-y-3">
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-50/80 to-indigo-50/50 border border-blue-100 relative overflow-hidden group">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-6 h-6 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-900 tracking-tight">DRISHTI Copilot</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    Continuous multi-modal anomaly telemetry active on 200 works.
                  </p>
                </div>

                {/* Profile Pill */}
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/60">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow-inner">
                    DM
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">District Magistrate</p>
                    <p className="text-[10px] text-slate-400 truncate">Nodal Authority</p>
                  </div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-[#F4F6FA]">
          {/* Modern Topbar */}
          <header className="h-16 flex items-center justify-between px-6 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl z-10 sticky top-0">
            <div className="flex items-center gap-4 flex-1 max-w-xl">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* Global Search Bar (⌘K) */}
              <div className="relative w-full max-w-sm hidden md:block">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search works, e-SAKSHI IDs, rules..."
                  className="w-full bg-slate-100/90 border border-slate-200 rounded-xl pl-9 pr-12 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
                />
                <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-200/60 border border-slate-300/50">
                  ⌘K
                </kbd>
              </div>
            </div>

            {/* Right Topbar Controls */}
            <div className="flex items-center gap-3">
              {/* District Filter Selector */}
              {districts && districts.length > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
                  <span className="text-slate-500">District:</span>
                  <select
                    value={selectedDistrict}
                    onChange={(e) => setSelectedDistrict(e.target.value)}
                    className="bg-transparent text-slate-800 font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-white text-slate-900">All Districts</option>
                    {districts.map((d) => (
                      <option key={d.id} value={d.id} className="bg-white text-slate-900">
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* PostgreSQL Sync Status Badge */}
              <div className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-emerald-700 hidden sm:inline">PostgreSQL Synced</span>
              </div>
            </div>
          </header>

          {/* Page Scroll Area */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            <div className="max-w-7xl mx-auto pb-12">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

