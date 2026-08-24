import { test } from 'node:test';
import * as assert from 'node:assert';
import 'dotenv/config';
import type { Work } from '../src/types.ts';
import { evaluateWorkRules } from '../src/services/rule_engine.ts';
import { detectDuplicates } from '../src/detectors/duplicate.ts';
import { runAnalyze } from '../src/services/alerts.ts';

test('doctrine #6: rule engine null-field safety', async () => {
  // Work with nulls everywhere
  const emptyWork: Work = {
    id: 'w_empty',
    district_id: 'd_1',
    constituency_id: null,
    agency_id: null,
    title: 'Test Empty Work',
    description: null,
    category: 'ROADS',
    sub_category: null,
    location_name: 'Location A',
    latitude: null,
    longitude: null,
    ward: null,
    sanctioned_amount: null as any,
    released_amount: null as any,
    expenditure: null as any,
    first_installment: null,
    second_installment: null,
    sanction_date: null as any,
    recommended_date: null,
    completion_target_date: null,
    actual_completion_date: null,
    last_payment_date: null,
    status: 'NOT_STARTED',
    physical_progress_pct: null as any,
    has_uc: false,
    uc_date: null,
    phase: 1,
    is_scsp: false,
    is_tsp: false,
    evidence_image_key: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
  };

  const candidates = await evaluateWorkRules(emptyWork);
  // Must NOT throw, and must NOT fire false alerts on missing/null numbers
  assert.strictEqual(candidates.length, 0);
});

test('rule engine evaluates cost overrun (R-004)', async () => {
  const overrunWork: Work = {
    id: 'w_overrun',
    district_id: 'd_1',
    constituency_id: null,
    agency_id: null,
    title: 'Costly Project',
    description: null,
    category: 'ROADS',
    sub_category: null,
    location_name: 'Location A',
    latitude: 28.5,
    longitude: 77.2,
    ward: null,
    sanctioned_amount: 1000000,
    released_amount: 1200000,
    expenditure: 1250000, // 25% overrun
    first_installment: 1000000,
    second_installment: 200000,
    sanction_date: '2024-01-01',
    recommended_date: null,
    completion_target_date: null,
    actual_completion_date: null,
    last_payment_date: '2024-06-01',
    status: 'IN_PROGRESS',
    physical_progress_pct: 50,
    has_uc: false,
    uc_date: null,
    phase: 1,
    is_scsp: false,
    is_tsp: false,
    evidence_image_key: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const candidates = await evaluateWorkRules(overrunWork);
  const r004 = candidates.find(c => c.rule_id === 'R-004');
  assert.ok(r004, 'R-004 should fire for 25% cost overrun');
  assert.strictEqual(r004.severity, 'CRITICAL');
});

test('duplicate detector 2-of-3 corroboration', () => {
  const w1: Work = {
    id: 'w1',
    district_id: 'd_north',
    constituency_id: null,
    agency_id: null,
    title: 'Construction of Community Hall at Block A',
    description: null,
    category: 'COMMUNITY',
    sub_category: null,
    location_name: 'Block A',
    latitude: 28.6139,
    longitude: 77.2090,
    ward: null,
    sanctioned_amount: 2000000,
    released_amount: 2000000,
    expenditure: 0,
    first_installment: null,
    second_installment: null,
    sanction_date: '2025-01-01',
    recommended_date: null,
    completion_target_date: null,
    actual_completion_date: null,
    last_payment_date: null,
    status: 'APPROVED',
    physical_progress_pct: 0,
    has_uc: false,
    uc_date: null,
    phase: 1,
    is_scsp: false,
    is_tsp: false,
    evidence_image_key: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
  };

  const w2: Work = {
    ...w1,
    id: 'w2',
    title: 'Community Hall Construction in Block A', // High text similarity
    latitude: 28.6141, // ~25m away
    longitude: 77.2092,
    sanctioned_amount: 2100000, // 5% diff
  };

  const duplicates = detectDuplicates([w1, w2]);
  assert.strictEqual(duplicates.length, 1);
  assert.strictEqual(duplicates[0]!.rule_id, 'R-009');
});

test('analysis pipeline runs end-to-end against live DB', async () => {
  const summary = await runAnalyze('test_officer');
  assert.ok(summary.works_analyzed > 0);
  assert.ok(summary.total_candidates > 0);
  assert.ok(summary.open_alerts > 0);
});
