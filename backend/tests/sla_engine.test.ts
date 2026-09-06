import { test } from 'node:test';
import * as assert from 'node:assert';
import 'dotenv/config';
import type { Work } from '../src/types.ts';
import { assessSanctionSla, getSlaThresholds } from '../src/services/sla_engine.ts';

/**
 * The sanction-decision SLA (R-020 / R-021).
 *
 * These tests pin `assessSanctionSla`, which is deliberately pure: it takes a
 * work, the thresholds, and an explicit as-of date, and touches no database. The
 * clause used to be implemented twice — once in the alerting engine, once inline
 * in `routers/sla.ts` — and the two disagreed about which works were even in
 * scope. A pure function is what makes the disagreement testable.
 *
 * The as-of date is fixed. Passing `new Date()` would make the boundary cases
 * pass or fail depending on the day the suite runs.
 */
const AS_OF = new Date('2026-09-05T00:00:00Z');

/** A minimal work; every case overrides only the fields it is about. */
function work(over: Partial<Work>): Work {
  return {
    recommended_date: null,
    sanction_date: null,
    status: 'NOT_STARTED',
    ...over,
  } as Work;
}

test('SLA thresholds are read from the rule catalogue, not hardcoded', () => {
  const t = getSlaThresholds();
  assert.strictEqual(t.limitDays, 45);
  assert.strictEqual(t.warningDays, 35);
  // `applies_to_status` must actually be consulted. A declaration in the YAML
  // that no code reads is how the catalogue and the engine drift apart.
  assert.ok(Array.isArray(t.appliesToStatus), 'applies_to_status should be read from R-020');
  assert.ok(!t.appliesToStatus!.includes('CANCELLED'), 'a rejected work is not awaiting a decision');
});

test('a work past the limit is a breach', () => {
  const t = getSlaThresholds();
  const r = assessSanctionSla(work({ recommended_date: '2026-05-28', status: 'IN_PROGRESS' }), t, AS_OF);
  assert.strictEqual(r.outcome, 'BREACHED');
  assert.strictEqual(r.days_pending, 100);
});

test('the limit and warning boundaries are exclusive', () => {
  const t = getSlaThresholds();
  // Exactly 45 days is not yet a breach — the rule reads "exceeding the limit".
  assert.strictEqual(assessSanctionSla(work({ recommended_date: '2026-07-22' }), t, AS_OF).outcome, 'AT_RISK');
  assert.strictEqual(assessSanctionSla(work({ recommended_date: '2026-07-21' }), t, AS_OF).outcome, 'BREACHED');
  // Same shape at the warning mark.
  assert.strictEqual(assessSanctionSla(work({ recommended_date: '2026-08-01' }), t, AS_OF).outcome, 'WITHIN_SLA');
  assert.strictEqual(assessSanctionSla(work({ recommended_date: '2026-07-31' }), t, AS_OF).outcome, 'AT_RISK');
});

test('a rejection is a decision, not a breach', () => {
  const t = getSlaThresholds();
  // 100 days old and still unsanctioned, but cancelled — a rejection satisfies
  // the clause as much as a sanction does. Both implementations used to report
  // this as a CRITICAL breach.
  const r = assessSanctionSla(work({ recommended_date: '2026-05-28', status: 'CANCELLED' }), t, AS_OF);
  assert.strictEqual(r.outcome, 'REJECTED_DECISION_DATE_UNKNOWN');
  // Not claimed as compliant either: there is no rejection-date field, so
  // whether the decision was timely is unknown rather than assumed.
  assert.strictEqual(r.days_pending, null);
});

test('doctrine #6: a missing recommendation date is untrackable, not compliant', () => {
  const t = getSlaThresholds();
  const r = assessSanctionSla(work({ recommended_date: null, status: 'IN_PROGRESS' }), t, AS_OF);
  assert.strictEqual(r.outcome, 'NOT_TRACKABLE');
  assert.strictEqual(r.days_pending, null);
  assert.match(r.reason ?? '', /recommendation date/);
});

test('a future recommendation date does not manufacture a breach', () => {
  const t = getSlaThresholds();
  // Both implementations computed `Math.abs(now - recommended)`, so a work
  // recommended 118 days in the future read as 118 days *pending* and was
  // reported as a CRITICAL breach. The interval is signed; a negative one is a
  // data-quality problem, not a sanctioning delay.
  const r = assessSanctionSla(work({ recommended_date: '2027-01-01', status: 'IN_PROGRESS' }), t, AS_OF);
  assert.strictEqual(r.outcome, 'NOT_TRACKABLE');
  assert.ok((r.days_pending ?? 0) < 0, 'the negative interval is preserved, not absolute-valued');
});

test('an unparseable recommendation date is reported, not treated as epoch', () => {
  const t = getSlaThresholds();
  const r = assessSanctionSla(work({ recommended_date: 'not-a-date', status: 'IN_PROGRESS' }), t, AS_OF);
  assert.strictEqual(r.outcome, 'NOT_TRACKABLE');
  assert.strictEqual(r.days_pending, null);
});

test('a sanctioned work is out of scope for the pending-decision clause', () => {
  const t = getSlaThresholds();
  const r = assessSanctionSla(
    work({ recommended_date: '2020-01-01', sanction_date: '2020-02-01', status: 'COMPLETED' }),
    t,
    AS_OF,
  );
  assert.strictEqual(r.outcome, 'NOT_TRACKABLE');
});
