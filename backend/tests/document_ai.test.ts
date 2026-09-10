/**
 * Document AI tests — extraction and reconciliation, with no credential and no database.
 *
 * `extractFields` takes its model client as a parameter and `reconcile` is a pure function
 * over a `Work` and a field set, precisely so this file can exist. A feature whose only test
 * is "it works when the key is set" has no tests, and the key on this box is expected to
 * rotate.
 *
 * The bias of this file: **most of it is about not fabricating.** A model that returns "N/A"
 * for a sanction reference, `0` for an amount it could not read, or `03/08/2026` for a date
 * that might be March or August is the normal case, not the edge case, and each of those
 * failures would produce a finding about a work that is fine. Those tests are the point.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { ApiError } from '../src/http.ts';
import type { Work } from '../src/types.ts';
import {
  capability,
  coerceFields,
  countFound,
  documentPrompt,
  expectedCount,
  extractFields,
  extractJson,
  parseAmount,
  parseDate,
  resolveKind,
  type DocumentReadFn,
  type ExtractedFields,
} from '../src/services/document_ai.ts';
import {
  CHECK_IDS,
  reconcile,
  reconcileWithAgency,
} from '../src/services/document_reconcile.ts';
import { decodeUpload, MAX_UPLOAD_BYTES } from '../src/services/documents.ts';

/** A document reader that always returns the given text. */
function stubReader(text: string): DocumentReadFn {
  return async () => ({ text, model: 'stub-model', latency_ms: 1, attempts: 1 });
}

/** A one-pixel payload; nothing in these tests looks at the bytes. */
const STUB_DOC = { data: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' };

/** Every field null — the starting point for building a single-field fixture. */
const NO_FIELDS: ExtractedFields = {
  certified_amount: null,
  certificate_date: null,
  sanction_reference: null,
  work_reference: null,
  agency_named: null,
  signatory_name: null,
  signatory_designation: null,
  period_from: null,
  period_to: null,
};

/** A work that agrees with itself: ₹10 L sanctioned, released and spent, completed. */
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
    latitude: null,
    longitude: null,
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

// ─── extractJson: recover the object from however the model wrapped it ───────

test('extractJson reads a bare object', () => {
  assert.deepStrictEqual(extractJson('{"a":1}'), { a: 1 });
});

test('extractJson unwraps a ```json fence', () => {
  assert.deepStrictEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('extractJson drops prose before and after the object', () => {
  assert.deepStrictEqual(
    extractJson('Here is what I read:\n{"a":1}\nHope that helps.'),
    { a: 1 },
  );
});

test('extractJson returns null when there is no object', () => {
  // Reported as DOCUMENT_UNREADABLE by the caller, never as an empty extraction. An empty
  // extraction reads as "this certificate states nothing", a claim about the document rather
  // than about the reading.
  assert.strictEqual(extractJson('I cannot read this image.'), null);
});

test('extractJson refuses a bare array', () => {
  assert.strictEqual(extractJson('[1,2,3]'), null);
});

// ─── parseAmount: the null-versus-zero discipline ────────────────────────────

test('parseAmount reads Indian digit grouping', () => {
  assert.strictEqual(parseAmount('8,20,000', 'rupees'), 820_000);
});

test('parseAmount strips a currency mark', () => {
  assert.strictEqual(parseAmount('₹8,20,000', 'rupees'), 820_000);
  assert.strictEqual(parseAmount('Rs. 820000', 'rupees'), 820_000);
});

test('parseAmount applies the lakh multiplier', () => {
  assert.strictEqual(parseAmount('8.20', 'lakh'), 820_000);
});

test('parseAmount applies the crore multiplier', () => {
  assert.strictEqual(parseAmount('1.5', 'crore'), 15_000_000);
});

test('parseAmount defaults to rupees when no unit is given', () => {
  assert.strictEqual(parseAmount('820000', undefined), 820_000);
});

test('parseAmount returns null for zero, not 0', () => {
  // The most important assertion in this file. A 0 here is read downstream as "the
  // certificate certifies nil expenditure" — a severe finding — while null means nobody
  // knows what it says. A model emitting 0 for an unreadable figure is far more common than
  // a genuine nil certificate, and the two are indistinguishable at this layer.
  assert.strictEqual(parseAmount(0, 'rupees'), null);
  assert.strictEqual(parseAmount('0', 'rupees'), null);
});

test('parseAmount returns null for every absent-value sentinel', () => {
  for (const sentinel of ['N/A', 'n/a', 'nil', 'not found', 'illegible', '—', '-', '']) {
    assert.strictEqual(
      parseAmount(sentinel, 'rupees'),
      null,
      `'${sentinel}' must not become a number`,
    );
  }
});

test('parseAmount refuses a negative', () => {
  assert.strictEqual(parseAmount('-5000', 'rupees'), null);
});

test('parseAmount refuses a figure larger than the whole scheme', () => {
  // ₹10,000 Cr, above the scheme's published ₹6,680.29 Cr allocation. A finding built on a
  // misread unit would be arithmetically correct and completely wrong.
  assert.strictEqual(parseAmount('999999', 'crore'), null);
});

test('parseAmount admits a figure exactly at the cap but not one over', () => {
  // The cap is a strict `>` at ₹10,000 Cr (= 1e11 rupees). Exactly at the cap is implausibly
  // large but permitted; a rupee more is a misread unit and becomes null, not a finding. This
  // boundary is the only guard between a crore/lakh confusion and an arithmetically-perfect
  // but nonsensical D-002.
  assert.strictEqual(parseAmount('10000', 'crore'), 100_000_000_000);
  assert.strictEqual(parseAmount('10001', 'crore'), null);
});

test('parseAmount refuses text that is not a number', () => {
  assert.strictEqual(parseAmount('eight lakh twenty thousand', 'rupees'), null);
});

// ─── parseDate: day-first, and no expansion of ambiguity ─────────────────────

test('parseDate reads the ISO form the prompt asks for', () => {
  assert.strictEqual(parseDate('2026-03-08'), '2026-03-08');
});

test('parseDate reads DD/MM/YYYY as day-first', () => {
  // 03/08/2026 on an Indian certificate is 3 August. Reading it month-first would move the
  // date five months — exactly the size of error D-003 exists to catch, manufactured by the
  // platform itself.
  assert.strictEqual(parseDate('03/08/2026'), '2026-08-03');
});

test('parseDate reads DD-MM-YYYY and DD.MM.YYYY', () => {
  assert.strictEqual(parseDate('03-08-2026'), '2026-08-03');
  assert.strictEqual(parseDate('3.8.2026'), '2026-08-03');
});

test('parseDate refuses an ambiguous two-digit year', () => {
  // 26 could be 1926 or 2026 and the platform has no basis to choose.
  assert.strictEqual(parseDate('03/08/26'), null);
});

test('parseDate refuses a calendar-invalid date', () => {
  assert.strictEqual(parseDate('2026-02-31'), null);
  assert.strictEqual(parseDate('31/02/2026'), null);
});

test('parseDate refuses a year outside the scheme era', () => {
  assert.strictEqual(parseDate('1899-01-01'), null);
  assert.strictEqual(parseDate('9999-01-01'), null);
});

test('parseDate returns null for the sentinels', () => {
  for (const s of ['N/A', 'not legible', '—', '']) {
    assert.strictEqual(parseDate(s), null, `'${s}' must not become a date`);
  }
});

// ─── coerceFields: the model's object is untrusted input ─────────────────────

test('coerceFields turns sentinel strings into nulls', () => {
  const fields = coerceFields({
    certified_amount: 'N/A',
    certificate_date: 'not printed',
    sanction_reference: 'N/A',
    work_reference: '—',
    agency_named: 'unknown',
    signatory_name: '',
  });
  // Every one of these would otherwise become a value, and D-005 would then report a
  // mismatch between "unknown" and a real agency name — a fabricated finding caused entirely
  // by the platform's own credulity.
  assert.deepStrictEqual(fields, NO_FIELDS);
});

test('coerceFields keeps a real reading', () => {
  const fields = coerceFields({
    certified_amount: '8,20,000',
    amount_unit: 'rupees',
    certificate_date: '2025-12-01',
    sanction_reference: 'DC/MPLADS/2025/117',
    work_reference: 'ES-1',
    agency_named: 'Public Works Department',
    signatory_name: 'Executive Engineer',
    signatory_designation: 'EE, Division II',
    period_from: '2025-01-01',
    period_to: '2025-11-30',
  });
  assert.strictEqual(fields.certified_amount, 820_000);
  assert.strictEqual(fields.certificate_date, '2025-12-01');
  assert.strictEqual(fields.sanction_reference, 'DC/MPLADS/2025/117');
  assert.strictEqual(fields.agency_named, 'Public Works Department');
});

test('coerceFields ignores keys the model invented', () => {
  const fields = coerceFields({ certified_amount: '100', amount_unit: 'rupees', verdict: 'VALID' });
  assert.strictEqual(fields.certified_amount, 100);
  assert.ok(!('verdict' in fields), 'the field set is closed; a model cannot add to it');
});

// ─── The prompt: what the model is and is not told ───────────────────────────

test('the prompt demands null and forbids zero', () => {
  const p = documentPrompt('UTILISATION_CERTIFICATE');
  assert.match(p, /use null/i);
  assert.match(p, /Never use 0/);
});

test('the prompt forbids the model from converting units', () => {
  assert.match(documentPrompt('BILL'), /Do NOT convert units/i);
});

test('the prompt never asks the model for a judgement', () => {
  const p = documentPrompt('UTILISATION_CERTIFICATE');
  assert.match(p, /Do not judge the document/i);
});

test('the prompt never names a portal figure', () => {
  // If it did, an ambiguous scan would resolve toward the number the model was shown, and
  // every reconciliation check would silently become a check that the model can read
  // agreement into a blurry page.
  for (const kind of ['UTILISATION_CERTIFICATE', 'COMPLETION_CERTIFICATE', 'BILL'] as const) {
    const p = documentPrompt(kind);
    for (const forbidden of ['expenditure', 'sanctioned_amount', 'released_amount', 'has_uc']) {
      assert.ok(!p.includes(forbidden), `${kind} prompt must not mention ${forbidden}`);
    }
  }
});

// ─── resolveKind: an unknown type is unknown, never guessed ──────────────────

test('resolveKind normalises case and separators', () => {
  assert.strictEqual(resolveKind('utilisation certificate'), 'UTILISATION_CERTIFICATE');
  assert.strictEqual(resolveKind('UTILISATION-CERTIFICATE'), 'UTILISATION_CERTIFICATE');
});

test('resolveKind accepts the American spelling and common abbreviations', () => {
  assert.strictEqual(resolveKind('utilization_certificate'), 'UTILISATION_CERTIFICATE');
  assert.strictEqual(resolveKind('uc'), 'UTILISATION_CERTIFICATE');
  assert.strictEqual(resolveKind('final_bill'), 'BILL');
});

test('resolveKind returns null rather than defaulting', () => {
  // Defaulting to UTILISATION_CERTIFICATE would run UC checks against a photograph of a
  // site board.
  assert.strictEqual(resolveKind('site photograph'), null);
  assert.strictEqual(resolveKind(''), null);
});

// ─── extractFields end to end, with a stubbed reader ────────────────────────

test('extractFields counts the fields it found', async () => {
  const result = await extractFields(
    'UTILISATION_CERTIFICATE',
    STUB_DOC,
    stubReader(
      JSON.stringify({
        certified_amount: '8,20,000',
        amount_unit: 'rupees',
        certificate_date: '2025-12-01',
        sanction_reference: 'REF/1',
        work_reference: 'ES-1',
        agency_named: 'PWD',
        signatory_name: null,
        transcript: 'Certified that Rs. 8,20,000 has been utilised...',
      }),
    ),
  );
  assert.strictEqual(result.fields_expected, 6);
  assert.strictEqual(result.fields_found, 5, 'signatory_name was null');
  assert.strictEqual(result.raw_transcript?.startsWith('Certified that'), true);
});

test('a blank page is an empty reading, not a failure', async () => {
  // Distinct from DOCUMENT_UNREADABLE. This is "the model read the page and found nothing",
  // which is a real answer about a blank or irrelevant page.
  const result = await extractFields(
    'UTILISATION_CERTIFICATE',
    STUB_DOC,
    stubReader(JSON.stringify({ certified_amount: null, certificate_date: null })),
  );
  assert.strictEqual(result.fields_found, 0);
  assert.deepStrictEqual(result.fields, NO_FIELDS);
});

test('a reading with no JSON at all is DOCUMENT_UNREADABLE', async () => {
  await assert.rejects(
    () => extractFields('BILL', STUB_DOC, stubReader('The image is too blurry to read.')),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.code, 'DOCUMENT_UNREADABLE');
      assert.strictEqual(err.statusCode, 422);
      return true;
    },
  );
});

test('expectedCount and countFound agree on a full reading', () => {
  const full: ExtractedFields = {
    ...NO_FIELDS,
    certified_amount: 1,
    certificate_date: '2026-01-01',
    sanction_reference: 'r',
    work_reference: 'w',
    agency_named: 'a',
    signatory_name: 's',
  };
  assert.strictEqual(
    countFound('UTILISATION_CERTIFICATE', full),
    expectedCount('UTILISATION_CERTIFICATE'),
  );
});

test('countFound counts only the fields the kind expects', () => {
  // A field outside the kind's expected set must not inflate the completeness ratio. This UC
  // has five of its six expected fields plus a period_from — which UCs do not count — so the
  // measure is 5 of 6, not 6 of 6. Were it 6, `fields_found / fields_expected` would report a
  // poorly-scanned certificate as complete because one unrelated field happened to parse.
  const fields: ExtractedFields = {
    ...NO_FIELDS,
    certified_amount: 820_000,
    certificate_date: '2025-12-01',
    sanction_reference: 'REF/1',
    work_reference: 'ES-1',
    agency_named: 'PWD',
    // signatory_name (expected) stays null; period_from is present but not expected for a UC.
    period_from: '2025-01-01',
  };
  assert.strictEqual(countFound('UTILISATION_CERTIFICATE', fields), 5, 'period_from is not counted');
  assert.strictEqual(expectedCount('UTILISATION_CERTIFICATE'), 6);
});

// ─── Reconciliation: a null input never becomes a finding ────────────────────

test('an unreadable document produces no findings and no checks', () => {
  // The discipline the whole feature rests on. An unreadable certificate must not compare
  // null against expenditure and report a total shortfall.
  const { findings, checks_run } = reconcile(makeWork(), 'UTILISATION_CERTIFICATE', NO_FIELDS);
  assert.deepStrictEqual(findings, []);
  assert.deepStrictEqual(checks_run, []);
});

test('an agreeing certificate produces no findings but does run checks', () => {
  // Zero findings out of several checks is a clean document. Zero out of zero is a document
  // nothing could be checked against. The caller reports both because they look identical on
  // a dossier and mean opposite things.
  const { findings, checks_run } = reconcile(makeWork(), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    certified_amount: 1_000_000,
    certificate_date: '2025-12-01',
  });
  assert.deepStrictEqual(findings, []);
  assert.ok(checks_run.length >= 3, `expected several checks, ran ${checks_run.join(', ')}`);
});

test('D-001 fires when the certified amount differs from expenditure', () => {
  const { findings } = reconcile(makeWork({ expenditure: 1_000_000 }), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    certified_amount: 1_300_000,
  });
  const d001 = findings.find((f) => f.check_id === 'D-001');
  assert.ok(d001, 'D-001 should fire on a 30% gap');
  assert.strictEqual(d001.severity, 'HIGH', 'over-certification is the serious direction');
  assert.strictEqual(d001.deviation_pct, 30);
});

test('D-001 is MEDIUM when the portal is higher than the certificate', () => {
  const { findings } = reconcile(makeWork({ expenditure: 1_000_000 }), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    certified_amount: 700_000,
  });
  assert.strictEqual(findings.find((f) => f.check_id === 'D-001')?.severity, 'MEDIUM');
});

test('D-001 tolerates rounding', () => {
  const { findings, checks_run } = reconcile(
    makeWork({ expenditure: 1_000_000 }),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, certified_amount: 1_005_000 },
  );
  assert.ok(checks_run.includes('D-001'), 'the check must run');
  assert.strictEqual(
    findings.find((f) => f.check_id === 'D-001'),
    undefined,
    'a 0.5% difference is the same figure, not a finding',
  );
});

test('D-001 fires just outside the 1% band, not exactly at it', () => {
  // The tolerance is a strict `>`, so exactly 1.00% is inside the band and a rupee past it is
  // outside. A check firing *at* the boundary would report a certificate rounded to precisely
  // 1% as a discrepancy; one that never fired just past it would miss a deliberate 1% skim.
  // ₹10 L expenditure, ₹10.10 L certified is exactly 1% and must not fire.
  const atBand = reconcile(makeWork({ expenditure: 1_000_000 }), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    certified_amount: 1_010_000,
  });
  assert.ok(atBand.checks_run.includes('D-001'), 'the check must run at the boundary');
  assert.strictEqual(
    atBand.findings.find((f) => f.check_id === 'D-001'),
    undefined,
    'exactly 1% is inside the tolerance band',
  );

  // One rupee more is outside the band and must fire.
  const justOver = reconcile(makeWork({ expenditure: 1_000_000 }), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    certified_amount: 1_010_001,
  });
  assert.ok(
    justOver.findings.find((f) => f.check_id === 'D-001'),
    'a rupee past the band is a finding',
  );
});

test('D-001 does not run against a zero expenditure', () => {
  // A work whose spend has not been keyed in yet is a data-entry backlog, not an integrity
  // finding, and firing here would flag every certificate for every such work.
  const { findings, checks_run } = reconcile(
    makeWork({ expenditure: 0 }),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, certified_amount: 500_000 },
  );
  assert.ok(!checks_run.includes('D-001'));
  assert.strictEqual(findings.find((f) => f.check_id === 'D-001'), undefined);
});

test('D-002 is CRITICAL when the certificate exceeds the sanction', () => {
  const { findings } = reconcile(
    makeWork({ sanctioned_amount: 1_000_000 }),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, certified_amount: 1_400_000 },
  );
  const d002 = findings.find((f) => f.check_id === 'D-002');
  assert.ok(d002);
  assert.strictEqual(d002.severity, 'CRITICAL');
  // ₹4 L over a ₹10 L sanction, as a percentage of the ceiling: the officer sees how far
  // past the sanction the certificate reaches, not merely that it does.
  assert.strictEqual(d002.deviation_pct, 40);
});

test('D-006 is separate from D-002 — release is not sanction', () => {
  // Sanction is authorisation; release is money that actually moved. A certificate for more
  // than was released certifies spending of funds the work never received, and the officer
  // needs to see which ceiling was breached.
  const { findings } = reconcile(
    makeWork({ sanctioned_amount: 2_000_000, released_amount: 1_000_000, expenditure: 1_000_000 }),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, certified_amount: 1_500_000 },
  );
  const d006 = findings.find((f) => f.check_id === 'D-006');
  assert.ok(d006, 'D-006 should fire');
  assert.strictEqual(d006.severity, 'HIGH', 'certifying spend of unreleased funds is serious');
  // ₹5 L certified over ₹10 L released, as a percentage of what was released.
  assert.strictEqual(d006.deviation_pct, 50);
  assert.strictEqual(
    findings.find((f) => f.check_id === 'D-002'),
    undefined,
    'still within sanction, so D-002 must not fire',
  );
});

test('D-003 fires when a certificate predates completion', () => {
  const { findings } = reconcile(
    makeWork({ actual_completion_date: '2025-11-20' }),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, certificate_date: '2025-06-01' },
  );
  const d003 = findings.find((f) => f.check_id === 'D-003');
  assert.ok(d003);
  assert.strictEqual(d003.severity, 'HIGH', 'certifying unfinished work is serious');
  assert.strictEqual(d003.deviation_pct, null, 'a date ordering carries no percentage');
});

test('D-003 does not fire on a bill', () => {
  // A running bill predating completion is exactly what a running bill is. Firing here would
  // flag every correctly-issued interim payment in the corpus.
  const { findings, checks_run } = reconcile(
    makeWork({ actual_completion_date: '2025-11-20' }),
    'BILL',
    { ...NO_FIELDS, certificate_date: '2025-06-01' },
  );
  assert.ok(!checks_run.includes('D-003'));
  assert.strictEqual(findings.find((f) => f.check_id === 'D-003'), undefined);
});

test('D-003 tolerates a week', () => {
  const { findings } = reconcile(
    makeWork({ actual_completion_date: '2025-11-20' }),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, certificate_date: '2025-11-16' },
  );
  assert.strictEqual(findings.find((f) => f.check_id === 'D-003'), undefined);
});

test('D-004 fires when a document predates sanction', () => {
  const { findings } = reconcile(makeWork({ sanction_date: '2025-01-10' }), 'BILL', {
    ...NO_FIELDS,
    certificate_date: '2024-08-01',
  });
  const d004 = findings.find((f) => f.check_id === 'D-004');
  assert.ok(d004);
  assert.strictEqual(d004.severity, 'HIGH', 'a document predating its own sanction is serious');
  assert.strictEqual(d004.deviation_pct, null, 'a date ordering carries no percentage');
});

test('D-007 fires when a UC is in hand and the portal says there is none', () => {
  const { findings } = reconcile(makeWork({ has_uc: false }), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    certificate_date: '2025-12-01',
  });
  const d007 = findings.find((f) => f.check_id === 'D-007');
  assert.ok(d007);
  assert.strictEqual(d007.severity, 'MEDIUM', 'a record-keeping gap, not misconduct');
  assert.strictEqual(d007.deviation_pct, null);
  assert.match(d007.detail, /R-003/, 'the detail should say which rule is affected');
});

test('D-007 does not fire when the portal already records the UC', () => {
  const { findings } = reconcile(makeWork({ has_uc: true }), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    certificate_date: '2025-12-01',
  });
  assert.strictEqual(findings.find((f) => f.check_id === 'D-007'), undefined);
});

test('D-008 catches a period that ends before it begins', () => {
  const { findings } = reconcile(makeWork(), 'UTILISATION_CERTIFICATE', {
    ...NO_FIELDS,
    period_from: '2025-11-30',
    period_to: '2025-01-01',
  });
  const d008 = findings.find((f) => f.check_id === 'D-008');
  assert.ok(d008);
  assert.strictEqual(d008.severity, 'LOW', 'a transcription artefact, not misconduct');
});

test('findings come back most severe first', () => {
  const { findings } = reconcile(
    makeWork({ has_uc: false, sanctioned_amount: 1_000_000, expenditure: 1_000_000 }),
    'UTILISATION_CERTIFICATE',
    {
      ...NO_FIELDS,
      certified_amount: 1_500_000,
      certificate_date: '2025-12-01',
      period_from: '2025-11-30',
      period_to: '2025-01-01',
    },
  );
  const ranks = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const seen = findings.map((f) => ranks[f.severity]);
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), seen, 'not sorted by severity');
});

test('every finding names a published check', () => {
  // A finding whose check_id is not in the catalogue is unexplainable in the UI, which is the
  // R-0xx failure this codebase already fixed once — alerts referencing rule IDs that did
  // not exist in the YAML.
  const { findings } = reconcile(
    makeWork({ has_uc: false, sanction_date: '2025-01-10', actual_completion_date: '2025-11-20' }),
    'UTILISATION_CERTIFICATE',
    {
      ...NO_FIELDS,
      certified_amount: 5_000_000,
      certificate_date: '2024-06-01',
      period_from: '2025-11-30',
      period_to: '2025-01-01',
    },
  );
  assert.ok(findings.length > 0, 'this fixture should produce findings');
  for (const f of findings) {
    assert.ok(f.check_id in CHECK_IDS, `${f.check_id} is not in the published catalogue`);
  }
});

// ─── D-005: the deliberately weak check ─────────────────────────────────────

test('D-005 does not run without a resolved agency name', () => {
  const { findings, checks_run } = reconcileWithAgency(
    makeWork(),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, agency_named: 'Public Works Department' },
    null,
  );
  assert.ok(!checks_run.includes('D-005'));
  assert.strictEqual(findings.find((f) => f.check_id === 'D-005'), undefined);
});

test('D-005 tolerates the same body written differently', () => {
  const { findings } = reconcileWithAgency(
    makeWork(),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, agency_named: 'Public Works Department, Division II' },
    'Public Works Department',
  );
  assert.strictEqual(
    findings.find((f) => f.check_id === 'D-005'),
    undefined,
    'a stricter threshold would report every legitimate naming variant',
  );
});

test('D-005 fires on an unrelated agency, at LOW', () => {
  const { findings } = reconcileWithAgency(
    makeWork(),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, agency_named: 'Kerala State Beverages Corporation' },
    'Public Works Department',
  );
  const d005 = findings.find((f) => f.check_id === 'D-005');
  assert.ok(d005, 'an unrelated agency is a real signal');
  assert.strictEqual(d005.severity, 'LOW', 'the comparison is lexical, so the claim is soft');
  assert.match(d005.detail, /lexical/, 'the detail should admit the weakness');
});

test('reconcileWithAgency preserves the base findings', () => {
  const { findings } = reconcileWithAgency(
    makeWork({ expenditure: 1_000_000 }),
    'UTILISATION_CERTIFICATE',
    { ...NO_FIELDS, certified_amount: 1_500_000, agency_named: 'PWD' },
    'Public Works Department',
  );
  assert.ok(findings.find((f) => f.check_id === 'D-001'), 'D-001 must survive');
});

// ─── The catalogue itself ───────────────────────────────────────────────────

test('every check id is D-prefixed, not R-prefixed', () => {
  // Load-bearing. An R-prefixed id here would put an uncalibrated document finding into the
  // rule catalogue's namespace, where it would be scored against `answer_key` and would
  // corrupt /evaluation.
  for (const id of Object.keys(CHECK_IDS)) {
    assert.match(id, /^D-\d{3}$/, `${id} must be D-prefixed`);
  }
});

test('every check has a non-empty description', () => {
  for (const [id, description] of Object.entries(CHECK_IDS)) {
    assert.ok(description.trim().length > 10, `${id} needs a real description`);
  }
});

// ─── decodeUpload: the upload validation boundary ───────────────────────────
//
// The one gate every uploaded byte passes before it is stored. Tested directly rather than
// through `storeDocument`, whose other steps need a stubbed storage client to reach — the
// four rejection branches and the happy path are the whole contract, and they are pure.

test('decodeUpload returns the decoded bytes for a supported type', () => {
  const bytes = decodeUpload(Buffer.from([0xff, 0xd8, 0xff]).toString('base64'), 'image/jpeg');
  assert.deepStrictEqual([...bytes], [0xff, 0xd8, 0xff]);
});

test('decodeUpload strips a data-URL prefix', () => {
  // What `FileReader.readAsDataURL` produces and the obvious thing a frontend sends. The
  // bytes must be identical to the same payload without the prefix.
  const raw = Buffer.from([0xff, 0xd8, 0xff]).toString('base64');
  const bytes = decodeUpload(`data:image/jpeg;base64,${raw}`, 'image/jpeg');
  assert.deepStrictEqual([...bytes], [0xff, 0xd8, 0xff]);
});

test('decodeUpload refuses an unsupported MIME type', () => {
  // Checked before decoding: a type the extraction step cannot read must never reach
  // storage, where it would become a file that uploads and can never be extracted.
  assert.throws(
    () => decodeUpload('aGVsbG8=', 'text/plain'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, 'UNSUPPORTED_TYPE');
      return true;
    },
  );
});

test('decodeUpload refuses an empty payload', () => {
  // Node's base64 decoder drops invalid characters rather than throwing, so an empty decode
  // means "not base64 or no bytes" — both worth refusing, neither worth storing.
  assert.throws(
    () => decodeUpload('', 'image/jpeg'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, 'EMPTY_FILE');
      return true;
    },
  );
});

test('decodeUpload refuses a payload above the size limit', () => {
  // One byte over MAX_UPLOAD_BYTES. Built from the exported limit so the test tracks the
  // constant rather than restating it.
  const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString('base64');
  assert.throws(
    () => decodeUpload(tooBig, 'image/jpeg'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 413);
      assert.strictEqual(err.code, 'FILE_TOO_LARGE');
      return true;
    },
  );
});

test('decodeUpload admits a payload exactly at the size limit', () => {
  // The limit is a strict `>`, so exactly MAX_UPLOAD_BYTES is allowed. The boundary matters:
  // a document that just fits must not be rejected as one byte too large.
  const atLimit = Buffer.alloc(MAX_UPLOAD_BYTES).toString('base64');
  const bytes = decodeUpload(atLimit, 'image/jpeg');
  assert.strictEqual(bytes.byteLength, MAX_UPLOAD_BYTES);
});

// ─── /status limits: the upload ceiling never exceeds the extract ceiling ────
//
// GET /api/documents/status serves two byte limits from two independent constants:
// `max_bytes` from MAX_INLINE_BYTES (the model's inline-read ceiling, via capability()) and
// `max_upload_bytes` from MAX_UPLOAD_BYTES (the store ceiling). They are kept separate on
// purpose — one is a fact about the model, the other about the evidence bucket — and today
// they coincide at 5 MB. The one relationship that must survive either being changed is the
// ordering: an upload accepted above the extractor's ceiling is stored and then refused at
// extraction with 413 DOCUMENT_TOO_LARGE — an object in the bucket the product has no path to
// read. Nothing wires the two constants to each other, so this is what holds them in order.

test('/status advertises an upload ceiling no larger than the extractor accepts', () => {
  // Assembled exactly as routers/documents.ts serves it, so the assertion tracks the response
  // shape rather than the raw constants: `max_bytes` arrives through capability(), which runs
  // with no credential (it reports availability, it does not require it).
  const status = { ...capability(), max_upload_bytes: MAX_UPLOAD_BYTES };
  assert.ok(
    status.max_upload_bytes <= status.max_bytes,
    `max_upload_bytes (${status.max_upload_bytes}) must be <= max_bytes (${status.max_bytes}): ` +
      'an upload larger than the inline-read ceiling would be stored and then be unextractable.',
  );
});
