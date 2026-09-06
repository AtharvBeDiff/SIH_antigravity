import { getDb } from '../db.ts';
import type { Alert, RuleDefinition, SeverityLevel, Work, WorkStatus } from '../types.ts';
import { SEVERITY_RANK } from '../types.ts';
import { newId } from '../util.ts';
import { appendAudit } from './audit_chain.ts';
import { getSuspendedRuleIds } from './probation.ts';
import { loadRulesConfig } from './rule_engine.ts';

/** Sanction-decision SLA rules, as catalogued in `rules/mplads_rules.yaml`. */
const BREACH_RULE_ID = 'R-020';
const AT_RISK_RULE_ID = 'R-021';

const DEFAULT_LIMIT_DAYS = 45;
const DEFAULT_WARNING_DAYS = 35;

function numericParam(rule: RuleDefinition | undefined, key: string, fallback: number): number {
  const raw = rule?.params?.[key];
  return typeof raw === 'number' ? raw : fallback;
}

/**
 * What the sanction-decision clause has to say about one work.
 *
 * The guidelines require a decision — sanction **or rejection** — inside the
 * limit, so a rejection is a compliant outcome, not a breach. These are the
 * distinct things that can be true; only the first two are findings.
 */
export type SlaOutcome =
  /** Still awaiting a decision, past the limit. */
  | 'BREACHED'
  /** Still awaiting a decision, past the warning mark but inside the limit. */
  | 'AT_RISK'
  /** Still awaiting a decision, comfortably inside the limit. */
  | 'WITHIN_SLA'
  /**
   * A decision was taken — the work was rejected — but no rejection date is on
   * record, so how long it took cannot be computed. Reported as its own outcome:
   * it is definitively not a pending breach, and claiming it met the limit would
   * assert something the data does not say.
   */
  | 'REJECTED_DECISION_DATE_UNKNOWN'
  /** No usable recommendation date, so the clock has no start. Doctrine 6. */
  | 'NOT_TRACKABLE';

export interface SlaAssessment {
  outcome: SlaOutcome;
  /** Days awaiting a decision, or null when that cannot be computed. */
  days_pending: number | null;
  /** Set when the outcome is NOT_TRACKABLE, saying what was missing. */
  reason?: string;
}

export interface SlaThresholds {
  limitDays: number;
  warningDays: number;
  /**
   * Statuses a work may hold and still be awaiting a decision, from R-020's
   * `applies_to_status`. Null means every status is in scope.
   */
  appliesToStatus: WorkStatus[] | null;
}

/**
 * Read the SLA configuration from the rule catalogue.
 *
 * `routers/sla.ts` used to carry its own `const SLA_LIMIT_DAYS = 45`, so the
 * statistics page and the alerts could be computed against different limits after
 * a single YAML edit. One reader, one source.
 */
export function getSlaThresholds(): SlaThresholds {
  const config = loadRulesConfig();
  const byId = new Map<string, RuleDefinition>(config.rules.map((r) => [r.id, r]));
  const breach = byId.get(BREACH_RULE_ID);
  return {
    limitDays: numericParam(breach, 'sla_limit_days', DEFAULT_LIMIT_DAYS),
    warningDays: numericParam(byId.get(AT_RISK_RULE_ID), 'sla_warning_days', DEFAULT_WARNING_DAYS),
    appliesToStatus: breach?.applies_to_status ?? null,
  };
}

/** Whole days from `from` to `asOf`. Negative when `from` is in the future. */
function daysSince(from: string, asOf: Date): number | null {
  const start = Date.parse(from.length <= 10 ? `${from}T00:00:00Z` : from);
  if (Number.isNaN(start)) return null;
  return Math.floor((asOf.getTime() - start) / 86_400_000);
}

/**
 * Assess one work against the sanction-decision clause.
 *
 * This is the single implementation. It previously existed twice — once here for
 * alerting and once in `routers/sla.ts` for the statistics tile — and the two
 * disagreed on the population: the engine applied no status filter at all, while
 * the router filtered `status = 'PROPOSED'`, a value absent from `WORK_STATUSES`,
 * so that endpoint reported zeros on any corpus using the canonical vocabulary.
 *
 * Three corrections are folded in:
 *
 * 1. **The interval is signed.** Both callers took `Math.abs()` of it, so a work
 *    recommended 100 days in the *future* read as 100 days pending and was
 *    reported as a breach. A negative interval is a data-quality problem, not a
 *    sanctioning delay.
 * 2. **A rejection is not a breach.** A cancelled work has had its decision.
 * 3. **A missing recommendation date makes the work untrackable**, not compliant.
 *    It has no clock start, and Doctrine 6 bars firing on the null.
 */
export function assessSanctionSla(
  work: Pick<Work, 'recommended_date' | 'sanction_date' | 'status'>,
  thresholds: SlaThresholds,
  asOf: Date,
): SlaAssessment {
  // A sanction date means the decision was taken. Whether it was taken *late* is
  // a different question from this one, and answering it needs the decision date
  // compared against the recommendation — not against today.
  if (work.sanction_date) {
    return { outcome: 'NOT_TRACKABLE', days_pending: null, reason: 'already sanctioned' };
  }

  // Out of the rule's declared scope. `applies_to_status` on R-020 lists the
  // statuses a work may hold and still be awaiting a decision; CANCELLED is
  // deliberately absent, because the clause is satisfied by a rejection as much
  // as by a sanction. Reading the list rather than hardcoding the check keeps the
  // catalogue load-bearing — a declaration nothing consults is how the YAML and
  // the code drift apart.
  if (thresholds.appliesToStatus && !thresholds.appliesToStatus.includes(work.status)) {
    if (work.status === 'CANCELLED') {
      // There is no `rejection_date` column, so the decision lag is genuinely
      // unknown rather than assumed compliant.
      return { outcome: 'REJECTED_DECISION_DATE_UNKNOWN', days_pending: null };
    }
    return {
      outcome: 'NOT_TRACKABLE',
      days_pending: null,
      reason: `status ${work.status} is outside the rule's declared scope`,
    };
  }

  if (!work.recommended_date) {
    return { outcome: 'NOT_TRACKABLE', days_pending: null, reason: 'no recommendation date on record' };
  }

  const days = daysSince(work.recommended_date, asOf);
  if (days === null) {
    return { outcome: 'NOT_TRACKABLE', days_pending: null, reason: 'recommendation date is unparseable' };
  }
  if (days < 0) {
    return { outcome: 'NOT_TRACKABLE', days_pending: days, reason: 'recommendation date is in the future' };
  }

  if (days > thresholds.limitDays) return { outcome: 'BREACHED', days_pending: days };
  if (days > thresholds.warningDays) return { outcome: 'AT_RISK', days_pending: days };
  return { outcome: 'WITHIN_SLA', days_pending: days };
}

/**
 * Every work that is still awaiting a sanction decision, plus the rejected ones.
 *
 * Rejected works are fetched too, so `/sla/stats` can report them as their own
 * outcome instead of leaving them out of the denominator entirely.
 */
export async function fetchUndecidedWorks(): Promise<Work[]> {
  const db = getDb();
  const { data, error } = await db.from('works').select('*').is('sanction_date', null);
  if (error || !data) {
    throw new Error(`Failed to fetch works for SLA evaluation: ${error?.message}`);
  }
  return data as Work[];
}

/** The `origin_id` every alert from this engine carries. */
const ORIGIN_ID = 'sla_engine';

/**
 * Alerts this engine has previously raised, keyed by work.
 *
 * Fetched so a re-evaluation reuses the existing row's `id` and carries forward any
 * officer decision on it, which is what `services/alerts.ts` does for the rules it
 * owns. Filtered on `origin_id` rather than on the two rule IDs, because the
 * `(work_id, origin_id)` pair is what the upsert conflicts on — matching on
 * anything else would find rows this write cannot collide with and miss rows it can.
 */
async function fetchExistingSlaAlerts(): Promise<Map<string, Alert>> {
  const db = getDb();
  const { data, error } = await db.from('alerts').select('*').eq('origin_id', ORIGIN_ID);
  if (error) {
    throw new Error(`Failed to fetch existing SLA alerts: ${error.message}`);
  }
  return new Map((data as Alert[]).map((a) => [a.work_id, a]));
}

/**
 * Evaluates the sanction-decision SLA for works with no sanction date.
 *
 * Thresholds, severities and enablement come from the rule catalogue, so the
 * YAML is the single place they can be changed. A rule the probation service
 * has suspended, or one marked `enabled: false`, produces no alerts.
 *
 * Only `BREACHED` and `AT_RISK` produce alerts. A rejected work, a work with no
 * recommendation date, and a work inside the warning mark are all silent — the
 * first because it has had its decision, the second because the clock has no
 * start, the third because nothing is wrong.
 *
 * Three things about the write were wrong and are fixed together, because each one
 * made the other two harder to see:
 *
 * 1. **It was unaudited.** Doctrine: every state mutation calls `appendAudit()`.
 *    This wrote to `alerts` — the table the triage queue reads — and left no trace,
 *    so an alert could appear in front of an officer with nothing in the ledger
 *    saying when or why it arrived. `POST /api/analyze` audits its own alert write;
 *    this path did not, and the two write the same table.
 * 2. **The write error was swallowed** into `console.error` while the function still
 *    returned the alert array, so `POST /sla/evaluate` answered
 *    `{ alertsGenerated: 12 }` on a run that persisted nothing. A caller cannot
 *    distinguish that from success, and neither can the audit entry now being
 *    written — which is why it must throw instead.
 * 3. **It overwrote officer reviews.** Every alert was pushed with `status: 'OPEN'`
 *    and upserted on `(work_id, origin_id)`, so an alert an officer had
 *    ACKNOWLEDGED or DISMISSED reverted to OPEN on the next evaluation, discarding
 *    the review and the dismissal reason. `services/alerts.ts` preserves those
 *    fields deliberately; this path silently undid the same officer's work.
 */
export async function evaluateProposalSLAs(actor = 'system'): Promise<Partial<Alert>[]> {
  const config = loadRulesConfig();
  const byId = new Map<string, RuleDefinition>(config.rules.map((r) => [r.id, r]));
  const breachRule = byId.get(BREACH_RULE_ID);
  const atRiskRule = byId.get(AT_RISK_RULE_ID);

  const suspended = await getSuspendedRuleIds();
  const breachActive = breachRule?.enabled === true && !suspended.has(BREACH_RULE_ID);
  const atRiskActive = atRiskRule?.enabled === true && !suspended.has(AT_RISK_RULE_ID);

  // Both rules off. Audited before returning, because this is the case most worth
  // having in the ledger: `POST /sla/evaluate` answers `alertsGenerated: 0`, which
  // is exactly what a clean corpus answers, and only the ledger distinguishes "no
  // work breached" from "the two SLA rules were suspended and nothing was checked".
  if (!breachActive && !atRiskActive) {
    await appendAudit(actor, 'SLA_ALERTS_SKIPPED', 'system', 'alerts', {
      reason: 'both sanction-SLA rules are disabled or suspended',
      breach_rule_enabled: breachRule?.enabled === true,
      breach_rule_suspended: suspended.has(BREACH_RULE_ID),
      at_risk_rule_enabled: atRiskRule?.enabled === true,
      at_risk_rule_suspended: suspended.has(AT_RISK_RULE_ID),
      evaluated_at: new Date().toISOString(),
    });
    return [];
  }

  const thresholds = getSlaThresholds();
  const undecided = await fetchUndecidedWorks();

  // Alerts this engine has already raised, so an officer's decision survives a
  // re-evaluation and an existing row keeps its primary key.
  //
  // The key matters beyond preserving reviews: the upsert conflicts on
  // `(work_id, origin_id)` and every alert was built with a fresh `newId()`, so
  // re-evaluating an existing alert tried to rewrite the `id` of a row that
  // `review_actions.alert_id` references. The foreign key is `ON DELETE CASCADE`,
  // not `ON UPDATE CASCADE`, so that is a constraint violation once any alert from
  // this engine has been reviewed — the failure was reachable only after an officer
  // had acted, and was swallowed by the `console.error` below.
  const existing = await fetchExistingSlaAlerts();

  const alerts: Partial<Alert>[] = [];
  /** Officer decisions carried forward, for the audit payload. */
  let preservedReviews = 0;
  const now = new Date();

  for (const work of undecided) {
    const { outcome, days_pending } = assessSanctionSla(work, thresholds, now);

    // Both outcomes build the same row shape, so the id-reuse and review-preserving
    // logic lives in one place. It was duplicated across the two branches, which is
    // how one of them could have been fixed and the other left alone.
    const spec =
      outcome === 'BREACHED' && breachActive
        ? {
            ruleId: BREACH_RULE_ID,
            severity: (breachRule?.severity ?? 'CRITICAL') as SeverityLevel,
            reasonCode: 'SLA_BREACHED',
            evidence: `Work has been awaiting a sanction decision for ${days_pending} days, exceeding the ${thresholds.limitDays}-day limit.`,
          }
        : outcome === 'AT_RISK' && atRiskActive
          ? {
              ruleId: AT_RISK_RULE_ID,
              severity: (atRiskRule?.severity ?? 'HIGH') as SeverityLevel,
              reasonCode: 'SLA_AT_RISK',
              evidence: `Work has been awaiting a sanction decision for ${days_pending} days, past the ${thresholds.warningDays}-day warning mark and approaching the ${thresholds.limitDays}-day limit.`,
            }
          : null;
    if (!spec) continue;

    const prev = existing.get(work.id);

    // An officer's decision outranks a re-evaluation. OPEN and BACKLOG are the
    // engine's own states and are recomputed; anything else — ACKNOWLEDGED,
    // DISMISSED, ESCALATED — is a human judgement on this work and is carried
    // forward with the reason that was given for it.
    const reviewed = prev && prev.status !== 'OPEN' && prev.status !== 'BACKLOG';
    if (reviewed) preservedReviews++;

    alerts.push({
      // Reuse the existing row's id. A fresh one would try to change the primary key
      // that `review_actions.alert_id` points at.
      id: prev?.id ?? newId(),
      work_id: work.id,
      rule_id: spec.ruleId,
      origin_id: ORIGIN_ID,
      severity: spec.severity,
      severity_rank: SEVERITY_RANK[spec.severity],
      status: reviewed ? prev.status : 'OPEN',
      in_budget: true,
      reason_code: spec.reasonCode,
      // Evidence is always recomputed, including on a reviewed alert: the day count
      // has moved on and a stale figure on an acknowledged alert would misstate how
      // overdue the decision now is. The officer's verdict is preserved; the facts
      // behind it are current.
      evidence_text: spec.evidence,
      reviewed_by: reviewed ? prev.reviewed_by : null,
      reviewed_at: reviewed ? prev.reviewed_at : null,
      dismiss_reason: reviewed ? prev.dismiss_reason : null,
      dismiss_note: reviewed ? prev.dismiss_note : null,
      // `created_at` is when the alert was first raised, not when it was last
      // recomputed. Overwriting it made every alert look newly discovered on each
      // run, so "open for 3 weeks" was unreadable from the row.
      created_at: prev?.created_at ?? now.toISOString(),
      updated_at: now.toISOString(),
    });
  }

  // Persist, then audit. In that order: an audit entry for a write that failed is a
  // ledger asserting something that did not happen.
  if (alerts.length > 0) {
    const { error: insertError } = await getDb()
      .from('alerts')
      .upsert(alerts as any[], { onConflict: 'work_id,origin_id' });

    // Thrown, not logged. This used to `console.error` and return the alert array
    // regardless, so `POST /sla/evaluate` reported `alertsGenerated: 12` for a run
    // that persisted nothing — a caller, and the officer looking at an unchanged
    // queue, had no way to tell the difference.
    if (insertError) {
      throw new Error(`Failed to save SLA alerts: ${insertError.message}`);
    }
  }

  // Doctrine: every state mutation is audited. Recorded even when nothing was
  // raised, because "the SLA engine ran and found nothing" is a fact about the
  // queue that an empty ledger cannot distinguish from "the engine never ran".
  await appendAudit(actor, 'SLA_ALERTS_EVALUATED', 'system', 'alerts', {
    works_undecided: undecided.length,
    alerts_upserted: alerts.length,
    breached: alerts.filter((a) => a.rule_id === BREACH_RULE_ID).length,
    at_risk: alerts.filter((a) => a.rule_id === AT_RISK_RULE_ID).length,
    preserved_reviews: preservedReviews,
    // Which rules were actually allowed to fire. An empty result means something
    // different when a rule is suspended than when no work breached, and the
    // catalogue can change between runs.
    breach_rule_active: breachActive,
    at_risk_rule_active: atRiskActive,
    limit_days: thresholds.limitDays,
    warning_days: thresholds.warningDays,
    evaluated_at: now.toISOString(),
  });

  return alerts;
}
