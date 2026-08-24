/**
 * Rule Probation Service
 *
 * Tracks the actionable rate of each rule.
 * If a rule falls below 40% actionable rate over 25 reviews,
 * it is auto-suspended until reinstated.
 */

import { all, get, upsert } from '../db.ts';
import { nowIso } from '../util.ts';
import type { RuleProbation } from '../types.ts';

const PROBATION_MIN_REVIEWS = 25;
const PROBATION_THRESHOLD = 0.40;

export async function getRuleProbation(ruleId: string): Promise<RuleProbation> {
  const existing = await get<RuleProbation>('rule_probation', { rule_id: ruleId });
  if (existing) return existing;

  const defaultState: RuleProbation = {
    rule_id: ruleId,
    total_reviews: 0,
    dismissals: 0,
    actionable_rate: 1.0,
    suspended: false,
    suspended_at: null,
    reinstated_at: null,
  };
  return defaultState;
}

export async function getSuspendedRuleIds(): Promise<Set<string>> {
  try {
    const list = await all<RuleProbation>('rule_probation', { where: { suspended: true } });
    return new Set(list.map(r => r.rule_id));
  } catch {
    return new Set();
  }
}

export async function recordReviewForRule(ruleId: string, action: string): Promise<RuleProbation> {
  const state = await getRuleProbation(ruleId);
  const isDismissal = action === 'DISMISSED';

  const total_reviews = state.total_reviews + 1;
  const dismissals = state.dismissals + (isDismissal ? 1 : 0);
  const actionable_rate = (total_reviews - dismissals) / total_reviews;

  let suspended = state.suspended;
  let suspended_at = state.suspended_at;

  // Auto-suspend if below threshold after minimum reviews
  if (total_reviews >= PROBATION_MIN_REVIEWS && actionable_rate < PROBATION_THRESHOLD && !suspended) {
    suspended = true;
    suspended_at = nowIso();
  }

  const updated: RuleProbation = {
    rule_id: ruleId,
    total_reviews,
    dismissals,
    actionable_rate,
    suspended,
    suspended_at,
    reinstated_at: state.reinstated_at,
  };

  await upsert('rule_probation', updated as unknown as Record<string, unknown>, 'rule_id');
  return updated;
}

export async function reinstateRule(ruleId: string): Promise<RuleProbation> {
  const state = await getRuleProbation(ruleId);
  const updated: RuleProbation = {
    ...state,
    suspended: false,
    reinstated_at: nowIso(),
  };
  await upsert('rule_probation', updated as unknown as Record<string, unknown>, 'rule_id');
  return updated;
}

export async function isRuleSuspended(ruleId: string): Promise<boolean> {
  const state = await getRuleProbation(ruleId);
  return state.suspended;
}
