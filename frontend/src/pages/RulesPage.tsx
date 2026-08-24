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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Rules Engine & Probation Matrix"
        description="The 17 automated compliance rules governing financial pacing, milestone integrity, and anti-fraud heuristics."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rules Catalog List */}
        <Card className="lg:col-span-1 p-0 overflow-hidden divide-y divide-border/40">
          <div className="p-4 bg-surface/50 border-b border-border/50">
            <h3 className="text-sm font-semibold text-white">Rule Catalog (17 Rules)</h3>
            <p className="text-xs text-text-muted mt-0.5">Click any rule to inspect logic & probation state</p>
          </div>

          {loading ? (
            <div className="py-16 flex items-center justify-center">
              <Spinner className="w-6 h-6" />
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto divide-y divide-border/30">
              {rules.map((r) => {
                const isSelected = selectedRule?.id === r.id;
                const isSuspended = r.probation?.suspended;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRule(r)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer flex flex-col gap-1.5 ${
                      isSelected ? 'bg-secondary/10 border-l-4 border-secondary' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-secondary">{r.id}</span>
                        <SeverityChip severity={r.severity} />
                      </div>
                      {isSuspended ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-destructive/20 text-destructive">
                          SUSPENDED
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-white line-clamp-1">{r.name}</p>
                    <p className="text-xs text-text-muted line-clamp-1">{r.description}</p>
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
              <Card className="space-y-5 border-secondary/20">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-border/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold text-secondary">{selectedRule.id}</span>
                      <h2 className="text-xl font-bold text-white">{selectedRule.name}</h2>
                    </div>
                    <p className="text-xs text-text-muted mt-1">Category: {selectedRule.category}</p>
                  </div>
                  <VerificationBadge status={selectedRule.verification_status} />
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Rule Objective</h4>
                  <p className="text-sm text-text-main leading-relaxed bg-surface/90 p-4 rounded-lg border border-white/5">
                    {selectedRule.description}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Evidence Template</h4>
                  <pre className="text-xs font-mono text-secondary bg-surface/90 p-4 rounded-lg border border-white/5 overflow-x-auto">
                    {selectedRule.evidence_template}
                  </pre>
                </div>

                {/* Parameters & Applicability */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-lg bg-surface border border-white/5 space-y-1 text-xs">
                    <span className="text-text-muted font-medium">Lifecycle Applicability</span>
                    <p className="text-white font-semibold">
                      {selectedRule.applies_to_status ? selectedRule.applies_to_status.join(', ') : 'All Work Lifecycles'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-surface border border-white/5 space-y-1 text-xs">
                    <span className="text-text-muted font-medium">Configured Parameters</span>
                    <pre className="text-xs font-mono text-white">
                      {JSON.stringify(selectedRule.params, null, 2)}
                    </pre>
                  </div>
                </div>
              </Card>

              {/* Live Probation State Card */}
              <Card className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Shield className="w-4 h-4 text-secondary" />
                    <span>Empirical Probation Matrix (Self-Pruning Guardrail)</span>
                  </h3>
                  <span className="text-xs text-text-muted">Threshold: 40% actionable over 25 reviews</span>
                </div>

                <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-surface border border-white/5 text-center">
                  <div>
                    <p className="text-xs text-text-muted">Total Reviews</p>
                    <p className="text-xl font-bold text-white mt-1">{selectedRule.probation?.total_reviews ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Dismissals</p>
                    <p className="text-xl font-bold text-amber-400 mt-1">{selectedRule.probation?.dismissals ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Actionable Rate</p>
                    <p className="text-xl font-bold text-emerald-400 mt-1">
                      {(((selectedRule.probation?.actionable_rate ?? 1.0)) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="text-xs text-text-muted flex items-center gap-2">
                  <Info className="w-4 h-4 text-secondary" />
                  <span>
                    If false positives exceed 60% after 25 casework reviews, this rule is automatically suspended to protect officer attention.
                  </span>
                </div>
              </Card>
            </>
          ) : (
            <div className="py-24 text-center text-text-muted">Select a rule from the catalog to inspect.</div>
          )}
        </div>
      </div>
    </div>
  );
}
