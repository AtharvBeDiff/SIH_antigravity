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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { SyntheticBanner } from '../ui';
import { useAppState } from '../../state';

export function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const { meta } = useAppState();

  const navGroups = [
    {
      title: 'Officer Casework',
      items: [
        { name: 'Overview', path: '/', icon: LayoutDashboard },
        { name: 'Triage Queue', path: '/alerts', icon: AlertCircle },
        { name: 'Works Directory', path: '/works', icon: Layers },
        { name: 'Agencies', path: '/agencies', icon: Building2 },
        { name: 'Compliance', path: '/compliance', icon: ShieldCheck },
        { name: 'District Digest', path: '/digest', icon: FileText },
        { name: '45-Day SLA Engine', path: '/sla', icon: Clock },
        { name: 'Activity Heatmap', path: '/heatmap', icon: Activity },
      ],
    },
    {
      title: 'How It Decides & Rigor',
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
      title: 'Field & Citizen Shells',
      items: [
        { name: 'Field Inspection PWA', path: '/inspection', icon: ClipboardCheck },
        { name: 'Citizen Public Portal', path: '/public', icon: Globe },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {meta?.is_synthetic && <SyntheticBanner />}

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="flex-shrink-0 border-r border-border/50 bg-surface/60 backdrop-blur-xl h-full flex flex-col z-20"
            >
              <div className="h-16 flex items-center px-6 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center glow-primary">
                    <ShieldAlert className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="font-bold text-base tracking-tight bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                      DRISHTI
                    </span>
                    <span className="block text-[10px] text-text-muted font-mono leading-none">
                      MPLADS Integrity Hub
                    </span>
                  </div>
                </div>
              </div>

              <nav className="flex-1 px-4 py-4 space-y-6 overflow-y-auto scrollbar-hide">
                {navGroups.map((grp, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-text-muted/70">
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
                            'flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150',
                            isActive
                              ? 'bg-secondary/15 text-secondary border border-secondary/25 font-semibold shadow-sm'
                              : 'text-text-muted hover:text-white hover:bg-white/5'
                          )}
                        >
                          <item.icon
                            className={cn('w-4 h-4', isActive ? 'text-secondary' : 'text-text-muted')}
                          />
                          <span>{item.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </nav>

              <div className="p-4 border-t border-border/50">
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-secondary to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                    DM
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">District Magistrate</p>
                    <p className="text-[10px] text-text-muted truncate">Nodal Authority</p>
                  </div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
          <header className="h-16 flex items-center justify-between px-6 border-b border-border/50 bg-background/80 backdrop-blur-md z-10 sticky top-0">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 -ml-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-white transition-colors cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-medium text-emerald-400">PostgreSQL Synced</span>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto bg-background p-6 md:p-8">
            <div className="max-w-7xl mx-auto pb-12">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
