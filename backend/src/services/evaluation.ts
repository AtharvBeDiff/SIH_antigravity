/**
 * Evaluation Service
 *
 * Compares detected alerts against the answer_key table to measure empirical
 * Precision, Recall, and F1 per anomaly type.
 *
 * Honesty contract: every metric here is a ratio, and a ratio with a zero
 * denominator is *undefined*. When that happens this service returns `null` — it
 * does not substitute a plausible-looking constant.
 *
 * **Scope.** The answer key covers the rules whose ground truth `data-gen` can
 * determine; emergent findings (R-001's per-category outliers, R-009's duplicate
 * detection) and rules needing artifacts the generator does not produce (photos,
 * health reports) have no ground truth and are outside it. Precision is therefore
 * computed over the covered rules **only**, and `covered_rule_ids` names them.
 * Scoring an uncovered rule's alerts as false positives would be measuring the
 * answer key's coverage and calling it the engine's accuracy.
 *
 * **What recall means here.** The answer key is the generator's own restatement of
 * each rule's physical condition, so a miss means the condition did not survive
 * the trip through the catalogue, status filters, probation and the alert store —
 * a rule disabled, gated on the wrong status, or reading a column nothing writes.
 * It does not mean the rule would miss genuine wrongdoing. No synthetic corpus can
 * measure that.
 */

import { all, insert } from '../db.ts';
import { newId, nowIso } from '../util.ts';
import type { Alert, AnswerKey, EvaluationRun, TypeMetrics } from '../types.ts';

export type { TypeMetrics };

export interface RunEvaluationOptions {
  seed?: number;
  /**
   * Persist the run to `evaluation_runs`. Off by default so read-only callers
   * (GET /insight/evaluation) can recompute without writing.
   */
  persist?: boolean;
}

/** `work_id` and `rule_id` together — the granularity a match is judged at. */
function pairKey(workId: string, ruleId: string): string {
  return `${workId}::${ruleId}`;
}

export async function runEvaluation(opts: RunEvaluationOptions = {}): Promise<EvaluationRun> {
  const { seed = 42, persist = false } = opts;

  const [alerts, answers, works] = await Promise.all([
    all<Alert>('alerts'),
    all<AnswerKey>('answer_key'),
    all<{ id: string }>('works', { select: 'id' }),
  ]);

  // The rules the answer key can speak to. Anything outside this set is not
  // scored in either direction — there is no ground truth to score it against.
  const coveredRules = new Set(
    answers.map((a) => a.expected_rule_id).filter((r): r is string => Boolean(r)),
  );

  // Every planted (work, rule) pair. Matching on the pair rather than on the work
  // is the point: a work planted as a cost outlier does not become exempt from
  // false-positive counting for every *other* rule that fires on it.
  const plantedPairs = new Set<string>();
  for (const ans of answers) {
    if (ans.expected_rule_id) plantedPairs.add(pairKey(ans.work_id, ans.expected_rule_id));
  }

  const alertMap = new Map<string, Alert[]>();
  for (const alt of alerts) {
    const list = alertMap.get(alt.work_id) ?? [];
    list.push(alt);
    alertMap.set(alt.work_id, list);
  }

  let totalTP = 0;
  let totalFP = 0;
  let totalFN = 0;

  const perType: Record<string, TypeMetrics> = {};

  // Group answer key by anomaly type
  const answersByType = new Map<string, AnswerKey[]>();
  for (const ans of answers) {
    const list = answersByType.get(ans.anomaly_type) ?? [];
    list.push(ans);
    answersByType.set(ans.anomaly_type, list);
  }

  for (const [type, typeAnswers] of answersByType.entries()) {
    let tp = 0;
    let fn = 0;

    for (const ans of typeAnswers) {
      const workAlerts = alertMap.get(ans.work_id) ?? [];
      // A planted anomaly counts as detected only when the rule that is supposed to
      // catch it actually fired. Counting *any* alert on the work would credit a
      // planted cost outlier that only tripped a delay rule.
      const detectedIt = ans.expected_rule_id
        ? workAlerts.some((a) => a.rule_id === ans.expected_rule_id)
        : workAlerts.length > 0;

      if (detectedIt) tp++;
      else fn++;
    }

    const planted = typeAnswers.length;

    perType[type] = {
      planted,
      detected: tp,
      true_positives: tp,
      false_negatives: fn,
      recall: planted > 0 ? tp / planted : null,
    };

    totalTP += tp;
    totalFN += fn;
  }

  // False positives, and the alerts that cannot be judged either way.
  //
  // This counted every alert on a work absent from the answer key. Two things were
  // wrong with that. A work carrying one planted anomaly absorbed unlimited
  // unrelated alerts without any of them counting; and every alert from a rule the
  // key does not cover — R-001, R-009, the delay detectors — was scored as a false
  // positive, so precision fell as those rules did more work.
  let unscored = 0;
  for (const alt of alerts) {
    if (!alt.rule_id || !coveredRules.has(alt.rule_id)) {
      unscored++;
      continue;
    }
    if (!plantedPairs.has(pairKey(alt.work_id, alt.rule_id))) totalFP++;
  }

  // A zero denominator means the metric is undefined, not 1.0 and not 0.0.
  const precisionDenom = totalTP + totalFP;
  const recallDenom = totalTP + totalFN;

  const overallPrecision = precisionDenom > 0 ? totalTP / precisionDenom : null;
  const overallRecall = recallDenom > 0 ? totalTP / recallDenom : null;
  const overallF1 =
    overallPrecision !== null && overallRecall !== null && overallPrecision + overallRecall > 0
      ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall)
      : null;

  const evalRun: EvaluationRun = {
    id: newId(),
    run_at: nowIso(),
    seed,
    total_works: works.length,
    total_planted: answers.length,
    total_alerts: alerts.length,
    covered_rule_ids: [...coveredRules].sort(),
    unscored_alerts: unscored,
    precision_val: overallPrecision,
    recall_val: overallRecall,
    f1_val: overallF1,
    per_type: perType,
  };

  if (persist) {
    try {
      await insert('evaluation_runs', evalRun as unknown as Record<string, unknown>);
    } catch (err: any) {
      console.warn('Could not persist evaluation_run to DB:', err.message);
    }
  }

  return evalRun;
}
