/**
 * Photo AI tests — observation, reconciliation, and the dependency-free EXIF reader, with no
 * credential and no database.
 *
 * `observePhoto` takes its model client as a parameter, `reconcile` is a pure function over a
 * `Work` / observations / GPS, and `readExif` is pure byte-parsing — precisely so this file
 * can exist. A feature whose only test is "it works when the key is set" has no tests, and the
 * key on this box is expected to rotate.
 *
 * The bias of this file mirrors P-04's: **most of it is about not fabricating.** A model that
 * returns "unknown" for a category it could not read, or a parser that writes (0, 0) for a
 * photo with no geotag, would each manufacture a finding about a work that is fine. Those
 * failures are the normal case, not the edge case, and the tests that pin them down are the
 * point.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { ApiError } from '../src/http.ts';
import type { Work } from '../src/types.ts';
import {
  capability,
  coerceObservations,
  countObserved,
  expectedObservations,
  observePhoto,
  photoPrompt,
  CONSTRUCTION_STAGES,
  INTEGRITY_LEVELS,
  PHOTO_MIME_TYPES,
  type PhotoObservations,
  type PhotoReadFn,
} from '../src/services/photo_ai.ts';
import { CHECK_IDS, reconcile } from '../src/services/photo_reconcile.ts';
import { decodePhotoUpload, MAX_PHOTO_BYTES } from '../src/services/photos.ts';
import { readExif } from '../src/services/exif.ts';

/** A photo reader that always returns the given text. */
function stubReader(text: string): PhotoReadFn {
  return async () => ({ text, model: 'stub-model', latency_ms: 1, attempts: 1 });
}

/** A JPEG magic-number payload; nothing that uses this looks at the bytes. */
const STUB_IMG = { data: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' };

/** Every observation null — the model looked and could tell nothing. */
const NO_OBS: PhotoObservations = {
  asset_category: null,
  asset_description: null,
  construction_stage: null,
  integrity_concern: null,
  integrity_note: null,
};

/**
 * The fixture work's recorded coordinate.
 *
 * Deliberately NOT (28.6139, 77.2090). That exact pair is the Delhi centroid the CSV ingest
 * writes when a work's coordinates are absent, and `isDefaultedCoordinate` (util.ts) now treats
 * it as "no coordinate recorded" — V-001 skips rather than measuring a distance to a
 * placeholder and manufacturing a finding. A fixture sitting on the placeholder would therefore
 * silently stop exercising V-001 at all: the check would never run and every assertion below
 * would be testing nothing. This point is a few hundred metres away and is a real coordinate.
 */
const WORK_LAT = 28.62;
const WORK_LON = 77.21;

/** A completed work at a known coordinate (New Delhi), agreeing with itself. */
function makeWork(overrides: Partial<Work> = {}): Work {
  return {
    id: 'w1',
    district_id: 'd1',
    constituency_id: 'c1',
    agency_id: 'a1',
    mp_name: 'Hon. Member of Parliament',
    esakshi_work_id: 'ES-1',
    title: 'Construction of community hall',
    description: '',
    category: 'COMMUNITY_INFRASTRUCTURE' as Work['category'],
    sub_category: null,
    location_name: 'Ward 7',
    latitude: WORK_LAT,
    longitude: WORK_LON,
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

// ─── coerceObservations: the model's object is untrusted input ───────────────

test('coerceObservations turns sentinel strings into nulls', () => {
  // Every one of these would otherwise become a value, and V-002 would then compare "unknown"
  // against the work's real category and report a mismatch — a fabricated finding caused
  // entirely by the platform's own credulity.
  const obs = coerceObservations({
    asset_category: 'unknown',
    asset_description: 'N/A',
    construction_stage: 'cannot tell',
    integrity_concern: '—',
    integrity_note: 'unclear',
  });
  assert.deepStrictEqual(obs, NO_OBS);
});

test('coerceObservations normalises case and separators for enums', () => {
  const obs = coerceObservations({
    asset_category: 'roads bridges',
    construction_stage: 'in-progress',
    integrity_concern: 'possible',
  });
  assert.strictEqual(obs.asset_category, 'ROADS_BRIDGES');
  assert.strictEqual(obs.construction_stage, 'IN_PROGRESS');
  assert.strictEqual(obs.integrity_concern, 'POSSIBLE');
});

test('coerceObservations rejects a category outside the vocabulary', () => {
  // A label the model invented ("HOSPITAL") is not one of WORK_CATEGORIES, so it becomes null
  // rather than a value V-002 would compare — the closed-set discipline P-04 applies to doc kinds.
  const obs = coerceObservations({ asset_category: 'HOSPITAL' });
  assert.strictEqual(obs.asset_category, null);
});

test('coerceObservations folds a NONE concern to null and drops its note', () => {
  // 'NONE' is in the null-sentinel set, so it collapses to null: a model reporting "no
  // concern" and a model that could not assess the image are the same review signal — neither
  // routes a human — so both read as null rather than as two distinct stored states. The note
  // that rode in on the NONE is model chatter and goes with it; rendering it would make the
  // platform look as though it were hedging about a clean image.
  const clean = coerceObservations({ integrity_concern: 'NONE', integrity_note: 'looks fine to me' });
  assert.strictEqual(clean.integrity_concern, null, "'NONE' is a null sentinel, not a stored value");
  assert.strictEqual(clean.integrity_note, null, 'a note with no raised concern is dropped');

  // A real concern is kept, and its note with it.
  const flagged = coerceObservations({
    integrity_concern: 'LIKELY',
    integrity_note: 'the shadows fall in two directions',
  });
  assert.strictEqual(flagged.integrity_concern, 'LIKELY');
  assert.strictEqual(flagged.integrity_note, 'the shadows fall in two directions');
});

test('coerceObservations ignores keys the model invented', () => {
  const obs = coerceObservations({ asset_category: 'HEALTH', verdict: 'FRAUD', is_fake: true });
  assert.strictEqual(obs.asset_category, 'HEALTH');
  assert.ok(!('verdict' in obs), 'the observation set is closed; a model cannot add to it');
  assert.ok(!('is_fake' in obs), 'the platform does not accept a fraud verdict from the model');
});

// ─── The prompt: what the model is and is not told ───────────────────────────

test('the prompt demands null and forbids guessing', () => {
  const p = photoPrompt();
  assert.match(p, /use null/i);
  assert.match(p, /Never guess/i);
});

test('the prompt frames integrity as a review prompt, not a verdict', () => {
  const p = photoPrompt();
  assert.match(p, /NOT a judgement that the image is fake/i);
});

test('the prompt asks for no compliance judgement', () => {
  // The model reports what it sees; whether the work is complete or correctly funded is the
  // reconciler's arithmetic, not the model's opinion.
  const p = photoPrompt();
  assert.match(p, /Do not decide whether the project is complete, compliant/i);
});

test('the prompt never names the portal record', () => {
  // If it did, an ambiguous photo would resolve toward what the record claims, and every
  // check would silently become a check that the model can read agreement into a blurry image.
  const p = photoPrompt();
  for (const forbidden of ['physical_progress', 'works.category', 'the record says', 'is recorded as']) {
    assert.ok(!p.includes(forbidden), `the prompt must not mention "${forbidden}"`);
  }
});

test('the prompt offers every construction stage and integrity level it will accept', () => {
  const p = photoPrompt();
  for (const stage of CONSTRUCTION_STAGES) assert.ok(p.includes(stage), `stage ${stage} must be offered`);
  for (const level of INTEGRITY_LEVELS) assert.ok(p.includes(level), `level ${level} must be offered`);
});

// ─── countObserved / expectedObservations ────────────────────────────────────

test('countObserved counts the four observation dimensions, not the note', () => {
  const full: PhotoObservations = {
    asset_category: 'HEALTH',
    asset_description: 'a single-storey clinic building',
    construction_stage: 'COMPLETED',
    integrity_concern: 'NONE',
    integrity_note: null,
  };
  assert.strictEqual(countObserved(full), 4);
  assert.strictEqual(expectedObservations(), 4);
});

test('countObserved counts a raised concern but not its absence', () => {
  // A stored integrity_concern is only ever a raised concern or null — coerceObservations
  // folds the model's NONE to null upstream. So a raised concern counts toward completeness
  // and null (whether "no concern" or "could not assess") does not.
  assert.strictEqual(countObserved({ ...NO_OBS, integrity_concern: 'POSSIBLE' }), 1);
  assert.strictEqual(countObserved(NO_OBS), 0);
});

test('a fully-read clean photo lands at three of four counted dimensions', () => {
  // A subtle, real property worth pinning down: a clean photo maxes out at 3/4, because its
  // NONE concern folds to null and null is not counted. Completeness counts positive
  // observations about the asset; "nothing concerns me" is not one. This keeps a later change
  // from "correcting" the count into a fabricated fourth observation.
  const clean = coerceObservations({
    asset_category: 'HEALTH',
    asset_description: 'a finished clinic',
    construction_stage: 'COMPLETED',
    integrity_concern: 'NONE',
  });
  assert.strictEqual(clean.integrity_concern, null);
  assert.strictEqual(countObserved(clean), 3);
});

test('an integrity_note never inflates the completeness count', () => {
  // Only the note is set (which cannot happen through coerceObservations, but the counter must
  // not depend on that): still zero counted dimensions.
  assert.strictEqual(countObserved({ ...NO_OBS, integrity_note: 'a note' }), 0);
});

// ─── observePhoto end to end, with a stubbed reader ──────────────────────────

test('observePhoto counts every dimension it read', async () => {
  // Four counted dimensions, all non-null. integrity_concern must be a *raised* concern to
  // count — a NONE reading would fold to null and land at three, which the coercion tests pin.
  const result = await observePhoto(
    STUB_IMG,
    stubReader(
      JSON.stringify({
        asset_category: 'HEALTH',
        asset_description: 'a finished clinic with a tiled roof',
        construction_stage: 'COMPLETED',
        integrity_concern: 'POSSIBLE',
        integrity_note: 'the roofline edge looks unusually sharp',
      }),
    ),
  );
  assert.strictEqual(result.fields_expected, 4);
  assert.strictEqual(result.fields_found, 4);
  assert.strictEqual(result.observations.asset_category, 'HEALTH');
  assert.strictEqual(result.observations.integrity_concern, 'POSSIBLE');
});

test('a photo the model cannot read is an empty reading, not a failure', async () => {
  // Distinct from PHOTO_UNREADABLE. This is "the model looked and could tell nothing" — a real
  // answer about a dark or featureless image — and it records four nulls, not an error.
  const result = await observePhoto(
    STUB_IMG,
    stubReader(JSON.stringify({ asset_category: null, construction_stage: null })),
  );
  assert.strictEqual(result.fields_found, 0);
  assert.deepStrictEqual(result.observations, NO_OBS);
});

test('a reading with no JSON at all is PHOTO_UNREADABLE', async () => {
  await assert.rejects(
    () => observePhoto(STUB_IMG, stubReader('I am unable to view this photograph.')),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.code, 'PHOTO_UNREADABLE');
      assert.strictEqual(err.statusCode, 422);
      return true;
    },
  );
});

// ─── Reconciliation: a null observation never becomes a finding ──────────────

test('an unreadable photo with no geotag produces no findings and no checks', () => {
  // The discipline the whole feature rests on. Zero findings AND zero checks — presenting this
  // as a clean result would be the most misleading thing the feature could do, so the caller
  // reports checks_run alongside.
  const { findings, checks_run } = reconcile(makeWork(), NO_OBS, null);
  assert.deepStrictEqual(findings, []);
  assert.deepStrictEqual(checks_run, []);
});

test('a photo that agrees with the record produces no findings but does run checks', () => {
  // A clean reading: category matches, the site looks finished, no authenticity concern (the
  // model's NONE having folded to null upstream). Several checks run and none fire — reported
  // together, because zero-of-several and zero-of-zero mean opposite things.
  const { findings, checks_run } = reconcile(
    makeWork(),
    { ...NO_OBS, asset_category: 'COMMUNITY_INFRASTRUCTURE', construction_stage: 'COMPLETED' },
    { latitude: WORK_LAT, longitude: WORK_LON },
  );
  assert.deepStrictEqual(findings, []);
  assert.ok(checks_run.length >= 3, `expected several checks, ran ${checks_run.join(', ')}`);
});

// ── V-001 · geotag ──

test('V-001 does not run without a photo geotag', () => {
  const { checks_run } = reconcile(makeWork(), { ...NO_OBS, asset_category: 'COMMUNITY_INFRASTRUCTURE' }, null);
  assert.ok(!checks_run.includes('V-001'), 'no geotag means no distance to measure');
});

test('V-001 does not run when the work has no recorded coordinates', () => {
  const { checks_run } = reconcile(
    makeWork({ latitude: null, longitude: null }),
    NO_OBS,
    { latitude: 28.6139, longitude: 77.209 },
  );
  assert.ok(!checks_run.includes('V-001'));
});

test('V-001 does not run when the work sits on the ingest placeholder coordinate', () => {
  // The regression this guards: the CSV ingest writes (28.6139, 77.2090) — a Delhi centroid —
  // for any work whose coordinates were absent. Without the isDefaultedCoordinate guard, every
  // photograph of every uncaptured work outside Delhi measured hundreds of kilometres from its
  // "recorded" location and fired V-001 as HIGH. That is a data gap being reported as evidence
  // of a wrong photo, at a scale that would drown the real findings.
  //
  // Skipped, not merely silent: an officer must see that the check could not run.
  const { findings, checks_run } = reconcile(
    makeWork({ latitude: 28.6139, longitude: 77.209 }),
    NO_OBS,
    { latitude: 11.0168, longitude: 76.9558 }, // Coimbatore — ~2,000 km from the placeholder
  );
  assert.ok(!checks_run.includes('V-001'), 'the placeholder is not a coordinate to compare against');
  assert.strictEqual(findings.find((f) => f.check_id === 'V-001'), undefined);
});

test('V-001 stays silent when the photo is at the work', () => {
  const { findings, checks_run } = reconcile(
    makeWork({ latitude: WORK_LAT, longitude: WORK_LON }),
    NO_OBS,
    { latitude: WORK_LAT, longitude: WORK_LON },
  );
  assert.ok(checks_run.includes('V-001'), 'the check runs');
  assert.strictEqual(findings.find((f) => f.check_id === 'V-001'), undefined, 'zero metres is agreement');
});

test('V-001 is MEDIUM for a few kilometres and records the distance in metres', () => {
  // ~4 km north of the recorded point: past the 1 km site-extent tolerance, well within the
  // 50 km "cannot be site extent" threshold.
  const { findings } = reconcile(
    makeWork({ latitude: WORK_LAT, longitude: WORK_LON }),
    NO_OBS,
    { latitude: 28.65, longitude: 77.209 },
  );
  const v001 = findings.find((f) => f.check_id === 'V-001');
  assert.ok(v001, 'a multi-kilometre gap should fire');
  assert.strictEqual(v001.severity, 'MEDIUM');
  assert.ok(v001.deviation !== null && v001.deviation > 1_000 && v001.deviation < 50_000,
    `deviation ${v001.deviation} m should be a few km`);
});

test('V-001 is HIGH beyond the site-extent threshold', () => {
  // ~150 km away — a single work does not span this, so it is likely the wrong/reused photo or
  // an uncaptured coordinate. HIGH, but never CRITICAL: the placeholder-coordinate case is a
  // data gap, not misconduct, and the two are indistinguishable from here.
  const { findings } = reconcile(
    makeWork({ latitude: WORK_LAT, longitude: WORK_LON }),
    NO_OBS,
    { latitude: 30.0, longitude: 77.209 },
  );
  const v001 = findings.find((f) => f.check_id === 'V-001');
  assert.ok(v001);
  assert.strictEqual(v001.severity, 'HIGH');
  assert.ok(v001.deviation !== null && v001.deviation > 50_000);
});

// ── V-002 · asset category ──

test('V-002 does not run on a null category', () => {
  const { checks_run } = reconcile(makeWork(), NO_OBS, null);
  assert.ok(!checks_run.includes('V-002'));
});

test('V-002 stays silent when the photo matches the recorded category', () => {
  const { findings, checks_run } = reconcile(
    makeWork({ category: 'COMMUNITY_INFRASTRUCTURE' as Work['category'] }),
    { ...NO_OBS, asset_category: 'COMMUNITY_INFRASTRUCTURE' },
    null,
  );
  assert.ok(checks_run.includes('V-002'));
  assert.strictEqual(findings.find((f) => f.check_id === 'V-002'), undefined);
});

test('V-002 fires at MEDIUM on a category mismatch, showing both sides', () => {
  const { findings } = reconcile(
    makeWork({ category: 'COMMUNITY_INFRASTRUCTURE' as Work['category'] }),
    { ...NO_OBS, asset_category: 'ROADS_BRIDGES' },
    null,
  );
  const v002 = findings.find((f) => f.check_id === 'V-002');
  assert.ok(v002);
  assert.strictEqual(v002.severity, 'MEDIUM', 'categories can legitimately overlap, so this is a prompt');
  assert.strictEqual(v002.observed_value, 'ROADS_BRIDGES');
  assert.strictEqual(v002.portal_value, 'COMMUNITY_INFRASTRUCTURE');
  assert.strictEqual(v002.deviation, null, 'a category mismatch has no magnitude');
});

// ── V-003 · construction stage vs a completion claim ──

test('V-003 does not run on a null stage', () => {
  const { checks_run } = reconcile(makeWork(), NO_OBS, null);
  assert.ok(!checks_run.includes('V-003'));
});

test('V-003 is HIGH when a completed work is photographed barely started', () => {
  const { findings } = reconcile(
    makeWork({ status: 'COMPLETED' as Work['status'], physical_progress_pct: 100 }),
    { ...NO_OBS, construction_stage: 'NOT_STARTED' },
    null,
  );
  const v003 = findings.find((f) => f.check_id === 'V-003');
  assert.ok(v003, 'a complete work that looks unbuilt is the money-leak signal');
  assert.strictEqual(v003.severity, 'HIGH');
});

test('V-003 is MEDIUM when a completed work merely looks in progress', () => {
  const { findings } = reconcile(
    makeWork({ status: 'COMPLETED' as Work['status'], physical_progress_pct: 100 }),
    { ...NO_OBS, construction_stage: 'IN_PROGRESS' },
    null,
  );
  assert.strictEqual(findings.find((f) => f.check_id === 'V-003')?.severity, 'MEDIUM');
});

test('V-003 fires on a 100% progress claim even when status is not COMPLETED', () => {
  // Completion is what payment is released against, and physical_progress_pct >= 100 is a
  // completion claim regardless of the status label.
  const { findings } = reconcile(
    makeWork({ status: 'IN_PROGRESS' as Work['status'], physical_progress_pct: 100 }),
    { ...NO_OBS, construction_stage: 'FOUNDATION' },
    null,
  );
  const v003 = findings.find((f) => f.check_id === 'V-003');
  assert.ok(v003);
  assert.strictEqual(v003.severity, 'HIGH');
  // The finding must carry BOTH sides of the comparison it made: the stage the model observed
  // and the completion claim it contradicts. A dossier reader sees "FOUNDATION" against a
  // "100% complete" record — the portal_value is the progress figure, not the COMPLETED label,
  // precisely because the status here is IN_PROGRESS.
  assert.strictEqual(v003.observed_value, 'FOUNDATION');
  assert.strictEqual(v003.portal_value, '100% complete');
});

test('V-003 is asymmetric — an incomplete work that looks finished is not a finding', () => {
  // The reverse of the money-leak direction is a benign reporting lag, deliberately not checked.
  const { findings, checks_run } = reconcile(
    makeWork({ status: 'IN_PROGRESS' as Work['status'], physical_progress_pct: 40 }),
    { ...NO_OBS, construction_stage: 'COMPLETED' },
    null,
  );
  assert.ok(!checks_run.includes('V-003'), 'no completion claim, so the check does not run');
  assert.strictEqual(findings.find((f) => f.check_id === 'V-003'), undefined);
});

// ── V-004 · authenticity concern ──

test('V-004 does not run on a null concern', () => {
  const { checks_run } = reconcile(makeWork(), NO_OBS, null);
  assert.ok(!checks_run.includes('V-004'));
});

test('V-004 raises no finding even if a literal NONE concern reaches it', () => {
  // Defence in depth. In the live pipeline coerceObservations has already folded NONE to null,
  // so reconcile never actually sees this input — but if a future change let it through,
  // reconcile must still not manufacture an authenticity finding out of "no concern". The
  // null-discipline then holds in two layers, not one.
  const { findings } = reconcile(makeWork(), { ...NO_OBS, integrity_concern: 'NONE' }, null);
  assert.strictEqual(findings.find((f) => f.check_id === 'V-004'), undefined);
});

test('V-004 is LOW for POSSIBLE and MEDIUM for LIKELY, never higher', () => {
  const possible = reconcile(makeWork(), { ...NO_OBS, integrity_concern: 'POSSIBLE' }, null);
  const likely = reconcile(makeWork(), { ...NO_OBS, integrity_concern: 'LIKELY' }, null);
  assert.strictEqual(possible.findings.find((f) => f.check_id === 'V-004')?.severity, 'LOW');
  const v004 = likely.findings.find((f) => f.check_id === 'V-004');
  assert.strictEqual(v004?.severity, 'MEDIUM', 'a model concern prompts a look, it does not indict');
  assert.strictEqual(v004?.portal_value, null, 'nothing on the record to compare an image concern against');
});

test('V-004 carries the note into its detail when one was observed', () => {
  const { findings } = reconcile(
    makeWork(),
    { ...NO_OBS, integrity_concern: 'LIKELY', integrity_note: 'a screen was photographed, not a scene' },
    null,
  );
  const v004 = findings.find((f) => f.check_id === 'V-004');
  assert.ok(v004);
  assert.match(v004.detail, /screen was photographed/);
});

// ── the finding set as a whole ──

test('findings come back most severe first', () => {
  const { findings } = reconcile(
    makeWork({ latitude: WORK_LAT, longitude: WORK_LON, status: 'COMPLETED' as Work['status'], physical_progress_pct: 100 }),
    {
      ...NO_OBS,
      asset_category: 'ROADS_BRIDGES', // V-002 MEDIUM
      construction_stage: 'NOT_STARTED', // V-003 HIGH
      integrity_concern: 'POSSIBLE', // V-004 LOW
    },
    { latitude: 30.0, longitude: 77.209 }, // V-001 HIGH
  );
  const ranks = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const seen = findings.map((f) => ranks[f.severity]);
  assert.ok(seen.length >= 4, `expected all four checks to fire, got ${findings.map((f) => f.check_id).join(', ')}`);
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), seen, 'not sorted by severity');
});

test('every finding names a published check', () => {
  const { findings } = reconcile(
    makeWork({ latitude: WORK_LAT, longitude: WORK_LON }),
    { ...NO_OBS, asset_category: 'ROADS_BRIDGES', construction_stage: 'NOT_STARTED', integrity_concern: 'LIKELY' },
    { latitude: 30.0, longitude: 77.209 },
  );
  assert.ok(findings.length > 0, 'this fixture should produce findings');
  for (const f of findings) {
    assert.ok(f.check_id in CHECK_IDS, `${f.check_id} is not in the published catalogue`);
  }
});

// ─── The catalogue itself ────────────────────────────────────────────────────

test('every check id is V-prefixed, not R- or D-prefixed', () => {
  // Load-bearing. An R- or D-prefixed id here would put an uncalibrated photo finding into a
  // namespace where it might be scored against answer_key or mixed with document findings.
  for (const id of Object.keys(CHECK_IDS)) {
    assert.match(id, /^V-\d{3}$/, `${id} must be V-prefixed`);
  }
});

test('every check has a real description', () => {
  for (const [id, description] of Object.entries(CHECK_IDS)) {
    assert.ok(description.trim().length > 10, `${id} needs a real description`);
  }
});

// ─── decodePhotoUpload: the upload validation boundary ───────────────────────

test('decodePhotoUpload returns the decoded bytes for a supported type', () => {
  const bytes = decodePhotoUpload(Buffer.from([0xff, 0xd8, 0xff]).toString('base64'), 'image/jpeg');
  assert.deepStrictEqual([...bytes], [0xff, 0xd8, 0xff]);
});

test('decodePhotoUpload strips a data-URL prefix', () => {
  const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const bytes = decodePhotoUpload(`data:image/png;base64,${raw}`, 'image/png');
  assert.deepStrictEqual([...bytes], [0x89, 0x50, 0x4e, 0x47]);
});

test('decodePhotoUpload refuses a PDF — a document is not a site photo', () => {
  // The one meaningful difference from the document upload gate: P-04 accepts PDFs, this must
  // not, or a certificate would sit in the photo table unanalysable.
  assert.throws(
    () => decodePhotoUpload('JVBERi0=', 'application/pdf'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, 'UNSUPPORTED_TYPE');
      return true;
    },
  );
});

test('decodePhotoUpload refuses an empty payload', () => {
  assert.throws(
    () => decodePhotoUpload('', 'image/jpeg'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.code, 'EMPTY_FILE');
      return true;
    },
  );
});

test('decodePhotoUpload refuses a payload above the size limit but admits one exactly at it', () => {
  // The limit is a strict `>`, so exactly MAX_PHOTO_BYTES is allowed and one byte more is not.
  const atLimit = Buffer.alloc(MAX_PHOTO_BYTES).toString('base64');
  assert.strictEqual(decodePhotoUpload(atLimit, 'image/jpeg').byteLength, MAX_PHOTO_BYTES);

  const tooBig = Buffer.alloc(MAX_PHOTO_BYTES + 1).toString('base64');
  assert.throws(
    () => decodePhotoUpload(tooBig, 'image/jpeg'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 413);
      assert.strictEqual(err.code, 'FILE_TOO_LARGE');
      return true;
    },
  );
});

test('every accepted photo type is an image, never a PDF', () => {
  for (const mime of PHOTO_MIME_TYPES) {
    assert.match(mime, /^image\//, `${mime} must be an image type`);
  }
  assert.ok(!(PHOTO_MIME_TYPES as readonly string[]).includes('application/pdf'));
});

// ─── /status limits: the upload ceiling never exceeds the read ceiling ───────

test('/status advertises an upload ceiling no larger than the model accepts', () => {
  // Assembled exactly as routers/photos.ts serves it. MAX_PHOTO_BYTES (store ceiling) and
  // capability().max_bytes (the model's inline-read ceiling) are independent constants; an
  // upload accepted above the read ceiling would be stored and then be unanalysable.
  const status = { ...capability(), max_upload_bytes: MAX_PHOTO_BYTES };
  assert.ok(
    status.max_upload_bytes <= status.max_bytes,
    `max_upload_bytes (${status.max_upload_bytes}) must be <= max_bytes (${status.max_bytes})`,
  );
});

// ─── EXIF: the dependency-free GPS/timestamp reader ──────────────────────────
//
// The parser is hand-written byte-walking over a security-sensitive format, so it is fed
// hand-built fixtures: real TIFF/JPEG structures assembled below, plus deliberately broken
// input. The contract it must never break is that a malformed file yields nulls rather than a
// throw, and that a missing geotag is null rather than (0, 0).

/** Write a 12-byte IFD entry (tag, type, count, value/offset) in the given byte order. */
function writeEntry(dv: DataView, off: number, tag: number, type: number, count: number, value: number, le: boolean): void {
  dv.setUint16(off, tag, le);
  dv.setUint16(off + 2, type, le);
  dv.setUint32(off + 4, count, le);
  dv.setUint32(off + 8, value, le);
}

/** Write an array of RATIONALs (numerator, denominator LONG pairs) at an offset. */
function writeRationals(dv: DataView, off: number, rationals: number[][], le: boolean): void {
  for (let i = 0; i < rationals.length; i++) {
    dv.setUint32(off + i * 8, rationals[i][0], le);
    dv.setUint32(off + i * 8 + 4, rationals[i][1], le);
  }
}

/**
 * Build a bare TIFF/EXIF blob carrying a GPS IFD. Defaults encode 28°36'50"N 77°12'32"E
 * (≈ 28.6139, 77.2089 — New Delhi). Pass `lon: null` to write a latitude with no longitude;
 * pass `le: false` for a big-endian ("MM") blob.
 */
function buildGpsTiff(opts: {
  le?: boolean;
  latRef?: string;
  lonRef?: string;
  lat?: number[][];
  lon?: number[][] | null;
} = {}): Uint8Array {
  const le = opts.le ?? true;
  const latRef = opts.latRef ?? 'N';
  const lonRef = opts.lonRef ?? 'E';
  const lat = opts.lat ?? [[28, 1], [36, 1], [50, 1]];
  const lon = opts.lon === null ? null : (opts.lon ?? [[77, 1], [12, 1], [32, 1]]);
  const hasLon = lon !== null;
  const nGps = hasLon ? 4 : 2;

  const gpsIfdOff = 26; // after the 8-byte header and an 18-byte single-entry IFD0
  const dataOff = gpsIfdOff + 2 + nGps * 12 + 4;
  const latDataOff = dataOff;
  const lonDataOff = dataOff + 24;
  const total = dataOff + 24 + (hasLon ? 24 : 0);

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8[0] = le ? 0x49 : 0x4d;
  u8[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, 0x2a, le);
  dv.setUint32(4, 8, le); // IFD0 at offset 8

  // IFD0: one entry, the GPS-IFD pointer.
  dv.setUint16(8, 1, le);
  writeEntry(dv, 10, 0x8825, 4, 1, gpsIfdOff, le);
  dv.setUint32(22, 0, le); // no next IFD

  // GPS IFD.
  dv.setUint16(gpsIfdOff, nGps, le);
  let e = gpsIfdOff + 2;
  writeEntry(dv, e, 0x0001, 2, 2, 0, le); // GPSLatitudeRef, ASCII inline
  u8[e + 8] = latRef.charCodeAt(0);
  e += 12;
  writeEntry(dv, e, 0x0002, 5, 3, latDataOff, le); // GPSLatitude
  e += 12;
  if (hasLon) {
    writeEntry(dv, e, 0x0003, 2, 2, 0, le); // GPSLongitudeRef, ASCII inline
    u8[e + 8] = lonRef.charCodeAt(0);
    e += 12;
    writeEntry(dv, e, 0x0004, 5, 3, lonDataOff, le); // GPSLongitude
    e += 12;
  }
  dv.setUint32(e, 0, le); // no next IFD

  writeRationals(dv, latDataOff, lat, le);
  if (hasLon && lon) writeRationals(dv, lonDataOff, lon, le);

  return u8;
}

/** Wrap a TIFF blob in the JPEG APP1/"Exif\0\0" envelope the reader locates in a real photo. */
function buildJpeg(tiff: Uint8Array): Uint8Array {
  const segLen = 2 + 6 + tiff.length; // length field + "Exif\0\0" + TIFF
  const out = new Uint8Array(2 + 2 + 2 + 6 + tiff.length + 2);
  let p = 0;
  out[p++] = 0xff; out[p++] = 0xd8; // SOI
  out[p++] = 0xff; out[p++] = 0xe1; // APP1
  out[p++] = (segLen >> 8) & 0xff; out[p++] = segLen & 0xff; // length, big-endian
  for (const b of [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]) out[p++] = b; // "Exif\0\0"
  out.set(tiff, p);
  p += tiff.length;
  out[p++] = 0xff; out[p++] = 0xd9; // EOI
  return out;
}

/** Build a bare TIFF carrying an IFD0 DateTime tag (the fallback the reader reads capture time from). */
function buildDateTiff(le: boolean, value: string): Uint8Array {
  const strLen = value.length + 1; // + NUL terminator
  const strOff = 26;
  const total = strOff + strLen;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8[0] = le ? 0x49 : 0x4d;
  u8[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, 0x2a, le);
  dv.setUint32(4, 8, le);
  dv.setUint16(8, 1, le);
  writeEntry(dv, 10, 0x0132, 2, strLen, strOff, le); // DateTime, ASCII at an offset
  dv.setUint32(22, 0, le);
  for (let i = 0; i < value.length; i++) u8[strOff + i] = value.charCodeAt(i);
  u8[strOff + value.length] = 0;
  return u8;
}

/**
 * Wrap a TIFF in a JPEG that carries a JFIF APP0 segment BEFORE the EXIF APP1 — the layout real
 * phones and cameras overwhelmingly emit. Exercises the segment-skip advance in
 * locateTiffInJpeg, which buildJpeg (EXIF as the first segment) never reaches.
 */
function buildJpegWithApp0(tiff: Uint8Array): Uint8Array {
  const app0Payload = new Uint8Array([
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01,                   // version 1.1
    0x00,                         // density units
    0x00, 0x48, 0x00, 0x48,       // X/Y density
    0x00, 0x00,                   // no embedded thumbnail
  ]);
  const app0Len = 2 + app0Payload.length; // length field counts itself
  const app1Len = 2 + 6 + tiff.length;    // length + "Exif\0\0" + TIFF
  const out = new Uint8Array(2 + (2 + app0Len) + (2 + app1Len) + 2);
  let p = 0;
  out[p++] = 0xff; out[p++] = 0xd8;                              // SOI
  out[p++] = 0xff; out[p++] = 0xe0;                              // APP0
  out[p++] = (app0Len >> 8) & 0xff; out[p++] = app0Len & 0xff;   // length, big-endian
  out.set(app0Payload, p); p += app0Payload.length;
  out[p++] = 0xff; out[p++] = 0xe1;                              // APP1
  out[p++] = (app1Len >> 8) & 0xff; out[p++] = app1Len & 0xff;   // length, big-endian
  for (const b of [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]) out[p++] = b; // "Exif\0\0"
  out.set(tiff, p); p += tiff.length;
  out[p++] = 0xff; out[p++] = 0xd9;                              // EOI
  return out;
}

/**
 * Wrap a TIFF in a minimal PNG carrying an `eXIf` chunk, preceded by an IHDR chunk so the chunk
 * walker must step over a chunk (data + CRC) before finding EXIF. CRCs are zeroed — the reader
 * skips the CRC field without validating it.
 */
function buildPng(tiff: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunks: { type: string; data: Uint8Array }[] = [
    { type: 'IHDR', data: new Uint8Array(13) }, // contents irrelevant to the EXIF reader
    { type: 'eXIf', data: tiff },
    { type: 'IEND', data: new Uint8Array(0) },
  ];
  let total = sig.length;
  for (const c of chunks) total += 4 + 4 + c.data.length + 4; // length + type + data + CRC
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const b of sig) out[p++] = b;
  for (const c of chunks) {
    dv.setUint32(p, c.data.length, false); p += 4; // chunk length, big-endian
    for (let i = 0; i < 4; i++) out[p++] = c.type.charCodeAt(i);
    out.set(c.data, p); p += c.data.length;
    dv.setUint32(p, 0, false); p += 4; // CRC — zeroed, not validated
  }
  return out;
}

/**
 * Wrap a TIFF in a minimal WebP carrying an `EXIF` chunk, preceded by an odd-length dummy chunk
 * so the walker exercises both the little-endian chunk-size read and the even-length padding
 * advance (`dataEnd + len % 2`).
 */
function buildWebp(tiff: Uint8Array): Uint8Array {
  const dummy = { fourcc: 'XMP ', data: new Uint8Array([1, 2, 3]) }; // odd length → 1-byte pad
  const exif = { fourcc: 'EXIF', data: tiff };
  const sizeOnWire = (d: Uint8Array) => 8 + d.length + (d.length % 2);
  const total = 12 + sizeOnWire(dummy.data) + sizeOnWire(exif.data);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const ch of 'RIFF') out[p++] = ch.charCodeAt(0);
  dv.setUint32(p, total - 8, true); p += 4; // RIFF payload size, little-endian
  for (const ch of 'WEBP') out[p++] = ch.charCodeAt(0);
  for (const c of [dummy, exif]) {
    for (let i = 0; i < 4; i++) out[p++] = c.fourcc.charCodeAt(i);
    dv.setUint32(p, c.data.length, true); p += 4; // chunk size, little-endian
    out.set(c.data, p); p += c.data.length;
    if (c.data.length % 2 === 1) out[p++] = 0; // pad to even
  }
  return out;
}

/**
 * Build a bare TIFF whose IFD0 carries BOTH an IFD0 DateTime (0x0132, the fallback) and an EXIF
 * sub-IFD pointer (0x8769) leading to a DateTimeOriginal (0x9003, the PREFERRED capture-time
 * source). The two values differ, so a passing test proves DateTimeOriginal wins and covers the
 * sub-IFD pointer arithmetic no other fixture reaches.
 */
function buildOriginalDateTiff(le: boolean, original: string, fallback: string): Uint8Array {
  const origLen = original.length + 1; // + NUL terminator
  const fbLen = fallback.length + 1;
  const subIfdOff = 38;             // after IFD0 (8..37: count + 2 entries + next-IFD pointer)
  const fbStrOff = 56;              // after the sub-IFD (38..55: count + 1 entry + next-IFD)
  const origStrOff = fbStrOff + fbLen;
  const total = origStrOff + origLen;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8[0] = le ? 0x49 : 0x4d;
  u8[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, 0x2a, le);
  dv.setUint32(4, 8, le); // IFD0 at offset 8

  // IFD0: DateTime (fallback) + EXIF sub-IFD pointer.
  dv.setUint16(8, 2, le);
  writeEntry(dv, 10, 0x0132, 2, fbLen, fbStrOff, le);  // IFD0 DateTime, ASCII at an offset
  writeEntry(dv, 22, 0x8769, 4, 1, subIfdOff, le);     // EXIF sub-IFD pointer (LONG, inline)
  dv.setUint32(34, 0, le); // no next IFD

  // EXIF sub-IFD: DateTimeOriginal.
  dv.setUint16(subIfdOff, 1, le);
  writeEntry(dv, subIfdOff + 2, 0x9003, 2, origLen, origStrOff, le);
  dv.setUint32(subIfdOff + 2 + 12, 0, le); // no next IFD

  for (let i = 0; i < fallback.length; i++) u8[fbStrOff + i] = fallback.charCodeAt(i);
  u8[fbStrOff + fallback.length] = 0;
  for (let i = 0; i < original.length; i++) u8[origStrOff + i] = original.charCodeAt(i);
  u8[origStrOff + original.length] = 0;

  return u8;
}

test('readExif reads GPS from a little-endian TIFF', () => {
  const exif = readExif(buildGpsTiff({ le: true }));
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 28.6139) < 1e-4, `lat ${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 77.2089) < 1e-3, `lon ${exif.longitude}`);
});

test('readExif reads GPS from a big-endian (MM) TIFF', () => {
  const exif = readExif(buildGpsTiff({ le: false }));
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 28.6139) < 1e-4, `lat ${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 77.2089) < 1e-3, `lon ${exif.longitude}`);
});

test('readExif reads GPS wrapped in a JPEG APP1 segment', () => {
  const exif = readExif(buildJpeg(buildGpsTiff({ le: true })));
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 28.6139) < 1e-4, `lat ${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 77.2089) < 1e-3, `lon ${exif.longitude}`);
});

test('readExif applies the southern and western hemisphere signs', () => {
  const exif = readExif(buildGpsTiff({ latRef: 'S', lonRef: 'W', lat: [[10, 1], [0, 1], [0, 1]], lon: [[20, 1], [0, 1], [0, 1]] }));
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - -10) < 1e-6, `lat ${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - -20) < 1e-6, `lon ${exif.longitude}`);
});

test('readExif returns nulls for a photo with the location stripped — never (0, 0)', () => {
  // The (0, 0) trap. A JPEG with no EXIF must read as "no geotag", not as a point in the Gulf
  // of Guinea. This is the single most important EXIF assertion in the file.
  const noExifJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // SOI, EOI, nothing between
  const exif = readExif(noExifJpeg);
  assert.strictEqual(exif.latitude, null);
  assert.strictEqual(exif.longitude, null);
});

test('readExif rejects a lone latitude — a coordinate is a pair or it is nothing', () => {
  const exif = readExif(buildGpsTiff({ lon: null }));
  assert.strictEqual(exif.latitude, null, 'a latitude with no longitude is not a location');
  assert.strictEqual(exif.longitude, null);
});

test('readExif rejects an out-of-range coordinate', () => {
  // A corrupt degrees value (200°) must read as "not read", not as an impossible point.
  const exif = readExif(buildGpsTiff({ lat: [[200, 1], [0, 1], [0, 1]] }));
  assert.strictEqual(exif.latitude, null);
  assert.strictEqual(exif.longitude, null);
});

test('readExif reads a capture time and normalises it to ISO shape', () => {
  const exif = readExif(buildDateTiff(true, '2025:11:20 09:30:00'));
  assert.strictEqual(exif.takenAt, '2025-11-20T09:30:00');
});

test('readExif treats the all-zero placeholder date as absent', () => {
  const exif = readExif(buildDateTiff(true, '0000:00:00 00:00:00'));
  assert.strictEqual(exif.takenAt, null);
});

test('readExif never throws on malformed input', () => {
  // The contract that keeps a broken header from crashing an upload. Empty, garbage, a
  // truncated JPEG, and a truncated TIFF all degrade to nulls.
  for (const input of [
    new Uint8Array(0),
    new Uint8Array([1, 2, 3, 4, 5]),
    buildJpeg(buildGpsTiff()).subarray(0, 20), // APP1 length points past the truncated end
    buildGpsTiff().subarray(0, 30), // TIFF cut off mid-IFD
  ]) {
    const exif = readExif(input);
    assert.deepStrictEqual(exif, { latitude: null, longitude: null, takenAt: null });
  }
});

test('readExif reads GPS from a JPEG carrying a JFIF APP0 before the EXIF APP1', () => {
  // The real-camera layout: APP0 (JFIF) precedes APP1 (EXIF). buildJpeg puts EXIF first, so the
  // segment-skip advance in locateTiffInJpeg only runs here.
  const exif = readExif(buildJpegWithApp0(buildGpsTiff({ le: true })));
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 28.6139) < 1e-4, `lat ${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 77.2089) < 1e-3, `lon ${exif.longitude}`);
});

test('readExif reads GPS from a PNG eXIf chunk', () => {
  // PNG is a listed container; its walker (skip IHDR, read eXIf) had no coverage.
  const exif = readExif(buildPng(buildGpsTiff({ le: true })));
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 28.6139) < 1e-4, `lat ${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 77.2089) < 1e-3, `lon ${exif.longitude}`);
});

test('readExif reads GPS from a WebP EXIF chunk, skipping an odd-length chunk before it', () => {
  // WebP is a listed container; the odd-length lead chunk also exercises the even-padding advance.
  const exif = readExif(buildWebp(buildGpsTiff({ le: true })));
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 28.6139) < 1e-4, `lat ${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 77.2089) < 1e-3, `lon ${exif.longitude}`);
});

test('readExif prefers DateTimeOriginal in the EXIF sub-IFD over the IFD0 DateTime fallback', () => {
  // Real cameras write capture time as DateTimeOriginal inside the EXIF sub-IFD; IFD0 DateTime is
  // the lesser fallback. The two differ here, so this pins the precedence and covers the sub-IFD
  // pointer arithmetic (0x8769 → 0x9003) that no other fixture reaches.
  const exif = readExif(buildOriginalDateTiff(true, '2025:11:20 09:30:00', '2019:01:01 00:00:00'));
  assert.strictEqual(exif.takenAt, '2025-11-20T09:30:00');
});

test('readExif reads DateTimeOriginal from a big-endian (MM) sub-IFD', () => {
  const exif = readExif(buildOriginalDateTiff(false, '2025:11:20 09:30:00', '2019:01:01 00:00:00'));
  assert.strictEqual(exif.takenAt, '2025-11-20T09:30:00');
});

test('readExif rejects an impossible latitude in the (90, 180] band — never fabricates a point', () => {
  // The 200° case above exceeds BOTH the 90° latitude and 180° longitude limits. 100° exceeds
  // ONLY the latitude limit, so it is the case that pins latitude's tighter bound; the longitude
  // is in range, yet the pair is still rejected because a lone valid coordinate is not a location.
  const exif = readExif(buildGpsTiff({ lat: [[100, 1], [0, 1], [0, 1]] }));
  assert.strictEqual(exif.latitude, null);
  assert.strictEqual(exif.longitude, null);
});

test('readExif rejects impossible calendar dates rather than rolling them forward', () => {
  // Per-field ranges alone pass Feb 30 / Apr 31 / a non-leap Feb 29, and new Date() would silently
  // roll them into the next month. The reader must return null, never a fabricated capture time.
  for (const bad of ['2025:02:30 12:00:00', '2025:04:31 09:15:00', '2025:02:29 00:00:00']) {
    assert.strictEqual(readExif(buildDateTiff(true, bad)).takenAt, null, `should reject ${bad}`);
  }
  // A real leap day still reads.
  assert.strictEqual(readExif(buildDateTiff(true, '2024:02:29 06:00:00')).takenAt, '2024-02-29T06:00:00');
});
