import React from 'react';
import { cn, formatCurrency } from '../lib/utils';
import { AlertTriangle, CheckCircle2, Clock, Info, ShieldAlert, Sparkles } from 'lucide-react';

// ─── Cards & Headers ─────────────────────────────────────────

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'glass-card rounded-xl border border-white/5 bg-surface/80 p-6 backdrop-blur-md transition-all duration-200',
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
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between pb-6 border-b border-border/50">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="text-sm text-text-muted mt-1">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </div>
  );
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'default',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ElementType;
  trend?: string;
  variant?: 'default' | 'critical' | 'warning' | 'success' | 'info';
}) {
  const borderVariants = {
    default: 'border-white/5 hover:border-white/15',
    critical: 'border-destructive/30 shadow-[0_0_20px_rgba(239,68,68,0.15)] bg-destructive/5',
    warning: 'border-warning/30 shadow-[0_0_20px_rgba(245,158,11,0.15)] bg-warning/5',
    success: 'border-success/30 shadow-[0_0_20px_rgba(16,185,129,0.15)] bg-success/5',
    info: 'border-secondary/30 shadow-[0_0_20px_rgba(14,165,233,0.15)] bg-secondary/5',
  };

  return (
    <div className={cn('glass-card rounded-xl p-5 border transition-all duration-200', borderVariants[variant])}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</p>
        {Icon && <Icon className="w-4 h-4 text-text-muted" />}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl lg:text-3xl font-bold tracking-tight text-white">{value}</span>
      </div>
      {(subtitle || trend) && (
        <div className="mt-2 flex items-center justify-between text-xs">
          {subtitle && <span className="text-text-muted">{subtitle}</span>}
          {trend && <span className="font-medium text-secondary">{trend}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Badges & Chips ──────────────────────────────────────────

export function SeverityChip({ severity }: { severity: string }) {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          CRITICAL
        </span>
      );
    case 'HIGH':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          HIGH
        </span>
      );
    case 'MEDIUM':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          MEDIUM
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-500/10 text-gray-400 border border-gray-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          LOW
        </span>
      );
  }
}

export function StatusBadge({ status }: { status: string }) {
  switch (status?.toUpperCase()) {
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" />
          Completed
        </span>
      );
    case 'IN_PROGRESS':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
          <Clock className="w-3 h-3" />
          In Progress
        </span>
      );
    case 'APPROVED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
          Approved
        </span>
      );
    case 'ON_HOLD':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          On Hold
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
          Proposed
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
    primary: 'bg-secondary text-white hover:bg-secondary/90 shadow-md shadow-secondary/20',
    secondary: 'bg-surface hover:bg-surface-hover text-white border border-border',
    outline: 'border border-border text-text-muted hover:text-white hover:border-white/30',
    danger: 'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30',
    ghost: 'text-text-muted hover:text-white hover:bg-white/5',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2.5 text-base',
  };

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
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
        'w-5 h-5 border-2 border-secondary/30 border-t-secondary rounded-full animate-spin',
        className
      )}
    />
  );
}

export function SyntheticBanner() {
  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs font-medium text-amber-300 flex items-center justify-center gap-2">
      <Sparkles className="w-4 h-4 text-amber-400" />
      <span>DEMO CORPUS ACTIVE: Reproducible synthetic dataset anchored to MoSPI 19.24% completion benchmark.</span>
    </div>
  );
}
