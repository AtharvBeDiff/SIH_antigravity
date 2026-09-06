import React, { useEffect, useState } from 'react';
import { PageHeader, Card, VerificationBadge, SeverityChip, Spinner, Button } from '../components/ui';
import { AlertCircle, CheckCircle2, FileText, Info, Shield, Sliders, ToggleLeft, ToggleRight, XCircle } from 'lucide-react';
import type { RuleConfig, RuleProbation } from '../types';

export function RulesPage() {
  const [rules, setRules] = useState<(RuleConfig & { probation?: RuleProbation })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRule, setSelectedRule] = useState<(RuleConfig & { probation?: RuleProbation }) | null>(null);

  const loadRules = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/rules');
      const data = await res.json();
      const loadedRules = data.data?.rules || [];
      setRules(loadedRules);
      if (loadedRules.length > 0 && !selectedRule) {
        setSelectedRule(loadedRules[0]);
      }
    } catch (err) {
      console.error('Failed to load rules:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  /**
   * Rules that carry a `dormant_reason` — enabled and implemented, but with no data
   * path, so they cannot produce an alert on any corpus.
   *
   * Surfaced because their silence is otherwise indistinguishable from a clean
   * result. R-010 is a CRITICAL photo-reuse check with no writer for the column it
   * reads; listing it as ACTIVE alongside rules that are actually running turns
   * "we cannot look" into "we looked and found nothing".
   */
  const dormantCount = rules.filter((r) => Boolean(r.dormant_reason)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Rules Engine & Probation Matrix"
        description="The automated compliance rules governing financial pacing, milestone integrity, and anti-fraud heuristics. The catalogue is versioned config, so the count below is read from it rather than written here."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rules Catalog List */}
        <Card className="lg:col-span-1 p-0 overflow-hidden divide-y divide-slate-100">
          <div className="p-4 bg-slate-50/50 border-b border-slate-200/50">
            <h3 className="text-sm font-semibold text-slate-900">
              Rule Catalog
              {rules.length > 0 ? ` (${rules.length} Rules` : ''}
              {/* Dormant rules are counted separately in the header rather than
                  quietly included in the total. A catalogue that reads "21 Rules"
                  implies 21 checks are running; one of them cannot run. */}
              {rules.length > 0 && dormantCount > 0 ? ` · ${dormantCount} Dormant` : ''}
              {rules.length > 0 ? ')' : ''}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Click any rule to inspect logic & probation state</p>
          </div>

          {loading ? (
            <div className="py-16 flex items-center justify-center">
              <Spinner className="w-6 h-6" />
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
              {rules.map((r) => {
                const isSelected = selectedRule?.id === r.id;
                const isSuspended = r.probation?.suspended;
                // Three states, not two. Suspended wins over dormant when both
                // hold: suspension is a live decision about officer attention,
                // dormancy is a standing fact about the data path.
                const isDormant = Boolean(r.dormant_reason);
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRule(r)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer flex flex-col gap-1.5 ${
                      isSelected ? 'bg-blue-50 border-l-4 border-secondary' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-blue-600">{r.id}</span>
                        <SeverityChip severity={r.severity} />
                      </div>
                      {isSuspended ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-destructive/20 text-destructive">
                          SUSPENDED
                        </span>
                      ) : isDormant ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-500/20 text-amber-700"
                          title="Implemented, but no data path — cannot fire"
                        >
                          DORMANT
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-900 line-clamp-1">{r.name}</p>
                    <p className="text-xs text-slate-500 line-clamp-1">{r.description}</p>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Selected Rule Detail & Probation View */}
        <div className="lg:col-span-2 space-y-6">
          {selectedRule ? (
            <>
              <Card className="space-y-5 border-blue-200">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold text-blue-600">{selectedRule.id}</span>
                      <h2 className="text-xl font-bold text-slate-900">{selectedRule.name}</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Category: {selectedRule.category}</p>
                  </div>
                  <VerificationBadge status={selectedRule.verification_status} />
                </div>

                {/* Dormancy disclosure, above the objective.
                    Placed first deliberately: everything below this point describes
                    what the rule would do, and reading that as a description of what
                    the platform is currently checking is the misreading this banner
                    exists to prevent. */}
                {selectedRule.dormant_reason && (
                  <div className="flex gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                        Dormant — this rule cannot fire on current data
                      </p>
                      <p className="text-sm text-amber-900 leading-relaxed">{selectedRule.dormant_reason}</p>
                      <p className="text-xs text-amber-700 leading-relaxed">
                        The logic is implemented and enabled. It produces no alerts because the field it reads has
                        no writer, so an absence of findings here is not evidence of an absence of the problem.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Rule Objective</h4>
                  <p className="text-sm text-text-main leading-relaxed bg-slate-50/90 p-4 rounded-lg border border-white/5">
                    {selectedRule.description}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Evidence Template</h4>
                  <pre className="text-xs font-mono text-blue-600 bg-slate-50/90 p-4 rounded-lg border border-white/5 overflow-x-auto">
                    {selectedRule.evidence_template}
                  </pre>
                </div>

                {/* Parameters & Applicability */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-white/5 space-y-1 text-xs">
                    <span className="text-slate-500 font-medium">Lifecycle Applicability</span>
                    <p className="text-slate-900 font-semibold">
                      {selectedRule.applies_to_status ? selectedRule.applies_to_status.join(', ') : 'All Work Lifecycles'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-white/5 space-y-1 text-xs">
                    <span className="text-slate-500 font-medium">Configured Parameters</span>
                    <pre className="text-xs font-mono text-slate-900">
                      {JSON.stringify(selectedRule.params, null, 2)}
                    </pre>
                  </div>
                </div>
              </Card>

              {/* Live Probation State Card */}
              <Card className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" />
                    <span>Empirical Probation Matrix (Self-Pruning Guardrail)</span>
                  </h3>
                  <span className="text-xs text-slate-500">Threshold: 40% actionable over 25 reviews</span>
                </div>

                <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-slate-50 border border-white/5 text-center">
                  <div>
                    <p className="text-xs text-slate-500">Total Reviews</p>
                    <p className="text-xl font-bold text-slate-900 mt-1">{selectedRule.probation?.total_reviews ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Dismissals</p>
                    <p className="text-xl font-bold text-amber-400 mt-1">{selectedRule.probation?.dismissals ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Actionable Rate</p>
                    <p className="text-xl font-bold text-emerald-400 mt-1">
                      {(((selectedRule.probation?.actionable_rate ?? 1.0)) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-600" />
                  <span>
                    If false positives exceed 60% after 25 casework reviews, this rule is automatically suspended to protect officer attention.
                  </span>
                </div>
              </Card>
            </>
          ) : (
            <div className="py-24 text-center text-slate-500">Select a rule from the catalog to inspect.</div>
          )}
        </div>
      </div>
    </div>
  );
}
