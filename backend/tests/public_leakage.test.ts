import { test } from 'node:test';
import * as assert from 'node:assert';
import { toPublicWork } from '../src/services/public_view.ts';
import type { Work } from '../src/types.ts';

test('doctrine #4: public view strictly prevents internal leakage', () => {
  const sensitiveWork: Work & Record<string, unknown> = {
    id: 'work_123',
    district_id: 'd_1',
    constituency_id: 'c_1',
    agency_id: 'a_1',
    title: 'Solar High Mast Lighting Installation',
    description: 'Detailed public description',
    category: 'ENERGY',
    sub_category: 'SOLAR',
    location_name: 'Village Square',
    latitude: 28.5,
    longitude: 77.2,
    ward: 'Ward 4',
    sanctioned_amount: 500000,
    released_amount: 500000,
    expenditure: 500000,
    first_installment: 250000,
    second_installment: 250000,
    sanction_date: '2024-01-01',
    recommended_date: '2023-12-01',
    completion_target_date: '2024-06-01',
    actual_completion_date: '2024-05-15',
    last_payment_date: '2024-05-20',
    status: 'COMPLETED',
    physical_progress_pct: 100,
    has_uc: true,
    uc_date: '2024-06-01',
    phase: 1,
    is_scsp: false,
    is_tsp: false,
    evidence_image_key: 'hash_secret_photo_123',
    created_at: '2024-01-01',
    updated_at: '2024-05-20',
    // Injected sensitive fields:
    alerts: [{ id: 'alt_1', rule_id: 'R-001', severity: 'CRITICAL' }],
    severity: 'CRITICAL',
    confidence: 0.99,
    reviewed_by: 'Officer Ramesh',
    dismiss_reason: 'TEST_DISMISS',
    answer_key_plant: true,
  };

  const publicWork = toPublicWork(sensitiveWork, 'North District', 'North Constituency') as Record<string, unknown>;

  // Allowed whitelist fields
  const allowedKeys = new Set([
    'id', 'title', 'description', 'category', 'location_name',
    'status', 'physical_progress_pct', 'sanctioned_amount', 'expenditure',
    'sanction_date', 'actual_completion_date', 'district_name', 'constituency_name'
  ]);

  for (const key of Object.keys(publicWork)) {
    assert.ok(allowedKeys.has(key), `Unapproved key found in public payload: ${key}`);
  }

  // Explicit negative assertions
  assert.strictEqual(publicWork['alerts'], undefined);
  assert.strictEqual(publicWork['severity'], undefined);
  assert.strictEqual(publicWork['confidence'], undefined);
  assert.strictEqual(publicWork['reviewed_by'], undefined);
  assert.strictEqual(publicWork['dismiss_reason'], undefined);
  assert.strictEqual(publicWork['answer_key_plant'], undefined);
  assert.strictEqual(publicWork['evidence_image_key'], undefined);
  assert.strictEqual(publicWork['agency_id'], undefined);
  assert.strictEqual(publicWork['district_id'], undefined);
});
