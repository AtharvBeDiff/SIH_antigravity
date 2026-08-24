/**
 * Alerts Integration Hub
 *
 * Implements the fixed analysis pipeline:
 *   1. Compute benchmarks (district-category medians & MAD)
 *   2. Run rule engine (R-002, R-003, R-004, R-005, R-008, R-011, R-012, R-013, R-014)
 *   3. Run statistical & heuristic detectors (R-001, R-006, R-007, R-009, R-010, R-015)
 *   4. Preserve officer decisions (if reviewed/dismissed, maintain state)
 *   5. Enforce alert budget (max 10 open per district, excess -> BACKLOG)
 *   6. Upsert alerts to database
 *   7. Append to audit chain
 */

import { all, upsertMany } from '../db.ts';
import type { Work, Alert } from '../types.ts';
import type { AnomalyCandidate } from '../detectors/cost_outlier.ts';
import { computeBenchmarks } from './benchmarks.ts';
import { evaluateWorkRules } from './rule_engine.ts';
import { getSuspendedRuleIds } from './probation.ts';
import { detectCostOutliers } from '../detectors/cost_outlier.ts';
import { detectDelays } from '../detectors/delay.ts';
import { detectDuplicates } from '../detectors/duplicate.ts';
import { detectPhotoReuse } from '../detectors/photo_reuse.ts';
import { appendAudit } from './audit_chain.ts';
import { newId, nowIso } from '../util.ts';

const MAX_OPEN_PER_DISTRICT = 10;

export interface AnalysisSummary {
  works_analyzed: number;
  total_candidates: number;
  open_alerts: number;
  backlog_alerts: number;
  preserved_reviews: number;
  run_at: string;
}

export async function runAnalyze(actor = 'system'): Promise<AnalysisSummary> {
  const works = await all<Work>('works');
  if (works.length === 0) {
    return {
      works_analyzed: 0,
      total_candidates: 0,
      open_alerts: 0,
      backlog_alerts: 0,
      preserved_reviews: 0,
      run_at: nowIso(),
    };
  }

  // 1. Benchmarks & Suspended Rules (pre-fetched once)
  const [benchmarks, suspendedIds] = await Promise.all([
    computeBenchmarks(),
    getSuspendedRuleIds(),
  ]);

  // 2. Rule evaluation per work
  const candidates: AnomalyCandidate[] = [];
  for (const w of works) {
    const workAlerts = await evaluateWorkRules(w, suspendedIds);
    candidates.push(...workAlerts);
  }

  // 3. Corpus-wide Detectors
  candidates.push(...detectCostOutliers(works, benchmarks));
  candidates.push(...detectDelays(works));
  candidates.push(...detectDuplicates(works));
  candidates.push(...detectPhotoReuse(works));

  // 4. Fetch existing alerts to preserve officer reviews
  const existingAlerts = await all<Alert>('alerts');
  const existingMap = new Map<string, Alert>();
  for (const a of existingAlerts) {
    existingMap.set(`${a.work_id}::${a.origin_id}`, a);
  }

  // Group candidates by district for budgeting
  const workDistrictMap = new Map<string, string>();
  for (const w of works) {
    if (w.district_id) workDistrictMap.set(w.id, w.district_id);
  }

  const districtGroups = new Map<string, AnomalyCandidate[]>();
  for (const c of candidates) {
    const dId = workDistrictMap.get(c.work_id) ?? 'unknown';
    const list = districtGroups.get(dId) ?? [];
    list.push(c);
    districtGroups.set(dId, list);
  }

  // 5. Budgeting & Upsert Preparation
  const toUpsert: Record<string, unknown>[] = [];
  let openCount = 0;
  let backlogCount = 0;
  let preservedReviewsCount = 0;

  for (const [_districtId, group] of districtGroups.entries()) {
    // Sort by severity rank ASC (CRITICAL: 1, HIGH: 2, etc.), then confidence DESC
    group.sort((a, b) => a.severity_rank - b.severity_rank || b.confidence - a.confidence);

    for (let i = 0; i < group.length; i++) {
      const c = group[i]!;
      const key = `${c.work_id}::${c.origin_id}`;
      const prev = existingMap.get(key);

      const in_budget = i < MAX_OPEN_PER_DISTRICT;
      let status = in_budget ? 'OPEN' : 'BACKLOG';

      // Preserve existing officer review
      let reviewed_by = null;
      let reviewed_at = null;
      let dismiss_reason = null;
      let dismiss_note = null;

      if (prev && prev.status !== 'OPEN' && prev.status !== 'BACKLOG') {
        status = prev.status; // Preserve ACKNOWLEDGED, DISMISSED, ESCALATED
        reviewed_by = prev.reviewed_by;
        reviewed_at = prev.reviewed_at;
        dismiss_reason = prev.dismiss_reason;
        dismiss_note = prev.dismiss_note;
        preservedReviewsCount++;
      } else {
        if (in_budget) openCount++;
        else backlogCount++;
      }

      toUpsert.push({
        id: prev?.id ?? newId(),
        work_id: c.work_id,
        rule_id: c.rule_id,
        origin_id: c.origin_id,
        severity: c.severity,
        severity_rank: c.severity_rank,
        status,
        reason_code: c.reason_code,
        evidence_text: c.evidence_text,
        confidence: c.confidence,
        in_budget,
        reviewed_by,
        reviewed_at,
        dismiss_reason,
        dismiss_note,
        updated_at: nowIso(),
      });
    }
  }

  // 6. Upsert to DB
  if (toUpsert.length > 0) {
    await upsertMany('alerts', toUpsert, 'work_id,origin_id');
  }

  // 7. Audit Log
  const runTimestamp = nowIso();
  await appendAudit(actor, 'ANALYZE_PIPELINE_COMPLETE', 'system', 'alerts', {
    works_count: works.length,
    total_candidates: candidates.length,
    open_alerts: openCount,
    backlog_alerts: backlogCount,
    preserved_reviews: preservedReviewsCount,
    timestamp: runTimestamp,
  });

  return {
    works_analyzed: works.length,
    total_candidates: candidates.length,
    open_alerts: openCount,
    backlog_alerts: backlogCount,
    preserved_reviews: preservedReviewsCount,
    run_at: runTimestamp,
  };
}
