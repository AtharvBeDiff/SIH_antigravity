/**
 * SLA Router — GET /sla/stats, POST /sla/evaluate
 */

import { Router } from 'express';
import { actorOf } from '../http.ts';
import {
  assessSanctionSla,
  evaluateProposalSLAs,
  fetchUndecidedWorks,
  getSlaThresholds,
} from '../services/sla_engine.ts';
import type { SLAStats } from '../types.ts';

const router = Router();

/**
 * GET /sla/stats — aggregated sanction-decision SLA statistics.
 *
 * This endpoint used to be a second implementation of the clause: it carried its
 * own `SLA_LIMIT_DAYS = 45` / `SLA_WARNING_DAYS = 35`, so a YAML edit moved the
 * alerts without moving this tile, and it selected `status = 'PROPOSED'` — a value
 * absent from `WORK_STATUSES`, so on canonical data it matched nothing and this
 * screen reported zeros while the queue filled with breach alerts. It now shares
 * `assessSanctionSla` with the alerting path, so the two cannot disagree.
 */
router.get('/stats', async (_req, res) => {
  const thresholds = getSlaThresholds();
  const works = await fetchUndecidedWorks();
  const now = new Date();

  let breached = 0;
  let atRisk = 0;
  let safe = 0;
  let rejected = 0;
  let notTrackable = 0;

  // Averaged over the works that actually have a measurable age. The previous
  // version divided `totalDays` by `works.length` while skipping undated works in
  // the numerator, so every work missing a recommendation date pulled the reported
  // average toward zero.
  let totalDays = 0;
  let measured = 0;

  for (const work of works) {
    const { outcome, days_pending } = assessSanctionSla(work, thresholds, now);
    switch (outcome) {
      case 'BREACHED': breached++; break;
      case 'AT_RISK': atRisk++; break;
      case 'WITHIN_SLA': safe++; break;
      case 'REJECTED_DECISION_DATE_UNKNOWN': rejected++; break;
      case 'NOT_TRACKABLE': notTrackable++; break;
    }
    if (days_pending !== null && days_pending >= 0) {
      totalDays += days_pending;
      measured++;
    }
  }

  const stats: SLAStats = {
    total: works.length,
    breached,
    atRisk,
    safe,
    rejected,
    notTrackable,
    // null, not 0, when nothing is measurable: 0 reads as "decisions are
    // instantaneous", which is the opposite of "we cannot tell".
    avgDays: measured > 0 ? Math.round(totalDays / measured) : null,
    measuredCount: measured,
    limitDays: thresholds.limitDays,
    warningDays: thresholds.warningDays,
  };

  res.json({ data: stats });
});

/**
 * POST /sla/evaluate — run the sanction-decision SLA engine and persist its alerts.
 *
 * The actor is passed through so the audit entry names whoever triggered the run
 * rather than attributing it to `system`. The engine writes to `alerts`, and an
 * unattributed mutation of the triage queue is exactly what the ledger exists to
 * prevent.
 *
 * No try/catch: Express 5 forwards the rejection to the error middleware. The engine
 * now throws when the upsert fails, and that has to reach the caller — this endpoint
 * used to answer `alertsGenerated: 12` for a run that persisted nothing.
 */
router.post('/evaluate', async (req, res) => {
  const alerts = await evaluateProposalSLAs(actorOf(req));
  // `upserted`, not `generated`: some of these rows already existed and were
  // recomputed in place. The old name read as "12 new alerts appeared", which
  // overstates a run that re-evaluated twelve known ones.
  res.json({
    data: {
      alerts_upserted: alerts.length,
      breached: alerts.filter((a) => a.reason_code === 'SLA_BREACHED').length,
      at_risk: alerts.filter((a) => a.reason_code === 'SLA_AT_RISK').length,
    },
  });
});

export default router;
