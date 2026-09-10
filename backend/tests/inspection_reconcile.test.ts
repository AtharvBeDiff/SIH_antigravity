/**
 * Inspection reconciliation tests — P-10's comparator, with no database and no model.
 *
 * `reconcile` is a pure function over an inspection record, a work and a list of photographs,
 * which is precisely why this file can exist: the whole of P-10's judgement is testable without
 * a Supabase connection, a Gemini key, or a fixture upload.
 *
 * The bias here mirrors `photo_ai.test.ts` and `document_ai.test.ts`: **most of it is about not
 * fabricating.** An inspector with no GPS fix, a work whose coordinate was never captured, a
 * status vocabulary the check has never seen — each of those is a missing input, and each must
 * produce a skipped check rather than a finding. A platform that reports a discrepancy because
 * it compared a real number against a placeholder has not found fraud; it has found its own bug,
 * and pointed an officer at an innocent work.
 *
 * The distinction the whole feature rests on, asserted repeatedly below: `findings: []` with a
 * non-empty `checks_run` means "compared, and they agree". `findings: []` with `checks_run: []`
 * means "nothing could be compared". They render identically on a dossier and mean opposite
 * things.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import type { Work, WorkPhoto } from '../src/types.ts';
import { CHECK_IDS, reconcile, type InspectionRecord } from '../src/services/inspection_reconcile.ts';
import { INGEST_DEFAULT_LATITUDE, INGEST_DEFAULT_LONGITUDE } from '../src/util.ts';

// ─── Fixtures ───────────────────────────────────────────────────────────────

/**
 * A real coordinate in Coimbatore, and a second point ~40 km away.
 *
 * Deliberately not Delhi: the ingest's placeholder is a Delhi centroid, and a fixture set built
 * around Delhi would make it easy to write a test that passes because of the placeholder rather
 * than in spite of it.
 */
const SITE_LAT = 11.0168;
const SITE_LON = 76.9558;

/** ~44 km north of the site — past the 1 km tolerance, inside the 50 km "far" threshold. */
const NEARBY_LAT = 11.4168;
const NEARBY_LON = 76.9558;

/** Chennai — ~380 km east. Past the 50 km threshold; no single work spans this. */
const FAR_LAT = 13.0827;
const FAR_LON = 80.2707;

/** A completed work at the Coimbatore site. */
function makeWork(overrides: Partial<Work> = {}): Work {
  return {
    id: 'w1',
    district_id: 'd1',
    constituency_id: 'c1',
    agency_id: 'a1',
    mp_name: '',
    esakshi_work_id: 'ES-1',
    title: 'Construction of community hall',
    description: '',
    category: 'COMMUNITY_INFRASTRUCTURE' as Work['category'],
    sub_category: null,
    location_name: 'Ward 7',
    latitude: SITE_LAT,
    longitude: SITE_LON,
    ward: null,
    sanctioned_amount: 1_000_000,
    released_amount: 1_000_000,
    expenditure: 1_000_000,
    first_installment: null,
    second_installment: null,
    sanction_date: '2025-01-10',
    recommended_date: '2024-12-01',
    completion_target_date: null,
    actual_completion_date: '2025-11-20',
    last_payment_date: null,
    status: 'COMPLETED' as Work['status'],
    physical_progress_pct: 100,
    has_uc: true,
    uc_date: null,
    phase: 1,
    is_scsp: false,
    is_tsp: false,
    evidence_image_key: null,
    ...overrides,
  } as Work;
}

/** A photograph with no EXIF at all — the common case, since messaging apps strip it. */
function makePhoto(overrides: Partial<WorkPhoto> = {}): WorkPhoto {
  return {
    id: 'p1',
    work_id: 'w1',
    caption: null,
    storage_key: 'photos/p1.jpg',
    content_type: 'image/jpeg',
    size_bytes: 1024,
    content_sha256: 'sha-1',
    exif_latitude: null,
    exif_longitude: null,
    exif_taken_at: null,
    uploaded_by: 'system',
    uploaded_at: '2026-01-05T00:00:00Z',
    ...overrides,
  };
}

/** An inspector standing at the site, on 2026-01-05, finding nothing wrong. */
function makeInspection(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    latitude: SITE_LAT,
    longitude: SITE_LON,
    inspection_date: '2026-01-05',
    overall_status: 'SATISFACTORY',
    ...overrides,
  };
}

// ─── Nothing to compare is a measured result, not a clean one ────────────────

test('an inspection with nothing to compare produces no findings and runs no checks', () => {
  // No GPS fix, no photographs, and a work still in progress so the completion check has
  // nothing to contradict. Every check's precondition fails, so `checks_run` is empty — and the
  // caller stores that `[]` rather than letting the dossier imply four checks came back clean.
  const { findings, checks_run } = reconcile(
    makeInspection({ latitude: null, longitude: null }),
    makeWork({ status: 'IN_PROGRESS' as Work['status'], physical_progress_pct: 40 }),
    [],
  );
  assert.deepStrictEqual(findings, []);
  assert.deepStrictEqual(checks_run, []);
});

test('an inspection that agrees with the record runs checks and finds nothing', () => {
  // The other half of the same distinction: the inspector is at the site, a geotagged photo was
  // taken that day, and the inspector agrees the work is done. Checks ran; none fired.
  const { findings, checks_run } = reconcile(
    makeInspection(),
    makeWork(),
    [makePhoto({ exif_latitude: SITE_LAT, exif_longitude: SITE_LON, exif_taken_at: '2026-01-05T10:00:00Z' })],
  );
  assert.deepStrictEqual(findings, []);
  assert.ok(checks_run.length >= 3, `expected several checks to run, ran: ${checks_run.join(', ') || 'none'}`);
});

// ─── I-001 · inspector GPS vs the site's own photographs ─────────────────────

test('I-001 does not run when no photograph carries a geotag', () => {
  const { checks_run } = reconcile(makeInspection(), makeWork(), [makePhoto(), makePhoto({ id: 'p2' })]);
  assert.ok(!checks_run.includes('I-001'), 'no geotag means no distance to measure');
});

test('I-001 does not run when the inspector recorded no GPS fix', () => {
  // A device indoors, or with location denied. Doctrine 6: the check does not measure a distance
  // to a null and call the result a mismatch.
  const { checks_run } = reconcile(
    makeInspection({ latitude: null, longitude: null }),
    makeWork(),
    [makePhoto({ exif_latitude: FAR_LAT, exif_longitude: FAR_LON })],
  );
  assert.ok(!checks_run.includes('I-001'));
});

test('I-001 measures to the closest geotagged photo and names it', () => {
  // Three photographs, one of them at the site. The finding must key on the *closest* — a work
  // with one stray photo among many is not evidence the inspector was somewhere else — and it
  // must carry that photo's id so an officer can open the exact image the distance was measured
  // to (doctrine 7: a finding an officer cannot open is not explainable).
  const { findings, checks_run } = reconcile(
    makeInspection(),
    makeWork(),
    [
      makePhoto({ id: 'far', exif_latitude: FAR_LAT, exif_longitude: FAR_LON }),
      makePhoto({ id: 'nearby', exif_latitude: NEARBY_LAT, exif_longitude: NEARBY_LON }),
      makePhoto({ id: 'stray', exif_latitude: FAR_LAT, exif_longitude: FAR_LON }),
    ],
  );
  assert.ok(checks_run.includes('I-001'));
  const i001 = findings.find((f) => f.check_id === 'I-001');
  assert.ok(i001, 'a 44 km gap to the closest photo should fire');
  assert.strictEqual(i001.photo_id, 'nearby', 'the closest photo, not the first or the furthest');
  assert.strictEqual(i001.severity, 'MEDIUM', '44 km is past tolerance but inside the far threshold');
  assert.strictEqual(i001.deviation_unit, 'METRES');
  assert.ok(i001.deviation !== null && i001.deviation > 1_000 && i001.deviation < 50_000,
    `deviation ${i001.deviation} m should be tens of kilometres`);
  assert.strictEqual(i001.record_source, 'work_photos.exif_latitude/exif_longitude');
});

test('I-001 is HIGH beyond the far threshold', () => {
  const { findings } = reconcile(
    makeInspection(),
    makeWork(),
    [makePhoto({ id: 'chennai', exif_latitude: FAR_LAT, exif_longitude: FAR_LON })],
  );
  const i001 = findings.find((f) => f.check_id === 'I-001');
  assert.ok(i001);
  assert.strictEqual(i001.severity, 'HIGH');
  assert.ok(i001.deviation !== null && i001.deviation > 50_000);
});

test('I-001 runs and stays silent when the photo is at the inspector', () => {
  const { findings, checks_run } = reconcile(
    makeInspection(),
    makeWork(),
    [makePhoto({ exif_latitude: SITE_LAT, exif_longitude: SITE_LON })],
  );
  assert.ok(checks_run.includes('I-001'), 'the check runs');
  assert.strictEqual(findings.find((f) => f.check_id === 'I-001'), undefined, 'zero metres is agreement');
});

// ─── I-002 · the inspector's verdict vs a completion claim ───────────────────

test('I-002 is HIGH when the inspector found no work on a completed record', () => {
  // The money-leak case, stated plainly: payment is released against completion.
  const { findings, checks_run } = reconcile(
    makeInspection({ overall_status: 'WORK_NOT_STARTED' }),
    makeWork(),
    [],
  );
  assert.ok(checks_run.includes('I-002'));
  const i002 = findings.find((f) => f.check_id === 'I-002');
  assert.ok(i002);
  assert.strictEqual(i002.severity, 'HIGH');
  assert.strictEqual(i002.observed_value, 'WORK_NOT_STARTED');
  assert.strictEqual(i002.record_value, 'COMPLETED');
  assert.strictEqual(i002.record_source, 'works.status');
  assert.strictEqual(i002.deviation, null, 'a categorical disagreement has no magnitude');
  assert.strictEqual(i002.deviation_unit, null, 'and therefore no unit');
});

test('I-002 is MEDIUM for found defects — a step below no work at all', () => {
  const { findings } = reconcile(makeInspection({ overall_status: 'DEFECTS_FOUND' }), makeWork(), []);
  const i002 = findings.find((f) => f.check_id === 'I-002');
  assert.ok(i002);
  assert.strictEqual(i002.severity, 'MEDIUM');
});

test('I-002 never reaches CRITICAL', () => {
  // An inspection is one observer on one day. The gap may be a reporting lag rather than
  // misconduct, and the check cannot tell the two apart from here.
  for (const status of ['WORK_NOT_STARTED', 'FAIL', 'DEFECTS_FOUND', 'PARTIAL']) {
    const { findings } = reconcile(makeInspection({ overall_status: status }), makeWork(), []);
    const i002 = findings.find((f) => f.check_id === 'I-002');
    assert.ok(i002, `${status} should fire`);
    assert.notStrictEqual(i002.severity, 'CRITICAL', `${status} must not be CRITICAL`);
  }
});

test('I-002 runs but stays silent on a benign status', () => {
  // INACCESSIBLE is a known status that asserts nothing is wrong — the inspector could not get
  // in. The check ran and found no disagreement, which is a different fact from not running.
  const { findings, checks_run } = reconcile(
    makeInspection({ overall_status: 'INACCESSIBLE' }),
    makeWork(),
    [],
  );
  assert.ok(checks_run.includes('I-002'), 'a known status is judgeable');
  assert.strictEqual(findings.find((f) => f.check_id === 'I-002'), undefined);
});

test('I-002 does not run on a status the check has never seen', () => {
  // `inspections.overall_status` is TEXT with no CHECK constraint and two vocabularies already
  // in the table. An unrecognised third value must be treated as unknown — not silently read as
  // a defect (a fabricated finding) and not read as clean (a missed one).
  const { findings, checks_run } = reconcile(
    makeInspection({ overall_status: 'AWAITING_REVIEW' }),
    makeWork(),
    [],
  );
  assert.ok(!checks_run.includes('I-002'));
  assert.strictEqual(findings.find((f) => f.check_id === 'I-002'), undefined);
});

test('I-002 does not run when the record makes no completion claim', () => {
  // Nothing to contradict: an inspector finding an in-progress work unfinished is agreement.
  const { checks_run } = reconcile(
    makeInspection({ overall_status: 'WORK_NOT_STARTED' }),
    makeWork({ status: 'IN_PROGRESS' as Work['status'], physical_progress_pct: 30 }),
    [],
  );
  assert.ok(!checks_run.includes('I-002'));
});

test('I-002 fires on a 100% progress claim even when the status is not COMPLETED', () => {
  const { findings } = reconcile(
    makeInspection({ overall_status: 'WORK_NOT_STARTED' }),
    makeWork({ status: 'IN_PROGRESS' as Work['status'], physical_progress_pct: 100 }),
    [],
  );
  const i002 = findings.find((f) => f.check_id === 'I-002');
  assert.ok(i002, '100% physical progress is a completion claim');
  assert.strictEqual(i002.record_source, 'works.physical_progress_pct',
    'the finding names the column it actually compared against');
});

test('I-002 does not fire on a null physical progress', () => {
  // Doctrine 11: a null progress is unmeasured, never 0 and never 100. `null >= 100` is false in
  // JavaScript, which is the right answer — this pins it so a later refactor to `?? 0` or
  // `Number(...)` cannot quietly change it.
  const { findings, checks_run } = reconcile(
    makeInspection({ overall_status: 'WORK_NOT_STARTED' }),
    makeWork({ status: 'IN_PROGRESS' as Work['status'], physical_progress_pct: null as any }),
    [],
  );
  assert.ok(!checks_run.includes('I-002'));
  assert.strictEqual(findings.find((f) => f.check_id === 'I-002'), undefined);
});

// ─── I-003 · photograph capture time vs the inspection date ──────────────────

test('I-003 does not run when no photograph carries a capture time', () => {
  const { checks_run } = reconcile(
    makeInspection(),
    makeWork(),
    [makePhoto({ exif_latitude: SITE_LAT, exif_longitude: SITE_LON })],
  );
  assert.ok(!checks_run.includes('I-003'), 'no timestamp means no lag to measure');
});

test('I-003 stays silent for a photograph taken a few weeks after the visit', () => {
  // Legitimate: uploaded late, or a follow-up shot. Inside the tolerance.
  const { findings, checks_run } = reconcile(
    makeInspection({ inspection_date: '2026-01-05' }),
    makeWork(),
    [makePhoto({ exif_taken_at: '2026-02-04T10:00:00Z' })], // 30 days
  );
  assert.ok(checks_run.includes('I-003'), 'the check runs');
  assert.strictEqual(findings.find((f) => f.check_id === 'I-003'), undefined);
});

test('I-003 fires in DAYS once the gap is beyond a month', () => {
  const { findings } = reconcile(
    makeInspection({ inspection_date: '2026-01-05' }),
    makeWork(),
    [makePhoto({ id: 'photo_late', exif_taken_at: '2026-02-14T10:00:00Z' })], // 40 days
  );
  const i003 = findings.find((f) => f.check_id === 'I-003');
  assert.ok(i003, 'a 40-day gap should fire');
  assert.strictEqual(i003.severity, 'MEDIUM', 'a late upload is a provenance question, not proof');
  assert.strictEqual(i003.deviation_unit, 'DAYS', 'without the unit this reads as 40 metres');
  assert.ok(i003.deviation !== null && i003.deviation >= 39 && i003.deviation <= 41,
    `deviation ${i003.deviation} should be about 40 days`);

  // The panel labels `observed_value` "Inspector recorded:" and `record_value` "Work record:"
  // for all four checks, so which side each value lands on is a contract, not a detail. This
  // check read them backwards — the photograph's EXIF date under "Inspector recorded", and
  // `inspections.inspection_date` printed under the heading "Work record" — until a review
  // caught it. The inspector recorded the visit date; the platform holds the photo's timestamp.
  assert.strictEqual(i003.observed_value, '2026-01-05', 'the inspector recorded the visit date');
  assert.strictEqual(i003.record_value, '2026-02-14', 'the platform holds the EXIF capture date');
  assert.strictEqual(i003.record_source, 'work_photos.exif_taken_at');

  // Names the photograph it measured, so the officer can open that image rather than guess
  // which of a dozen produced the gap.
  assert.strictEqual(i003.photo_id, 'photo_late');
});

test('I-003 never fires for a photograph taken before the inspection', () => {
  // A negative lag is not a finding. A site photographed a year earlier may be a different
  // question, but it is not the one this check asks, and reporting it here would be a wrong
  // explanation attached to a real number.
  const { findings } = reconcile(
    makeInspection({ inspection_date: '2026-01-05' }),
    makeWork(),
    [makePhoto({ exif_taken_at: '2025-01-05T10:00:00Z' })],
  );
  assert.strictEqual(findings.find((f) => f.check_id === 'I-003'), undefined);
});

test('I-003 survives an unparseable inspection date without fabricating a lag', () => {
  // Asserted on `checks_run`, not just on `findings`. This test passed while the column lied:
  // `run.push('I-003')` used to fire as soon as a photo carried any `exif_taken_at` string, and
  // the two parse guards came after it — so an unparseable date returned
  // `{findings: [], checks_run: ['I-003']}` and the panel rendered "no disagreement across the
  // 1 check that ran". Silence and a clean bill of health are the two things this column exists
  // to keep apart, so the absence of a finding is not enough to assert here.
  const { findings, checks_run } = reconcile(
    makeInspection({ inspection_date: 'not-a-date' }),
    makeWork(),
    [makePhoto({ exif_taken_at: '2026-06-01T10:00:00Z' })],
  );
  assert.strictEqual(findings.find((f) => f.check_id === 'I-003'), undefined);
  assert.ok(!checks_run.includes('I-003'), 'a lag that cannot be computed is not a check that ran');
});

test('I-003 does not claim to have run when every photo timestamp is junk', () => {
  // The mirror of the case above, on the other side of the subtraction: the photos carry
  // non-null `exif_taken_at` values, so they pass the filter, but none of them parses. Nothing
  // can be compared, and `checks_run` has to say so.
  const { findings, checks_run } = reconcile(
    makeInspection({ inspection_date: '2026-01-05' }),
    makeWork(),
    [makePhoto({ exif_taken_at: 'not-a-timestamp' }), makePhoto({ exif_taken_at: '' })],
  );
  assert.strictEqual(findings.find((f) => f.check_id === 'I-003'), undefined);
  assert.ok(!checks_run.includes('I-003'), 'no parseable timestamp means no comparison was made');
});

// ─── I-004 · inspector GPS vs the work's recorded coordinates ────────────────

test('I-004 does not run when the work sits on the ingest placeholder coordinate', () => {
  // The regression this check exists to avoid, and the reason `isDefaultedCoordinate` was
  // written. The CSV ingest writes a Delhi centroid for any work whose coordinates were absent.
  // Without the guard, an inspector standing at a genuine Coimbatore site measures ~2,000 km
  // from the work's "recorded" location and I-004 fires HIGH — on every uncaptured work outside
  // Delhi, at a volume that would bury the real findings under the platform's own data gap.
  //
  // Asserted as *skipped*, not merely silent: an officer must be able to see the check could not
  // run, which is exactly what a missing entry in `checks_run` says.
  const { findings, checks_run } = reconcile(
    makeInspection(),
    makeWork({ latitude: INGEST_DEFAULT_LATITUDE, longitude: INGEST_DEFAULT_LONGITUDE }),
    [],
  );
  assert.ok(!checks_run.includes('I-004'), 'the placeholder is not a coordinate to compare against');
  assert.strictEqual(findings.find((f) => f.check_id === 'I-004'), undefined);
});

test('I-004 does not run when only one component is the ingest placeholder', () => {
  // The half-defaulted pair, and the reason `isDefaultedCoordinate` tests the two components
  // with OR rather than AND. `routers/ingest.ts` defaults them independently —
  // `parseFloat(record['latitude'] || '28.6139')` and `parseFloat(record['longitude'] ||
  // '77.2090')` are two separate statements — and nothing requires the two CSV cells to be
  // filled or blank together. So a row with a real latitude and a blank longitude yields one
  // captured component and one placeholder.
  //
  // That pair is *worse* than a fully-defaulted one: the resulting point is plausible instead of
  // obviously Delhi, so a distance measured to it looks like a real finding. An AND guard
  // returns false here and lets I-004 fire HIGH against a longitude nobody ever recorded.
  for (const half of [
    { latitude: SITE_LAT, longitude: INGEST_DEFAULT_LONGITUDE },
    { latitude: INGEST_DEFAULT_LATITUDE, longitude: SITE_LON },
  ]) {
    const { findings, checks_run } = reconcile(makeInspection(), makeWork(half), []);
    assert.ok(
      !checks_run.includes('I-004'),
      `half-placeholder pair ${half.latitude}, ${half.longitude} must skip the check`,
    );
    assert.strictEqual(findings.find((f) => f.check_id === 'I-004'), undefined);
  }
});

test('I-004 runs against a genuine coordinate that happens to be in Delhi', () => {
  // The cost of the guard, stated honestly: a work on either placeholder literal is
  // indistinguishable from an uncaptured one and loses this check — a line through central Delhi
  // rather than a single address, since either component alone is disqualifying. A work a few
  // hundred metres off both literals does not: the guard is exact equality, and nothing wider.
  const { checks_run } = reconcile(
    makeInspection({ latitude: 28.7, longitude: 77.3 }),
    makeWork({ latitude: 28.62, longitude: 77.21 }),
    [],
  );
  assert.ok(checks_run.includes('I-004'));
});

test('I-004 does not run when the work has no recorded coordinates at all', () => {
  // `db.ts` selects '*', so a column missing from the table arrives as undefined rather than
  // null. Both must skip, which is why the reconciler uses `== null` and not `!== null`.
  for (const missing of [null, undefined]) {
    const { checks_run } = reconcile(
      makeInspection(),
      makeWork({ latitude: missing as any, longitude: missing as any }),
      [],
    );
    assert.ok(!checks_run.includes('I-004'), `${String(missing)} coordinates must skip the check`);
  }
});

test('I-004 fires against a real recorded coordinate far from the inspector', () => {
  const { findings, checks_run } = reconcile(
    makeInspection({ latitude: FAR_LAT, longitude: FAR_LON }),
    makeWork(),
    [],
  );
  assert.ok(checks_run.includes('I-004'));
  const i004 = findings.find((f) => f.check_id === 'I-004');
  assert.ok(i004);
  assert.strictEqual(i004.severity, 'HIGH');
  assert.strictEqual(i004.deviation_unit, 'METRES');
  assert.strictEqual(i004.record_source, 'works.latitude/longitude');
  assert.strictEqual(i004.photo_id, null, 'I-004 compares against a column, not a file');
});

// ─── Cross-cutting guarantees ───────────────────────────────────────────────

test('findings come back most severe first', () => {
  const { findings } = reconcile(
    makeInspection({ overall_status: 'DEFECTS_FOUND' }), // I-002 MEDIUM
    makeWork(),
    [makePhoto({ exif_latitude: FAR_LAT, exif_longitude: FAR_LON })], // I-001 HIGH
  );
  const ranks = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const seen = findings.map((f) => ranks[f.severity]);
  assert.ok(seen.length >= 2, `expected several findings, got ${findings.map((f) => f.check_id).join(', ')}`);
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), seen, 'not sorted by severity');
});

test('every finding names a published check', () => {
  const { findings } = reconcile(
    makeInspection({ latitude: FAR_LAT, longitude: FAR_LON, overall_status: 'WORK_NOT_STARTED' }),
    makeWork(),
    [makePhoto({ exif_latitude: SITE_LAT, exif_longitude: SITE_LON, exif_taken_at: '2026-06-01T10:00:00Z' })],
  );
  assert.ok(findings.length > 0, 'this fixture should produce findings');
  for (const f of findings) {
    assert.ok(f.check_id in CHECK_IDS, `${f.check_id} is not in the published catalogue`);
  }
});

test('no finding attributes the record side to a person', () => {
  // Doctrine 3, and the schema's own limits. No column records who entered a work's status, so
  // naming an author would be a fabrication — and the accountability unit here is the agency and
  // the district, never an MP. This walks every string a finding can put on screen.
  const { findings } = reconcile(
    makeInspection({ latitude: FAR_LAT, longitude: FAR_LON, overall_status: 'WORK_NOT_STARTED' }),
    makeWork(),
    [makePhoto({ exif_latitude: SITE_LAT, exif_longitude: SITE_LON, exif_taken_at: '2026-06-01T10:00:00Z' })],
  );
  assert.ok(findings.length > 0);
  const banned = [' mp ', 'member of parliament', 'constituency', 'agency claimed', 'agency_value'];
  for (const f of findings) {
    const text = ` ${[f.detail, f.record_value, f.record_source, f.observed_value].filter(Boolean).join(' ')} `.toLowerCase();
    for (const word of banned) {
      assert.ok(!text.includes(word), `${f.check_id} mentions "${word.trim()}": ${text}`);
    }
  }
});

test('a deviation always carries a unit, and a unit always has a deviation', () => {
  // The biconditional that keeps metres and days from sharing one nameless column. Checked over
  // a fixture that fires all of I-001, I-002 and I-003 at once.
  const { findings } = reconcile(
    makeInspection({ overall_status: 'DEFECTS_FOUND' }),
    makeWork(),
    [makePhoto({ exif_latitude: FAR_LAT, exif_longitude: FAR_LON, exif_taken_at: '2026-06-01T10:00:00Z' })],
  );
  assert.ok(findings.length >= 3, `expected three checks to fire, got ${findings.map((f) => f.check_id).join(', ')}`);
  for (const f of findings) {
    assert.strictEqual(f.deviation === null, f.deviation_unit === null,
      `${f.check_id}: deviation ${f.deviation} / unit ${f.deviation_unit} disagree`);
  }
});

test('checks_run never contains an id that is not in the published catalogue', () => {
  const { checks_run } = reconcile(
    makeInspection({ overall_status: 'DEFECTS_FOUND' }),
    makeWork(),
    [makePhoto({ exif_latitude: FAR_LAT, exif_longitude: FAR_LON, exif_taken_at: '2026-06-01T10:00:00Z' })],
  );
  assert.ok(checks_run.length > 0);
  for (const id of checks_run) {
    assert.ok(id in CHECK_IDS, `${id} ran but is not published`);
  }
  assert.strictEqual(new Set(checks_run).size, checks_run.length, 'a check must not be recorded twice');
});
