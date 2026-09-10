/**
 * Document AI — reading a Utilisation Certificate, completion certificate or bill.
 *
 * P-04. The gap this closes is precise: a UC arrives as a scanned page, and the platform
 * recorded its entire content in `works.has_uc BOOLEAN` — read in one place
 * (`rule_engine.ts:152`, R-003) — plus a `works.uc_date` read by nothing at all. So a
 * certificate could certify ₹8.2 L against a work whose portal expenditure says ₹11.6 L
 * and the platform would report the work as compliant. **That disagreement is the
 * finding**, and until now there was nowhere for it to exist.
 *
 * ## The honest label: this is Tier 1, and it is extraction, not judgement
 *
 * A multimodal model transcribes fields off a page. It does **not** decide whether a
 * certificate is genuine, whether an amount is justified, or whether a work is compliant.
 * Every comparison against the portal record is done in
 * `services/document_reconcile.ts` by arithmetic and string equality that a reader can
 * follow — deliberately not by the model. The model's opinion of a mismatch would be
 * unauditable; subtraction is not.
 *
 * ## Every field is nullable, and a null is never a zero
 *
 * The single most dangerous thing this service could do is return `0` for an amount it
 * could not read. Downstream, `0` means *the certificate certifies nil expenditure* — a
 * severe finding — while null means *nobody knows what it says*. `parseAmount` and
 * `parseDate` return `null` on anything they cannot read, and the reconciler skips a check
 * whose input is null rather than comparing against a substituted value. This is Doctrine
 * 11 at the level where it actually bites.
 *
 * ## No self-reported confidence
 *
 * The model is not asked how sure it is. A number a model invents about itself has no
 * calibration behind it and would be rendered in the UI as though it did. What is recorded
 * instead is countable: how many of the fields this document kind should carry were
 * actually found. `fields_found / fields_expected` is a measurement.
 *
 * ## Extraction is testable without a credential
 *
 * `extractFields` takes the model client as a parameter, exactly as `nl_query.ts` does, so
 * the prompt, the JSON recovery, the field coercion and the null discipline are all under
 * test with no key and no network. See `backend/tests/document_ai.test.ts`.
 */

import { ApiError } from '../http.ts';
import { roundTo } from '../util.ts';
import {
  generateFromDocument,
  activeModel,
  isConfigured,
  MAX_INLINE_BYTES,
  VISION_MIME_TYPES,
  type GenerateOptions,
  type GenerateResult,
  type InlineDocument,
} from './llm.ts';

/**
 * Document kinds this service knows how to read.
 *
 * A closed list, because each kind has its own expected-field set and its own
 * reconciliation checks. An unrecognised `type` on a `documents` row is reported as
 * unreadable rather than guessed at — guessing the kind means applying the wrong checks and
 * producing findings about fields the document never claimed to carry.
 */
export const DOCUMENT_KINDS = [
  'UTILISATION_CERTIFICATE',
  'COMPLETION_CERTIFICATE',
  'BILL',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Fields each kind is expected to carry, for the `fields_found / fields_expected` measure.
 *
 * Not a validation list — a document missing a field here is not malformed, it is just
 * less complete, and the ratio says so. Kept deliberately short: only fields that appear
 * on essentially every instance of that document kind, so a low ratio means "this scan is
 * poor or this page is unusual" rather than "we asked for something rare".
 */
const EXPECTED_FIELDS: Record<DocumentKind, readonly (keyof ExtractedFields)[]> = {
  UTILISATION_CERTIFICATE: [
    'certified_amount',
    'certificate_date',
    'sanction_reference',
    'work_reference',
    'agency_named',
    'signatory_name',
  ],
  COMPLETION_CERTIFICATE: [
    'certificate_date',
    'work_reference',
    'agency_named',
    'signatory_name',
  ],
  BILL: ['certified_amount', 'certificate_date', 'work_reference', 'agency_named'],
};

/** Ceiling on the transcript stored beside an extraction. */
const MAX_TRANSCRIPT_CHARS = 4_000;

/**
 * Fields read off a document. **Every one nullable, and null means unread.**
 *
 * `certified_amount` is rupees as a number, matching the rest of the platform — never a
 * lakh or crore figure, because the reconciler compares it directly against
 * `works.expenditure`. Unit conversion happens in {@link parseAmount}, once, where it can
 * be tested, rather than in a prompt instruction the model may ignore.
 */
export interface ExtractedFields {
  certified_amount: number | null;
  certificate_date: string | null;
  sanction_reference: string | null;
  work_reference: string | null;
  agency_named: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  period_from: string | null;
  period_to: string | null;
}

export interface ExtractionResult {
  doc_kind: DocumentKind;
  fields: ExtractedFields;
  fields_found: number;
  fields_expected: number;
  raw_transcript: string | null;
  model: string;
  latency_ms: number;
}

/** The model seam, so tests can supply a document reader with no credential. */
export type DocumentReadFn = (
  prompt: string,
  document: InlineDocument,
  options?: GenerateOptions,
) => Promise<GenerateResult>;

/**
 * The instruction block.
 *
 * Three things it does that matter, and one it deliberately does not:
 *
 * **It demands `null` explicitly.** Models fill blanks; a prompt that merely asks for
 * fields gets plausible values invented for fields that are not on the page. Saying "use
 * null, never a guess, never zero" is the single highest-leverage line here, and the
 * coercion in {@link coerceFields} assumes the model will sometimes ignore it anyway.
 *
 * **It asks for the amount in rupees and forbids unit conversion.** A certificate written
 * as "Rs. 8.20 lakh" invites the model to helpfully produce `8.20`. The prompt asks for the
 * digits as printed plus the printed unit, and {@link parseAmount} does the conversion —
 * because a conversion done in a prompt is a conversion nobody can test.
 *
 * **It names no portal figure.** The model never sees `works.expenditure` or any other
 * expected value. If it did, an ambiguous scan would be resolved toward the number it was
 * shown, and every reconciliation check would quietly become a check that the model can
 * read agreement into a blurry page. The comparison happens after extraction, in code, on
 * data the model never had.
 *
 * **It does not ask for a verdict.** No "is this valid", no "does this look altered". Those
 * are judgements, they belong to the officer, and a model asked for one will supply it with
 * unearned confidence.
 */
export function documentPrompt(kind: DocumentKind): string {
  return [
    'You are transcribing an Indian government document that has been scanned or',
    'photographed. Read only what is printed. Do not infer, do not compute, do not',
    'complete a partially legible value from context.',
    '',
    `Document kind: ${kind}.`,
    '',
    'Return a single JSON object with exactly these keys:',
    '',
    '  certified_amount       the money figure the document certifies or bills, as it is',
    '                         printed, digits only (e.g. "8,20,000" or "8.20"), together',
    '                         with amount_unit below. Do NOT convert units yourself.',
    '  amount_unit            one of "rupees", "lakh", "crore" — whichever word or symbol',
    '                         appears beside the figure. Use "rupees" when no unit word is',
    '                         printed.',
    '  certificate_date       the date the document was issued or signed, as YYYY-MM-DD.',
    '  sanction_reference     the sanction order number or letter reference it cites.',
    '  work_reference         the work identifier, work order number, or work name it names.',
    '  agency_named           the implementing agency, department or contractor named on it.',
    '  signatory_name         the person who signed it.',
    '  signatory_designation  that person\'s designation or office.',
    '  period_from            start of the period the document covers, YYYY-MM-DD.',
    '  period_to              end of that period, YYYY-MM-DD.',
    '  transcript             the document\'s text as you read it, plain, in reading order.',
    '',
    'Rules, in order of importance:',
    '',
    '1. If a value is not printed on the document, or you cannot read it with confidence,',
    '   use null. Never guess. Never use 0, "", "N/A", or "not found" — those read as',
    '   values further down the pipeline, and a wrong value is worse than a missing one.',
    '2. A number you can see only partially is null. Half of an amount is not an amount.',
    '3. Do not translate. Give names and references exactly as printed, in the script they',
    '   are printed in.',
    '4. Do not judge the document. Do not comment on whether it appears valid, complete,',
    '   altered or genuine. Transcribe only.',
    '5. Output the JSON object and nothing else. No prose, no explanation.',
  ].join('\n');
}

/**
 * Recovers the JSON object from whatever the model wrapped it in.
 *
 * Lenient on purpose — a fenced block, a leading sentence, a trailing apology are all
 * recoverable and none of them is a reason to fail an extraction. Leniency here is safe in
 * a way it would not be in `nl_query.ts`: the worst outcome is a field set, which
 * {@link coerceFields} then treats as untrusted input regardless.
 *
 * Returns null when there is no object at all, which the caller reports as
 * `DOCUMENT_UNREADABLE` rather than as an empty extraction — an empty extraction would
 * render as "this certificate states nothing", a claim about the document rather than about
 * the reading.
 */
export function extractJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1]?.trim(), text].filter(
    (c): c is string => typeof c === 'string' && c !== '',
  );

  for (const candidate of candidates) {
    // Cut to the outermost braces. A model that adds a sentence before the object leaves
    // the object itself intact, and slicing is more reliable than trying to strip prose.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate rather than failing: a fenced block with a trailing comma
      // fails while the same content sliced from the raw text sometimes parses.
      continue;
    }
  }
  return null;
}

/**
 * The sentinels a model reaches for when it should have said null.
 *
 * Every one of these has been observed standing in for an absent value. Treating them as
 * strings would put "N/A" in the `sanction_reference` column, and the reconciler would then
 * report a mismatch between "N/A" and a real sanction reference — a fabricated finding
 * caused entirely by the platform's own credulity.
 */
const NULL_SENTINELS = new Set([
  '',
  'null',
  'none',
  'n/a',
  'na',
  'nil',
  'not found',
  'not available',
  'not printed',
  'not legible',
  'illegible',
  'unknown',
  'unreadable',
  '-',
  '--',
  '—',
  '?',
]);

/** A string field, or null for anything that is not a real value. */
function parseText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (NULL_SENTINELS.has(trimmed.toLowerCase())) return null;
  // A field that came back as a whole paragraph is a transcription accident, not a
  // reference number. Bounded so it cannot dominate a findings table.
  return trimmed.slice(0, 300);
}

/**
 * Rupees from a printed figure and its printed unit.
 *
 * Handles Indian digit grouping (`8,20,000`), a leading `Rs.`/`₹`, and the lakh/crore
 * multipliers. Returns null rather than a number in three cases that all look like
 * successes if you are not careful:
 *
 *   - **Zero.** A certificate that certifies nil expenditure is real but vanishingly rare
 *     compared with a model emitting `0` for a figure it could not read, and the two are
 *     indistinguishable here. Null is the safe reading: the reconciler skips the amount
 *     check instead of reporting a ₹X L shortfall against a zero that was never printed.
 *   - **Negative.** Not a thing a certificate states.
 *   - **Absurdly large.** Above ₹10,000 Cr — larger than the entire scheme's published
 *     allocation of ₹6,680.29 Cr — means the unit was misread or digits were run together.
 *     A finding built on it would be arithmetically correct and completely wrong.
 */
export function parseAmount(value: unknown, unit: unknown): number | null {
  let digits: string | null = null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    digits = String(value);
  } else if (typeof value === 'string') {
    const cleaned = value.trim();
    if (NULL_SENTINELS.has(cleaned.toLowerCase())) return null;
    // Strip currency marks, the word Rupees/Rs, and grouping commas. Keep digits, one
    // decimal point, and a minus sign so a negative is detected and rejected below rather
    // than silently becoming positive.
    digits = cleaned
      .replace(/₹|rs\.?|rupees?|inr/gi, '')
      .replace(/,/g, '')
      .replace(/\s+/g, '')
      .trim();
  }
  if (digits === null || digits === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(digits)) return null;

  const base = Number(digits);
  if (!Number.isFinite(base) || base <= 0) return null;

  const u = typeof unit === 'string' ? unit.trim().toLowerCase() : 'rupees';
  const multiplier = u.startsWith('crore') ? 10_000_000 : u.startsWith('lakh') ? 100_000 : 1;

  // Rounded to paise, because `8.20 * 100_000` is 819999.9999999999 in binary floating
  // point. Left unrounded, a certificate reading "Rs. 8.20 lakh" against a portal figure of
  // exactly 820000 carries a deviation of ~1e-14% — under D-001's tolerance today, but the
  // reconciler also prints these figures, and "₹819,999.9999999999" on a dossier is the kind
  // of detail that makes an officer distrust the rest of the page. Paise is the smallest unit
  // any of these documents actually states.
  const rupees = roundTo(base * multiplier, 2);
  // ₹10,000 Cr. See the doc comment: above the whole scheme's published allocation.
  if (rupees > 100_000_000_000) return null;
  return rupees;
}

/**
 * A `YYYY-MM-DD` date, or null.
 *
 * Accepts the ISO form the prompt asks for and the `DD/MM/YYYY` and `DD-MM-YYYY` forms
 * Indian documents actually print. **Day-first, not month-first** — `03/08/2026` on an
 * Indian certificate is 3 August, and reading it as 8 March would silently move a
 * certificate date by five months, which is exactly the size of error the completion-date
 * check is looking for.
 *
 * An ambiguous two-digit year is refused rather than expanded: `03/08/26` could be 1926 or
 * 2026, and the platform has no basis to choose.
 */
export function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (NULL_SENTINELS.has(raw.toLowerCase())) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);

  let y: number, m: number, d: number;
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else {
    return null;
  }

  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // A calendar-invalid date (31 February) round-trips to a different day through Date, so
  // comparing the round trip is how it gets caught.
  const stamp = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parsed = new Date(`${stamp}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== stamp) return null;
  // A four-digit year outside anything the scheme could have produced is a misread, not a
  // date. MPLADS began in 1993.
  if (y < 1990 || y > 2100) return null;
  return stamp;
}

/**
 * Turns the model's object into {@link ExtractedFields}, trusting none of it.
 *
 * Separated from the model call so the whole coercion layer is under test with plain
 * objects. This is where the prompt's instructions are treated as suggestions the model may
 * have ignored — which, for the null-versus-zero instruction in particular, it will.
 */
export function coerceFields(obj: Record<string, unknown>): ExtractedFields {
  return {
    certified_amount: parseAmount(obj['certified_amount'], obj['amount_unit']),
    certificate_date: parseDate(obj['certificate_date']),
    sanction_reference: parseText(obj['sanction_reference']),
    work_reference: parseText(obj['work_reference']),
    agency_named: parseText(obj['agency_named']),
    signatory_name: parseText(obj['signatory_name']),
    signatory_designation: parseText(obj['signatory_designation']),
    period_from: parseDate(obj['period_from']),
    period_to: parseDate(obj['period_to']),
  };
}

/** How many of the fields this kind expects came back non-null. A measured completeness. */
export function countFound(kind: DocumentKind, fields: ExtractedFields): number {
  return EXPECTED_FIELDS[kind].filter((f) => fields[f] !== null).length;
}

/** How many fields this kind expects. */
export function expectedCount(kind: DocumentKind): number {
  return EXPECTED_FIELDS[kind].length;
}

/**
 * Whether a `documents.type` value names a kind this service can read.
 *
 * Case- and separator-insensitive, because `documents.type` is free text that the ingest
 * never validated: 'utilisation certificate', 'UTILISATION_CERTIFICATE' and 'uc' all
 * appear plausibly. Anything else returns null and is reported as unreadable — the
 * alternative, defaulting to UTILISATION_CERTIFICATE, would run UC checks against a
 * photograph of a site board.
 */
export function resolveKind(type: string): DocumentKind | null {
  const t = type.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((DOCUMENT_KINDS as readonly string[]).includes(t)) return t as DocumentKind;
  if (t === 'UC' || t === 'UTILIZATION_CERTIFICATE') return 'UTILISATION_CERTIFICATE';
  if (t === 'CC' || t === 'COMPLETION_CERT') return 'COMPLETION_CERTIFICATE';
  if (t === 'INVOICE' || t === 'RUNNING_BILL' || t === 'FINAL_BILL') return 'BILL';
  return null;
}

/**
 * Read one document.
 *
 * @param kind     Which document this is. Decides the prompt and the expected-field set.
 * @param document The bytes and MIME type. Validated by `generateFromDocument`.
 * @param read     Model client. Defaults to the real one; injected in tests.
 *
 * Throws `422 DOCUMENT_UNREADABLE` when the model returned no JSON object at all — a
 * distinct failure from "the model read the page and found nothing", which comes back as a
 * result with every field null and `fields_found: 0`. The two look similar and mean
 * opposite things: one is a broken reading, the other is a blank or irrelevant page.
 */
export async function extractFields(
  kind: DocumentKind,
  document: InlineDocument,
  read: DocumentReadFn = generateFromDocument,
): Promise<ExtractionResult> {
  const generated = await read(documentPrompt(kind), document, {
    temperature: 0,
    // Generous: the transcript is part of the output and a scanned certificate page can
    // run long. Too small a cap truncates mid-JSON and turns a good reading into an
    // unreadable one.
    maxOutputTokens: 4096,
  });

  const obj = extractJson(generated.text);
  if (obj === null) {
    throw new ApiError(
      422,
      'DOCUMENT_UNREADABLE',
      'The model did not return a readable field set for this document. This is a failed ' +
        'reading, not an empty document — nothing has been recorded against the work. ' +
        'A clearer scan, or a re-run, is the next step.',
    );
  }

  const fields = coerceFields(obj);
  const transcript = parseText(obj['transcript']);

  return {
    doc_kind: kind,
    fields,
    fields_found: countFound(kind, fields),
    fields_expected: expectedCount(kind),
    // `parseText` caps at 300 chars for reference fields; the transcript wants its own,
    // larger bound, so it is read from the raw object rather than through parseText.
    raw_transcript:
      typeof obj['transcript'] === 'string' && obj['transcript'].trim() !== ''
        ? obj['transcript'].trim().slice(0, MAX_TRANSCRIPT_CHARS)
        : transcript,
    model: generated.model,
    latency_ms: generated.latency_ms,
  };
}

/** Capability report for `/api/documents/status`. Same shape of honesty as `/query/status`. */
export interface DocumentAiCapability {
  available: boolean;
  reason: string | null;
  model: string;
  document_kinds: readonly string[];
  accepted_mime_types: readonly string[];
  max_bytes: number;
  tier: string;
}

export function capability(): DocumentAiCapability {
  const configured = isConfigured();
  return {
    available: configured,
    reason: configured
      ? null
      : 'No Gemini credential is configured on the server. Set GEMINI_API_KEY in ' +
        'backend/.env and restart. Document reading reports unavailable rather than ' +
        'returning fields from a template — a fabricated certificate reading would be ' +
        'acted on as evidence.',
    model: activeModel(),
    document_kinds: DOCUMENT_KINDS,
    accepted_mime_types: VISION_MIME_TYPES,
    max_bytes: MAX_INLINE_BYTES,
    // Rendered next to the feature in the UI. Tier 1 = a model is doing work no rule
    // could do. The reconciliation that follows is arithmetic, and is labelled as such
    // separately — conflating the two would overclaim the extraction and underclaim the
    // auditability of the comparison.
    tier: 'Tier 1 — multimodal extraction. The comparison that follows is arithmetic.',
  };
}
