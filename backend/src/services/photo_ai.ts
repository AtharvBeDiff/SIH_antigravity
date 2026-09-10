/**
 * Photo AI — reading a site photograph.
 *
 * P-06. The gap this closes mirrors P-04's, one modality over: a work could be marked
 * COMPLETED with a payment released, and the only evidence the platform held was
 * `works.evidence_image_key` — a bare storage key read by one dormant detector. The
 * photograph itself was never looked at. A picture of an empty field could sit against a
 * "completed community hall" and nothing would notice. **That disagreement is the finding**,
 * and this service produces the reading the finding is built from.
 *
 * ## The honest label: Tier 1 observation, not judgement
 *
 * A multimodal model describes what is visibly in the frame — the kind of asset, how far
 * along construction looks, whether anything about the image warrants a second human look.
 * It does **not** decide whether a work is compliant, whether a photo is fraudulent, or
 * whether payment was justified. Every comparison against the portal record happens in
 * `services/photo_reconcile.ts`, in code a reader can follow — deliberately not in the model.
 *
 * ## The reading is blind
 *
 * The model is never told what the work claims. It classifies the asset from the full
 * category list without being shown which category the record says, and reports the
 * construction stage without being told the work is marked complete. If it were shown the
 * claim, an ambiguous photo would resolve toward agreement and the checks would quietly
 * become "can the model read agreement into a blurry image". The comparison is done after,
 * in code, on data the model never had — the same anti-anchoring discipline as P-04.
 *
 * ## Every observation is nullable, and null means "could not tell"
 *
 * A photo the model cannot classify records null, not a guess and not a default category.
 * Downstream, null skips the check rather than fabricating a mismatch against a value the
 * model invented. Doctrine 11, at the point where it bites.
 *
 * ## No self-reported confidence
 *
 * The model is not asked how sure it is. What is recorded is countable: how many of the
 * observation dimensions came back non-null. `fields_found / fields_expected` is a
 * measurement, not the model's opinion of itself.
 *
 * ## Testable without a credential
 *
 * `observePhoto` takes the model client as a parameter, exactly as `document_ai.ts` does, so
 * the prompt, the JSON recovery, the coercion and the null discipline are all under test
 * with no key and no network. See `backend/tests/photo_ai.test.ts`.
 */

import { ApiError } from '../http.ts';
import { WORK_CATEGORIES, type WorkCategory } from '../types.ts';
import {
  generateFromDocument,
  activeModel,
  isConfigured,
  MAX_INLINE_BYTES,
  type GenerateOptions,
  type GenerateResult,
  type InlineDocument,
} from './llm.ts';
// The lenient JSON recovery is shared, not re-implemented: a second copy of the fenced-block
// and brace-slice logic would drift from the tested one. It is a pure, model-agnostic helper.
import { extractJson } from './document_ai.ts';

/**
 * Construction stages, coarse on purpose.
 *
 * Four buckets a model can distinguish from a single photograph with reasonable reliability;
 * a finer scale (plinth / lintel / roof / plaster) asks for a judgement the image often
 * cannot support and would push the model toward guessing. The reconciler only needs to know
 * whether the site looks finished, so the scale is built for that question.
 */
export const CONSTRUCTION_STAGES = [
  'NOT_STARTED',
  'FOUNDATION',
  'IN_PROGRESS',
  'COMPLETED',
] as const;

export type ConstructionStage = (typeof CONSTRUCTION_STAGES)[number];

/**
 * Authenticity concern levels.
 *
 * Deliberately a concern scale, not a verdict. LIKELY does not mean "this image is fake" —
 * it means "enough in this image warrants a human authenticity review". The platform does
 * not determine forgery; it routes a reviewer's attention. V-004 caps the resulting finding
 * at MEDIUM for exactly this reason.
 */
export const INTEGRITY_LEVELS = ['NONE', 'POSSIBLE', 'LIKELY'] as const;

export type IntegrityConcern = (typeof INTEGRITY_LEVELS)[number];

/** Image MIME types accepted as a site photo. A PDF is a document (P-04), not a photograph. */
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Ceiling on the raw model text stored beside an analysis. */
const MAX_RESPONSE_CHARS = 4_000;

/**
 * What the model observed in one image. **Every field nullable, and null means "could not
 * tell".** `asset_category` is drawn from the platform's own category vocabulary so the
 * reconciler can compare it directly against `works.category`.
 */
export interface PhotoObservations {
  asset_category: WorkCategory | null;
  asset_description: string | null;
  construction_stage: ConstructionStage | null;
  integrity_concern: IntegrityConcern | null;
  integrity_note: string | null;
}

export interface ObservationResult {
  observations: PhotoObservations;
  fields_found: number;
  fields_expected: number;
  raw_response: string | null;
  model: string;
  latency_ms: number;
}

/** The model seam, so tests can supply a reader with no credential. Same shape as P-04. */
export type PhotoReadFn = (
  prompt: string,
  document: InlineDocument,
  options?: GenerateOptions,
) => Promise<GenerateResult>;

/** The four observation dimensions counted for the completeness measure (integrity_note is
 * supplementary — it only exists when a concern was raised — so it is not counted). */
const COUNTED_DIMENSIONS: readonly (keyof PhotoObservations)[] = [
  'asset_category',
  'asset_description',
  'construction_stage',
  'integrity_concern',
];

/**
 * The instruction block.
 *
 * What it does that matters, and what it deliberately does not:
 *
 * **It demands `null` explicitly.** A prompt that merely asks "what category is this" gets a
 * category for every image, including ones too dark or too close to classify. Saying "use
 * null when you cannot tell" is the highest-leverage line here.
 *
 * **It classifies blind.** The model is given the full category list and told nothing about
 * what the work claims. It cannot anchor its reading to the record it is meant to check.
 *
 * **It frames integrity as a concern, not a verdict.** The model is told it is flagging for a
 * human reviewer, not determining authenticity. A model asked "is this fake?" answers with
 * unearned confidence; a model asked "does anything here warrant a second look?" reports
 * observations.
 *
 * **It asks for no compliance judgement.** No "is this work complete", no "does this match
 * the record". Those comparisons are the reconciler's, done in code the model never sees.
 */
export function photoPrompt(): string {
  return [
    'You are examining a single photograph said to document a government-funded public',
    'works project in India (a road, a building, a handpump, a culvert, and so on). Report',
    'only what is visibly in the frame. Do not infer the project from anything outside the',
    'image, and do not assume what it is supposed to be.',
    '',
    'Return a single JSON object with exactly these keys:',
    '',
    '  asset_category      the kind of asset visible, as ONE of these exact labels:',
    `                      ${WORK_CATEGORIES.join(', ')}.`,
    '                      Use null if the image does not clearly show an asset of a kind on',
    '                      this list, or you cannot tell which.',
    '  asset_description   a short plain description of what is actually visible in the',
    '                      frame (one or two sentences). null if the image shows nothing',
    '                      identifiable.',
    '  construction_stage  how far along the visible work appears, as ONE of:',
    '                        NOT_STARTED  — bare ground, no construction visible',
    '                        FOUNDATION   — excavation, footings or plinth only',
    '                        IN_PROGRESS  — structure part-built, clearly unfinished',
    '                        COMPLETED    — the asset appears finished and in use',
    '                      Use null if the stage cannot be judged from the image.',
    '  integrity_concern   whether anything about the IMAGE ITSELF warrants a human',
    '                      authenticity review, as ONE of: NONE, POSSIBLE, LIKELY.',
    '                      This is NOT a judgement that the image is fake — you are only',
    '                      flagging whether a person should look more closely. Base it on',
    '                      visible signs such as inconsistent lighting or shadows, edges',
    '                      that look spliced, duplicated regions, or a screen/printout',
    '                      photographed instead of a scene. Use null if you cannot assess it.',
    '  integrity_note      if integrity_concern is POSSIBLE or LIKELY, one sentence on what',
    '                      you observed. null otherwise.',
    '',
    'Rules, in order of importance:',
    '',
    '1. If you cannot determine a value from the image, use null. Never guess. Never use 0,',
    '   "", "N/A", "unknown", or a placeholder — those read as real values downstream, and a',
    '   wrong value is worse than a missing one.',
    '2. Judge only from the image. You are not told what this project is meant to be; do not',
    '   assume it.',
    '3. Do not decide whether the project is complete, compliant, or correctly funded. Report',
    '   what you see; the comparison against the record is made elsewhere.',
    '4. Output the JSON object and nothing else. No prose, no explanation.',
  ].join('\n');
}

/**
 * The sentinels a model reaches for when it should have said null. Same set and same reason
 * as P-04: treating "N/A" as a string would put it in a column and manufacture a mismatch.
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
  'not visible',
  'not sure',
  'unknown',
  'unclear',
  'cannot tell',
  'cannot determine',
  'indeterminate',
  '-',
  '--',
  '—',
  '?',
]);

/** A string field, or null for anything that is not a real value. `max` bounds the length. */
function parseText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (NULL_SENTINELS.has(trimmed.toLowerCase())) return null;
  return trimmed.slice(0, max);
}

/**
 * One of a closed label set, or null. Case- and separator-insensitive because a model asked
 * for `DRINKING_WATER` will sometimes answer "drinking water" or "Drinking-Water". Anything
 * not in the set — including the NONE-for-integrity sentinels — resolves through the caller.
 */
function parseEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (NULL_SENTINELS.has(trimmed.toLowerCase())) return null;
  const normalized = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : null;
}

/**
 * Turns the model's object into {@link PhotoObservations}, trusting none of it.
 *
 * Separated from the model call so the whole coercion layer is under test with plain objects.
 * `integrity_note` is only kept when a concern was actually raised — a note attached to a
 * NONE/absent concern is model chatter, not an observation, and would render as though the
 * platform were hedging about a clean image.
 */
export function coerceObservations(obj: Record<string, unknown>): PhotoObservations {
  const integrity_concern = parseEnum(obj['integrity_concern'], INTEGRITY_LEVELS);
  return {
    asset_category: parseEnum(obj['asset_category'], WORK_CATEGORIES),
    asset_description: parseText(obj['asset_description'], 500),
    construction_stage: parseEnum(obj['construction_stage'], CONSTRUCTION_STAGES),
    integrity_concern,
    integrity_note:
      integrity_concern === 'POSSIBLE' || integrity_concern === 'LIKELY'
        ? parseText(obj['integrity_note'], 500)
        : null,
  };
}

/** How many of the counted observation dimensions came back non-null. A measured completeness. */
export function countObserved(observations: PhotoObservations): number {
  return COUNTED_DIMENSIONS.filter((d) => observations[d] !== null).length;
}

/** How many observation dimensions a reading is expected to carry. */
export function expectedObservations(): number {
  return COUNTED_DIMENSIONS.length;
}

/**
 * Read one photograph.
 *
 * @param document The bytes and MIME type. Validated by `generateFromDocument`.
 * @param read     Model client. Defaults to the real one; injected in tests.
 *
 * Throws `422 PHOTO_UNREADABLE` when the model returned no JSON object at all — a distinct
 * failure from "the model looked and could tell nothing", which comes back as a result with
 * every observation null and `fields_found: 0`. The two look alike and mean opposite things:
 * one is a broken reading, the other is an image with nothing legible in it.
 */
export async function observePhoto(
  document: InlineDocument,
  read: PhotoReadFn = generateFromDocument,
): Promise<ObservationResult> {
  const generated = await read(photoPrompt(), document, {
    temperature: 0,
    // Observations are short — a category token, a stage token, two brief sentences. Unlike
    // a document transcript this needs no large budget.
    maxOutputTokens: 1024,
  });

  const obj = extractJson(generated.text);
  if (obj === null) {
    throw new ApiError(
      422,
      'PHOTO_UNREADABLE',
      'The model did not return a readable observation set for this photograph. This is a ' +
        'failed reading, not an empty image — nothing has been recorded against the work. ' +
        'A clearer photo, or a re-run, is the next step.',
    );
  }

  const observations = coerceObservations(obj);
  return {
    observations,
    fields_found: countObserved(observations),
    fields_expected: expectedObservations(),
    raw_response: generated.text.trim() ? generated.text.trim().slice(0, MAX_RESPONSE_CHARS) : null,
    model: generated.model,
    latency_ms: generated.latency_ms,
  };
}

/** Capability report for `/api/photos/status`. Same shape of honesty as `/documents/status`. */
export interface PhotoAiCapability {
  available: boolean;
  reason: string | null;
  model: string;
  asset_categories: readonly string[];
  construction_stages: readonly string[];
  integrity_levels: readonly string[];
  accepted_mime_types: readonly string[];
  max_bytes: number;
  tier: string;
}

export function capability(): PhotoAiCapability {
  const configured = isConfigured();
  return {
    available: configured,
    reason: configured
      ? null
      : 'No Gemini credential is configured on the server. Set GEMINI_API_KEY in ' +
        'backend/.env and restart. Photo analysis reports unavailable rather than returning ' +
        'observations from a template — a fabricated reading would be acted on as evidence. ' +
        'The geotag check (V-001) is deterministic and needs no model, but it is produced ' +
        'within an analysis pass, so it too waits on a configured key.',
    model: activeModel(),
    asset_categories: WORK_CATEGORIES,
    construction_stages: CONSTRUCTION_STAGES,
    integrity_levels: INTEGRITY_LEVELS,
    accepted_mime_types: PHOTO_MIME_TYPES,
    max_bytes: MAX_INLINE_BYTES,
    // The vision reading is Tier 1. The geotag comparison that runs in the same pass is
    // deterministic arithmetic (Tier 3) and is labelled as such where it is reported, so the
    // model's work is not overclaimed nor the coordinate check's auditability underclaimed.
    tier: 'Tier 1 — multimodal visual assessment. The geotag check alongside it is deterministic.',
  };
}
