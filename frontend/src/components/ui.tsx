import React from 'react';
import { cn, formatCurrency } from '../lib/utils';
import { AlertTriangle, ArrowUpRight, ArrowDownRight, CheckCircle2, Clock, Info, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react';

// ─── Cards & Containers ──────────────────────────────────────

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'dashboard-card p-6 transition-all duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between pb-6 border-b border-slate-200">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </div>
  );
}

// ─── Modern StatCard (Shopeers Light Style) ──────────────────

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendType = 'up',
  colorScheme,
  variant = 'default',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ElementType;
  trend?: string;
  trendType?: 'up' | 'down' | 'neutral';
  colorScheme?: 'blue' | 'emerald' | 'cyan' | 'rose' | 'purple' | 'amber';
  variant?: 'default' | 'critical' | 'warning' | 'success' | 'info';
}) {
  const resolvedColor = colorScheme || (
    variant === 'critical' ? 'rose' :
    variant === 'warning' ? 'amber' :
    variant === 'success' ? 'emerald' :
    variant === 'info' ? 'cyan' : 'blue'
  );

  const iconThemes = {
    blue: 'bg-blue-50 text-blue-600 border border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
    cyan: 'bg-cyan-50 text-cyan-600 border border-cyan-100',
    rose: 'bg-rose-50 text-rose-600 border border-rose-100',
    purple: 'bg-purple-50 text-purple-600 border border-purple-100',
    amber: 'bg-amber-50 text-amber-600 border border-amber-100',
  };

  return (
    <div className="dashboard-card dashboard-card-hover p-5 relative overflow-hidden group">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <h3 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-sans">
              {value}
            </h3>
          </div>
        </div>
        {Icon && (
          <div className={cn('p-2.5 rounded-xl transition-transform group-hover:scale-105', iconThemes[resolvedColor])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>

      {(subtitle || trend) && (
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          {subtitle && <span className="text-slate-500 truncate max-w-[70%]">{subtitle}</span>}
          {trend && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold text-[11px] px-2 py-0.5 rounded-full',
                trendType === 'up'
                  ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                  : trendType === 'down'
                  ? 'text-rose-700 bg-rose-50 border border-rose-200'
                  : 'text-blue-700 bg-blue-50 border border-blue-200'
              )}
            >
              {trendType === 'up' ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : trendType === 'down' ? (
                <ArrowDownRight className="w-3 h-3" />
              ) : null}
              {trend}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Radial Benchmark Gauge (19.24% MoSPI Meter) ─────────────

export function BenchmarkGauge({
  percentage = 19.3,
  target = 19.24,
  label = "MoSPI Fund-to-Completion Ratio",
}: {
  percentage: number;
  target?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-2 text-center">
      <div className="relative w-44 h-24 flex items-end justify-center overflow-hidden">
        <svg className="w-44 h-44 -rotate-180 transform" viewBox="0 0 100 100">
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r="40"
            className="text-slate-100"
            strokeWidth="10"
            stroke="currentColor"
            fill="transparent"
            strokeDasharray="125.6 125.6"
          />
          {/* Active Progress */}
          <circle
            cx="50"
            cy="50"
            r="40"
            className="text-emerald-500 transition-all duration-1000 ease-out"
            strokeWidth="10"
            strokeDasharray="125.6 125.6"
            strokeDashoffset={125.6 - (125.6 * Math.min(percentage, 100)) / 100}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
          />
        </svg>
        <div className="absolute bottom-1 flex flex-col items-center">
          <span className="text-3xl font-bold tracking-tight text-slate-900">{percentage.toFixed(1)}%</span>
          <span className="text-[10px] uppercase font-bold text-emerald-600">On Track</span>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-600">
        <p className="font-semibold text-slate-900">{label}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">Benchmark Target: {target}%</p>
      </div>
    </div>
  );
}

// ─── Badges & Status Chips ───────────────────────────────────

export function SeverityChip({ severity }: { severity: string }) {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          CRITICAL
        </span>
      );
    case 'HIGH':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          HIGH
        </span>
      );
    case 'MEDIUM':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          MEDIUM
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          LOW
        </span>
      );
  }
}

export function StatusBadge({ status }: { status: string }) {
  switch (status?.toUpperCase()) {
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          Completed
        </span>
      );
    case 'IN_PROGRESS':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          In Progress
        </span>
      );
    case 'ON_HOLD':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          On Hold
        </span>
      );
    case 'APPROVED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200">
          Approved
        </span>
      );
    case 'PROPOSED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
          Proposed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          {status}
        </span>
      );
  }
}

export function VerificationBadge({ status }: { status: string }) {
  switch (status) {
    case 'VERIFIED':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" />
          Verified Rule
        </span>
      );
    case 'NEEDS_VERIFICATION':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-3 h-3" />
          Needs Verification
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          <Info className="w-3 h-3" />
          Platform Policy
        </span>
      );
  }
}

// ─── Buttons & Inputs ────────────────────────────────────────

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20 active:scale-[0.98]',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200',
    outline: 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 bg-white shadow-xs',
    danger: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200',
    ghost: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-4 py-2 text-sm rounded-xl',
    lg: 'px-6 py-2.5 text-base rounded-xl',
  };

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin',
        className
      )}
    />
  );
}

export function SyntheticBanner() {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs font-semibold text-amber-800 flex items-center justify-center gap-2">
      <Sparkles className="w-4 h-4 text-amber-600" />
      <span>DEMO CORPUS ACTIVE: Reproducible synthetic dataset anchored to MoSPI 19.24% completion benchmark.</span>
    </div>
  );
}
