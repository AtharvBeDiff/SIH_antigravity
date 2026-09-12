/**
 * Alerts Integration Hub
 *
 * Implements the fixed analysis pipeline:
 *   1. Compute benchmarks (district-category medians & MAD)
 *   2. Run rule engine (R-002, R-003, R-004, R-005, R-008, R-011, R-012, R-013, R-014)
 *   3. Run statistical & heuristic detectors (R-001, R-006, R-007, R-009, R-015, R-010)
 *   4. Preserve officer decisions (if reviewed/dismissed, maintain state)
 *   5. Enforce alert budget (max 10 open per district, excess -> BACKLOG)
 *   6. Upsert alerts, and retire the ones this run no longer produces
 *   7. Append to audit chain
 *
 * R-010's entry used to read "called on every run and returns nothing on every
 * run, because nothing writes `works.evidence_image_key`". A writer exists now —
 * `seed_mock_data.mjs` sets a 64-bit perceptual hash on ~420 works — so the
 * detector has inputs and fires.
 */

import { all, getDb, upsertMany } from '../db.ts';
import type { Work, Alert } from '../types.ts';
import type { AnomalyCandidate } from '../detectors/cost_outlier.ts';
import { computeBenchmarks } from './benchmarks.ts';
import { evaluateWorkRules, loadRulesConfig } from './rule_engine.ts';
import { getSuspendedRuleIds } from './probation.ts';
import { allPayments } from './payments.ts';
import { lastReportDateByWork } from './health_reports.ts';
import { groupPaymentsByWork } from './fund_flow.ts';
import { detectCostOutliers } from '../detectors/cost_outlier.ts';
import { delayParamsFromRules, detectDelays } from '../detectors/delay.ts';
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
  /** Alerts the run no longer produces, moved to AUTO_RESOLVED. */
  auto_resolved: number;
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
      auto_resolved: 0,
      run_at: nowIso(),
    };
  }

  // 1. Benchmarks, suspended rules and the payment history (pre-fetched once).
  //
  // Payments are fetched here rather than per-work: R-002, R-012 and R-014 all
  // read money movement, and 200 works would otherwise be 200 round trips. A
  // work missing from the result is passed through as an empty array — it has
  // no payments, and the fetch succeeded, so that is a fact — but only if the
  // table holds rows at all. See the corpus-level check below.
  //
  // The health-report cadence is fetched the same way and for the same reason:
  // R-019 asks when each work was last reported on, and that is one query over
  // `health_reports` rather than one per work.
  const [benchmarks, suspendedIds, payments, lastReportDate] = await Promise.all([
    computeBenchmarks(),
    getSuspendedRuleIds(),
    allPayments(),
    lastReportDateByWork(),
  ]);
  const paymentsByWork = groupPaymentsByWork(payments);

  // An empty table corpus-wide means the data has not been loaded, not that
  // nothing ever happened.
  //
  // The distinction above is drawn per work, and per work it is right. It is
  // wrong one level up: if `payments` holds zero rows for *every* work, then
  // `paymentsByWork.get(id) ?? []` reports each of the 2,200 works as
  // definitively never paid, and R-014 raises an alert on every work sanctioned
  // more than 90 days ago. Measured against the live corpus that is 607 alerts,
  // none of which mean anything. R-019 has the same shape for a different
  // reason — `lastReportDateByWork()` returns an empty Map, and an empty Map is
  // truthy, so the guard inside the detector passes and 484 works are reported
  // as overdue on a report nobody has ever been able to file.
  //
  // Both collapse the same way: absence of evidence read as evidence of
  // absence, which is doctrine #6 inverted. And because step 6 upserts without
  // ever deleting, the ~1,090 alerts would survive every later run that
  // correctly declined to raise them. Whether the table is populated is a fact
  // about the corpus, so it is settled once here rather than per work.
  const paymentsLoaded = payments.length > 0;
  const reportsLoaded = lastReportDate.size > 0;

  // 2. Rule evaluation per work
  const candidates: AnomalyCandidate[] = [];
  for (const w of works) {
    const workAlerts = await evaluateWorkRules(
      w,
      suspendedIds,
      paymentsLoaded ? (paymentsByWork.get(w.id) ?? []) : undefined,
    );
    candidates.push(...workAlerts);
  }

  // 3. Corpus-wide Detectors
  //
  // The delay detector's thresholds come from the rule catalogue rather than from
  // literals inside the detector, so editing `rules/mplads_rules.yaml` actually
  // changes behaviour. Before this, R-006's `max_months` was documented on /rules
  // and ignored by the code that fired it.
  const delayParams = delayParamsFromRules(loadRulesConfig().rules);

  // Probation applies to these eight rules too.
  //
  // `getSuspendedRuleIds()` was consulted by `evaluateWorkRules` and by nothing
  // else, so suspending R-009 — the rule the calibration page is most likely to
  // put on probation, and one of only two the detectors own outright — changed
  // nothing at all. The next run raised its alerts again. A suspension that the
  // engine ignores is worse than no suspension: the officer is told the rule is
  // paused and then handed its findings anyway.
  //
  // Filtering the output is deliberate rather than threading the set through
  // four more signatures. Cost-outlier and duplicate detection are corpus-wide
  // statistics — the median and the peer groups have to be computed over every
  // work regardless — so there is nothing to save by suspending earlier, and
  // the detectors stay ignorant of probation, which is not their concern.
  const detected = [
    ...detectCostOutliers(works, benchmarks),
    ...detectDelays(works, delayParams, reportsLoaded ? lastReportDate : undefined),
    ...detectDuplicates(works),
    ...detectPhotoReuse(works),
  ];
  candidates.push(...detected.filter((c) => !suspendedIds.has(c.rule_id)));

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

  // 6b. Retire alerts this run no longer produces.
  //
  // The pipeline only ever upserted, so an alert outlived the evidence for it.
  // Nothing removed a finding once the data stopped supporting it, which meant
  // every wrong answer the system had ever given was still on the dossier: when
  // `allPayments()` was truncated at PostgREST's 1,000-row cap, one run wrote
  // 539 "no payment in 90 days" alerts against the 75 works that qualify, and
  // fixing the fetch did not take the other 464 back off. An officer opening
  // the queue could not tell which findings the current data still supports.
  //
  // `AUTO_RESOLVED` rather than DELETE, for three reasons: the status has been
  // in `ALERT_STATUSES` since the schema was written and nothing had ever
  // written it; `review_actions.alert_id` is a foreign key, so deleting a
  // reviewed alert would take an officer's decision with it; and a finding that
  // was raised and then withdrawn is itself part of the record.
  //
  // Two exclusions. An alert an officer has already acted on keeps that status —
  // the run has no standing to overwrite a human decision. And a suspended
  // rule's alerts are left alone: probation means the rule is paused, not that
  // its past findings were wrong, and auto-resolving them would silently erase
  // the backlog the calibration page exists to reason about.
  const produced = new Set(toUpsert.map((r) => `${r.work_id}::${r.origin_id}`));
  const stale = existingAlerts.filter(
    (a) =>
      !produced.has(`${a.work_id}::${a.origin_id}`) &&
      (a.status === 'OPEN' || a.status === 'BACKLOG') &&
      !suspendedIds.has(a.rule_id),
  );

  if (stale.length > 0) {
    const db = getDb();
    const CHUNK = 200;
    for (let i = 0; i < stale.length; i += CHUNK) {
      const ids = stale.slice(i, i + CHUNK).map((a) => a.id);
      const { error } = await db
        .from('alerts')
        .update({ status: 'AUTO_RESOLVED', in_budget: false, updated_at: nowIso() })
        .in('id', ids);
      if (error) throw new Error(`DB retire(alerts): ${error.message}`);
    }
  }

  // 7. Audit Log
  const runTimestamp = nowIso();
  await appendAudit(actor, 'ANALYZE_PIPELINE_COMPLETE', 'system', 'alerts', {
    works_count: works.length,
    total_candidates: candidates.length,
    open_alerts: openCount,
    backlog_alerts: backlogCount,
    preserved_reviews: preservedReviewsCount,
    auto_resolved: stale.length,
    timestamp: runTimestamp,
  });

  return {
    works_analyzed: works.length,
    total_candidates: candidates.length,
    open_alerts: openCount,
    backlog_alerts: backlogCount,
    preserved_reviews: preservedReviewsCount,
    auto_resolved: stale.length,
    run_at: runTimestamp,
  };
}
