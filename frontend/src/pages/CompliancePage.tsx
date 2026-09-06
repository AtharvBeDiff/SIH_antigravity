import React, { useEffect, useState } from 'react';
import { PageHeader, Card, StatCard, Spinner } from '../components/ui';
import { ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import type { InspectionCoverage, ReservationCompliance } from '../types';

/**
 * Every figure on this page used to be a literal in the JSX: 16.4% SCSP, 8.1% TSP,
 * "65 assets", "38 assets (58.5%)", and a green "TARGET MET" badge. None of them was
 * computed from anything, and the page never called an API at all. They are now read
 * from `/api/quota` and `/api/quota/inspection`, and an unmeasured figure renders as
 * '—' rather than as a number that happens to clear its target.
 *
 * The response shapes are imported from `../types` rather than redeclared here. The
 * interfaces this page needs used to exist in three places — both `types.ts` files and
 * locally — and the two `types.ts` copies had already drifted to a dead shape.
 */

/** A percentage, or '—' when the denominator was empty. */
function pct(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—';
}

function crore(rupees: number): string {
  return `₹${(rupees / 1_00_00_000).toFixed(2)} Cr`;
}

/** Bar width is only meaningful once a percentage exists. */
function barWidth(value: number | null, target: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || target <= 0) return '0%';
  return `${Math.min(100, (value / target) * 100).toFixed(1)}%`;
}

/**
 * Card colour follows the measurement, including the case where there isn't one.
 * An unmeasured mandate must not render green — that is the same defect as a
 * fabricated number, just expressed in colour instead of digits.
 */
function variantFor(
  meets: boolean | null | undefined,
  positive: 'success' | 'info',
): 'default' | 'warning' | 'success' | 'info' {
  if (meets === null || meets === undefined) return 'default';
  return meets ? positive : 'warning';
}

function Verdict({ meets, label }: { meets: boolean | null; label: string }) {
  if (meets === null) {
    return (
      <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-slate-200 text-slate-600">
        NOT MEASURED
      </span>
    );
  }
  return (
    <span
      className={`px-2 py-0.5 rounded font-bold text-[11px] ${
        meets ? 'bg-emerald-500/20 text-emerald-600' : 'bg-amber-500/20 text-amber-700'
      }`}
    >
      {meets ? `MEETS ${label}` : `BELOW ${label}`}
    </span>
  );
}

export function CompliancePage() {
  const { selectedDistrict } = useAppState();
  const [reservation, setReservation] = useState<ReservationCompliance | null>(null);
  const [coverage, setCoverage] = useState<InspectionCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const params = selectedDistrict ? { district_id: selectedDistrict } : undefined;
        const [res, cov] = await Promise.all([
          api.quota.get(params),
          api.quota.inspection(params),
        ]);
        if (cancelled) return;
        setReservation(res ?? null);
        setCoverage(cov ?? null);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load compliance statistics:', err);
        setError(err instanceof Error ? err.message : 'Failed to load compliance statistics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedDistrict]);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Spinner className="w-8 h-8" />
        <p className="text-sm">Computing compliance statistics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory Mandates & Compliance Telemetry"
        description="SC/ST reservation against the annual entitlement (R-016) and physical inspection coverage of works under implementation (R-017). Compliance statistics, not risk — nothing here is ranked or attributed to an individual."
      />

      {/*
        A failed request must not leave the cards below rendering stale or invented
        figures. The whole point of this page is that its numbers are real.
      */}
      {error && (
        <Card className="space-y-1 border-amber-200 bg-amber-50/50">
          <div className="flex items-center gap-2 text-amber-700">
            <TriangleAlert className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Compliance statistics unavailable</h3>
          </div>
          <p className="text-xs text-amber-700/80">
            {error}. No figures are shown; the platform does not display a compliance
            result it has not computed.
          </p>
        </Card>
      )}

      {!error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              title="Scheduled Caste (SCSP) Allocation"
              value={pct(reservation?.scsp_pct)}
              subtitle={`Statutory minimum: ${pct(reservation?.scsp_target_pct, 1)} of entitlement`}
              icon={Users}
              variant={variantFor(reservation?.scsp_meets_target, 'success')}
            />
            <StatCard
              title="Scheduled Tribe (TSP) Allocation"
              value={pct(reservation?.tsp_pct)}
              subtitle={`Statutory minimum: ${pct(reservation?.tsp_target_pct, 1)} of entitlement`}
              icon={Users}
              variant={variantFor(reservation?.tsp_meets_target, 'success')}
            />
            <StatCard
              title="Field Inspection Coverage"
              value={pct(coverage?.coverage_pct)}
              subtitle={`Target: ≥${pct(coverage?.target_pct, 0)} of works under implementation, annually`}
              icon={ShieldCheck}
              variant={variantFor(coverage?.meets_target, 'info')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="space-y-4">
              <h3 className="text-base font-semibold text-slate-900">
                SC/ST Earmarked Infrastructure (R-016)
              </h3>
              <p className="text-xs text-slate-500">
                Under MPLADS guidelines, works costing at least 15% of the annual
                entitlement must be recommended for areas inhabited by SC population,
                and 7.5% for ST population. The denominator is the entitlement — ₹5 Cr
                per constituency per financial year — not the portfolio's own total.
              </p>

              <div className="space-y-3 pt-2">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/60 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-900 font-medium">
                      SCSP component (target: {pct(reservation?.scsp_target_pct, 0)})
                    </span>
                    <Verdict meets={reservation?.scsp_meets_target ?? null} label="MINIMUM" />
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={reservation?.scsp_meets_target === false ? 'bg-amber-400 h-full' : 'bg-emerald-400 h-full'}
                      style={{ width: barWidth(reservation?.scsp_pct ?? null, reservation?.scsp_target_pct ?? 15) }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {pct(reservation?.scsp_pct)} —{' '}
                    {reservation ? crore(reservation.scsp_recommended_inr) : '—'} recommended
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/60 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-900 font-medium">
                      TSP component (target: {pct(reservation?.tsp_target_pct, 1)})
                    </span>
                    <Verdict meets={reservation?.tsp_meets_target ?? null} label="MINIMUM" />
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={reservation?.tsp_meets_target === false ? 'bg-amber-400 h-full' : 'bg-emerald-400 h-full'}
                      style={{ width: barWidth(reservation?.tsp_pct ?? null, reservation?.tsp_target_pct ?? 7.5) }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {pct(reservation?.tsp_pct)} —{' '}
                    {reservation ? crore(reservation.tsp_recommended_inr) : '—'} recommended
                  </p>
                </div>
              </div>

              {/*
                The denominator's construction is stated rather than assumed. It can
                only see financial years the corpus contains, so a year with no
                recommendations at all is invisible and the true entitlement would be
                larger — which would push these percentages down, not up.
              */}
              <div className="pt-1 space-y-1 text-[11px] text-slate-500">
                <p>
                  Entitlement base:{' '}
                  {reservation ? crore(reservation.entitlement_inr) : '—'} across{' '}
                  {reservation?.entitlement_periods ?? '—'} constituency-year period(s)
                  {reservation && reservation.financial_years.length > 0
                    ? ` (FY ${reservation.financial_years.join(', ')})`
                    : ''}
                  .
                </p>
                <p>
                  {reservation?.works_counted ?? '—'} recommended works counted.
                </p>
                {reservation && reservation.works_missing_recommended_date > 0 && (
                  <p className="text-amber-700">
                    {reservation.works_missing_recommended_date} work(s) excluded: no
                    recommendation date on record, so they cannot be attributed to a
                    financial year. These percentages understate the true share.
                  </p>
                )}
              </div>
            </Card>

            <Card className="space-y-4">
              <h3 className="text-base font-semibold text-slate-900">
                Physical Inspection Mandate (R-017)
              </h3>
              <p className="text-xs text-slate-500">
                District authorities must physically inspect at least{' '}
                {pct(coverage?.target_pct, 0)} of works under implementation each year.
                Works in progress are the population, not completed assets — an
                inspection can only change an outcome while the work is still being
                built.
              </p>

              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/60 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Works under implementation:</span>
                  <strong className="text-slate-900">
                    {coverage?.works_under_implementation ?? '—'}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Inspected in the trailing year:</span>
                  <strong className="text-slate-900">
                    {coverage ? `${coverage.works_inspected} (${pct(coverage.coverage_pct)})` : '—'}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Coverage status:</span>
                  <Verdict meets={coverage?.meets_target ?? null} label={`TARGET (≥${pct(coverage?.target_pct, 0)})`} />
                </div>
              </div>

              <div className="space-y-1 text-[11px] text-slate-500">
                {coverage && (
                  <p>
                    Window: {coverage.window_start} to {coverage.window_end}.
                  </p>
                )}
                {coverage && coverage.works_under_implementation === 0 && (
                  <p>
                    Nothing is under implementation in this scope, so there is no
                    denominator and no coverage figure to report.
                  </p>
                )}
                {coverage && coverage.inspections_outside_population > 0 && (
                  <p>
                    {coverage.inspections_outside_population} further inspection(s) were
                    recorded against works not under implementation. Real field effort,
                    but outside the population this mandate measures.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
