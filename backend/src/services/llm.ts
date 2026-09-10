/**
 * LLM client — the single place this codebase talks to a language model.
 *
 * One file, two entry points — `generateText` for a prompt and `generateFromDocument` for
 * a prompt plus a file the model can see — both funnelling into one private `callModel`, so
 * that every model call in DRISHTI shares the same key handling, timeout, retry policy and
 * failure semantics. The alternative — each feature calling `fetch` against the Gemini
 * endpoint — means four subtly different retry loops and four places to look when a key
 * rotates.
 *
 * ## The provider, and why the key shape matters
 *
 * Google moved the Gemini API to **auth keys** — credentials bound to a Google Cloud
 * service account rather than merely associated with a project. New keys created in AI
 * Studio are auth keys automatically, and **unrestricted standard keys are already
 * rejected, with all standard keys rejected from September 2026**. They are still API
 * keys, not OAuth tokens: they travel in the `x-goog-api-key` header exactly as before.
 * So there is no OAuth flow to implement here, but a key that predates the migration
 * will start failing with 401 rather than degrading gracefully, and
 * {@link describeAuthFailure} exists to say so in words an operator can act on instead
 * of a bare status code.
 *
 * ## Where the key lives
 *
 * `process.env.GEMINI_API_KEY`, read from `backend/.env`, which is gitignored
 * (`.gitignore:17`) and has never been committed — verified with `git log --all`. The
 * key is never written to a tracked file, never logged, and never included in an error
 * message or an audit payload: {@link redact} strips anything key-shaped from text
 * headed for a log, because an API error body can echo a request header back.
 * `GOOGLE_API_KEY` is accepted as an alias and takes precedence, matching the Google
 * SDKs' own resolution order so a box already configured for another Google tool works
 * without a second variable.
 *
 * ## No SDK
 *
 * `fetch` against the REST endpoint, deliberately. Node 24 has `fetch` built in, the
 * request is one POST with a JSON body, and adding `@google/genai` would put a
 * dependency tree behind a call this file makes in thirty lines. It also keeps the
 * provider swappable: `generateText` is the seam, and a second provider is a second
 * branch inside it rather than a new dependency and a new call pattern.
 *
 * ## Absent key is a first-class state, not an error to paper over
 *
 * {@link isConfigured} lets a caller ask before it commits to an answer, and
 * `generateText` throws a 503 `LLM_UNCONFIGURED` rather than returning a plausible
 * string. This matters more here than in most products: the cleanup pass that preceded
 * this feature spent its entire length removing UI that rendered unmeasured quantities
 * as numbers, and an AI feature that quietly returns a canned answer when the key is
 * missing is the same failure wearing a different coat. `null` and `'—'`, or an
 * explicit error. Never a default that reads as a result.
 */

import { ApiError } from '../http.ts';

/**
 * Default model.
 *
 * Overridable with `GEMINI_MODEL` because Google's Flash line moves faster than this
 * repository will. Set to `gemini-3.8-flash`, the name in Google's current documentation
 * examples and the operator's chosen model for this deployment. `gemini-3-flash-preview`
 * was the previous default (what the graphify tooling on this box uses); it is a preview
 * alias and Google retires those, so a fixed release name is the safer default. Nothing in
 * DRISHTI's behaviour depends on which; the environment variable remains the escape hatch
 * if this name is ever retired in turn.
 */
const DEFAULT_MODEL = 'gemini-3.8-flash';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Per-request wall-clock bound. A model call is in the officer's request path. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Retry policy: attempts total, not retries after the first. */
const MAX_ATTEMPTS = 3;

/** Base for exponential backoff between attempts, in milliseconds. */
const BACKOFF_BASE_MS = 400;

export interface GenerateOptions {
  /** The instruction block. Sent as Gemini's `systemInstruction`. */
  system?: string;
  /**
   * Sampling temperature. Defaults to 0 — every current caller is doing extraction or
   * translation, where a second identical question should produce the same SQL and a
   * reviewer comparing two runs should not have to wonder whether the difference is
   * sampling noise or a real change.
   */
  temperature?: number;
  /** Hard cap on output tokens. */
  maxOutputTokens?: number;
  /** Override the model for one call. */
  model?: string;
  /** Override the timeout for one call. */
  timeoutMs?: number;
}

export interface GenerateResult {
  text: string;
  /** The model that actually served the request, for the audit payload. */
  model: string;
  /** Wall-clock milliseconds, measured around the successful attempt only. */
  latency_ms: number;
  /** Attempt number that succeeded, 1-based. >1 means the call was retried. */
  attempts: number;
}

/**
 * One document or image sent alongside a prompt.
 *
 * `data` is raw bytes; base64 encoding happens inside {@link generateFromDocument} so no
 * caller has to remember it and no base64 string is built twice. `mimeType` must be one
 * the model accepts — {@link VISION_MIME_TYPES} is the list this codebase permits, which
 * is narrower than Gemini's.
 */
export interface InlineDocument {
  data: Buffer | Uint8Array;
  mimeType: string;
}

/**
 * MIME types accepted for a document-understanding call.
 *
 * Matches the `evidence` storage bucket's `allowed_mime_types` in
 * `supabase/migrations/003_storage_buckets.sql` exactly. Two lists that are supposed to
 * agree and are maintained separately will diverge, so if this changes, change that too —
 * a file the bucket accepts but this rejects becomes a document that uploads and can never
 * be read.
 */
export const VISION_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * Upper bound on the bytes sent to the model in one call.
 *
 * 5 MB, matching the `evidence` bucket's own `file_size_limit`. Gemini's inline-data path
 * tolerates more, but a document that cannot be stored cannot be extracted either, so the
 * tighter of the two limits is the only one worth enforcing. Above this, Google's own
 * guidance is the Files API — a different endpoint, not implemented here, and its absence
 * is reported rather than worked around.
 *
 * The upload boundary (`MAX_UPLOAD_BYTES` in `documents.ts`) must stay `<=` this: a file
 * accepted for storage that this then rejects is an object in the bucket nothing can read.
 * The two are separate constants — a store ceiling and this model ceiling — held in order by
 * a test rather than derived from each other, so lowering this below the upload ceiling is
 * what that test (`tests/document_ai.test.ts`) exists to catch.
 */
export const MAX_INLINE_BYTES = 5 * 1024 * 1024;

/** Resolves the key, honouring the Google SDKs' own precedence. */
function apiKey(): string | undefined {
  const google = process.env['GOOGLE_API_KEY'];
  if (google && google.trim() !== '') return google.trim();
  const gemini = process.env['GEMINI_API_KEY'];
  if (gemini && gemini.trim() !== '') return gemini.trim();
  return undefined;
}

/** The model in effect, for display without making a call. */
export function activeModel(): string {
  const override = process.env['GEMINI_MODEL'];
  return override && override.trim() !== '' ? override.trim() : DEFAULT_MODEL;
}

/**
 * Whether a model call can be attempted at all.
 *
 * Callers should branch on this rather than catching `LLM_UNCONFIGURED`, so a
 * capability endpoint can report the feature as unavailable without provoking an error.
 * `/api/query/status` does exactly that.
 */
export function isConfigured(): boolean {
  return apiKey() !== undefined;
}

/**
 * Removes anything key-shaped from text before it is logged or returned.
 *
 * Covers both eras of Gemini credential — `AIza…` standard keys and `AQ.…` auth keys —
 * plus generic long opaque runs, because an upstream error body can quote the request
 * header back and that body ends up in an error message. Erring toward over-redaction
 * is correct: a redacted diagnostic is inconvenient, a leaked key in a log is not.
 */
export function redact(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/AQ\.[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/\b[0-9A-Za-z_-]{40,}\b/g, '[REDACTED]');
}

/**
 * Turns a 401/403 into an instruction rather than a status code.
 *
 * Written because the failure mode is specific and the generic message is useless. A
 * key that worked before the auth-key migration now returns
 * `UNAUTHENTICATED: Expected OAuth 2 access token, login cookie or other valid
 * authentication credential` — which reads as "you need OAuth" and sends the operator
 * down a path that does not exist. The actual fix is a new auth key from AI Studio.
 */
function describeAuthFailure(status: number, body: string): string {
  const base =
    status === 401
      ? 'Gemini rejected the credential (401 UNAUTHENTICATED). '
      : 'Gemini refused the request (403 PERMISSION_DENIED). ';
  return (
    base +
    'Note the message may mention OAuth; that is misleading. Gemini uses API keys, now ' +
    '"auth keys" bound to a Google Cloud service account, sent in the x-goog-api-key ' +
    'header. Standard keys are being retired — unrestricted ones are already rejected ' +
    'and all standard keys are rejected from September 2026. Create a fresh auth key at ' +
    'https://aistudio.google.com/apikey and set GEMINI_API_KEY in backend/.env. Also ' +
    'check the key is not restricted away from the Generative Language API. Upstream ' +
    'detail: ' +
    redact(body).slice(0, 300)
  );
}

/** Whether a status is worth retrying. */
function isRetryable(status: number): boolean {
  // 429 rate limit, 500/503 transient upstream, 504 gateway timeout. A 400 is a bad
  // request that will be equally bad next time, and 401/403 will not fix themselves.
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One text generation call.
 *
 * Throws {@link ApiError}:
 *   - `503 LLM_UNCONFIGURED` when no key is set. Distinguishable from every other
 *     failure so a caller can render "not configured" rather than "the model failed".
 *   - `502 LLM_AUTH` on 401/403, carrying {@link describeAuthFailure}'s guidance.
 *   - `502 LLM_FAILED` on anything else, after {@link MAX_ATTEMPTS}.
 *   - `504 LLM_TIMEOUT` when every attempt timed out.
 *
 * Note the deliberate asymmetry: retries happen for transient upstream conditions and
 * timeouts, never for a 4xx that describes the request. Retrying a malformed request
 * three times triples the latency of a failure that was certain from the first attempt.
 */
export async function generateText(
  prompt: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  return callModel([{ text: prompt }], options);
}

/**
 * One document-understanding call: a prompt plus a file the model can see.
 *
 * The same key handling, timeout, retry policy and failure semantics as
 * {@link generateText} — both funnel into {@link callModel}, so there is one retry loop in
 * this codebase rather than two that drift apart.
 *
 * Refuses before the network on two grounds, because both are facts about the request that
 * a retry cannot change:
 *   - `400 DOCUMENT_UNSUPPORTED_TYPE` for a MIME type outside {@link VISION_MIME_TYPES}.
 *   - `413 DOCUMENT_TOO_LARGE` above {@link MAX_INLINE_BYTES}, naming the actual size.
 *
 * The document part is placed **before** the prompt text. Google's own document-processing
 * guidance puts the file first when a single file is paired with an instruction; the
 * ordering measurably affects extraction quality, so it is fixed here rather than left to
 * each caller to get right or wrong independently.
 */
export async function generateFromDocument(
  prompt: string,
  document: InlineDocument,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const mime = document.mimeType.trim().toLowerCase();
  if (!(VISION_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ApiError(
      400,
      'DOCUMENT_UNSUPPORTED_TYPE',
      `Cannot read a '${document.mimeType}' document. Supported types: ` +
        `${VISION_MIME_TYPES.join(', ')}.`,
    );
  }

  const bytes = document.data.byteLength;
  if (bytes > MAX_INLINE_BYTES) {
    throw new ApiError(
      413,
      'DOCUMENT_TOO_LARGE',
      `The document is ${(bytes / 1_048_576).toFixed(1)} MB, above the ` +
        `${(MAX_INLINE_BYTES / 1_048_576).toFixed(0)} MB limit for inline document ` +
        'reading. Larger files need Gemini\'s Files API, which is not implemented here.',
    );
  }

  const base64 = Buffer.from(
    document.data.buffer,
    document.data.byteOffset,
    document.data.byteLength,
  ).toString('base64');

  return callModel(
    [{ inlineData: { mimeType: mime, data: base64 } }, { text: prompt }],
    options,
  );
}

/** A single part of a Gemini request: text, or inline file bytes. */
type ModelPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * The one place this codebase performs a model HTTP call.
 *
 * Extracted from `generateText` when document understanding arrived, so that the retry
 * policy, the timeout-per-attempt controller, the auth-failure guidance and the
 * safety-block handling are shared rather than reimplemented. The only difference between
 * a text call and a vision call is the shape of `parts`.
 */
async function callModel(
  parts: ModelPart[],
  options: GenerateOptions,
): Promise<GenerateResult> {
  const key = apiKey();
  if (!key) {
    throw new ApiError(
      503,
      'LLM_UNCONFIGURED',
      'No Gemini credential configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in ' +
        'backend/.env — the file is gitignored, so the key stays out of the repository. ' +
        'Create an auth key at https://aistudio.google.com/apikey. This endpoint returns ' +
        'an error rather than a canned answer on purpose: a fabricated result is worse ' +
        'than an absent one.',
    );
  }

  const model = options.model ?? activeModel();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: options.temperature ?? 0,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
    },
  };
  if (options.system) {
    body['systemInstruction'] = { parts: [{ text: options.system }] };
  }

  let lastError = '';
  let timedOut = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    // A fresh controller per attempt: an aborted signal stays aborted, so reusing one
    // would make every retry fail instantly with the first attempt's abort.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
          // Not retryable, and the guidance is worth surfacing immediately.
          throw new ApiError(502, 'LLM_AUTH', describeAuthFailure(res.status, text));
        }
        lastError = `HTTP ${res.status}: ${redact(text).slice(0, 300)}`;
        if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) break;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      };

      // A safety block is a successful HTTP call with no content. Reported as its own
      // failure rather than as an empty answer, because an empty answer reads as "the
      // corpus has nothing to say".
      if (json.promptFeedback?.blockReason) {
        throw new ApiError(
          502,
          'LLM_BLOCKED',
          `The model declined to answer (${json.promptFeedback.blockReason}). ` +
            'Rephrase the question.',
        );
      }

      const candidate = json.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

      if (text.trim() === '') {
        lastError = `empty response (finishReason: ${candidate?.finishReason ?? 'none'})`;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }

      return {
        text,
        model,
        latency_ms: Date.now() - started,
        attempts: attempt,
      };
    } catch (err) {
      // An ApiError raised above is a decision already taken — propagate it rather than
      // folding it into the retry loop.
      if (err instanceof ApiError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        timedOut = true;
        lastError = `timed out after ${timeoutMs}ms`;
      } else {
        lastError = redact(err instanceof Error ? err.message : String(err));
      }
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  if (timedOut) {
    throw new ApiError(
      504,
      'LLM_TIMEOUT',
      `The model did not respond within ${timeoutMs}ms after ${MAX_ATTEMPTS} attempts.`,
    );
  }
  throw new ApiError(
    502,
    'LLM_FAILED',
    `The model call failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
  );
}

// ─── Embeddings ──────────────────────────────────────────────
//
// The second thing this codebase asks a model for: a vector, not prose. Used by the P-03
// semantic duplicate finder to rank works by how close their titles read once meaning —
// not shared tokens — is the measure. Kept in this file, beside `generateText`, for the
// same reason the two generation entry points share `callModel`: one key resolution, one
// retry policy, one place a rotated key or a changed base URL is edited.

/**
 * Default embeddings model.
 *
 * Separate from {@link DEFAULT_MODEL} and overridable with `GEMINI_EMBED_MODEL`, because the
 * embeddings line and the generation line version independently. `gemini-embedding-001` is
 * the name in Google's current embeddings documentation. Treat this as a default to be
 * confirmed against the deployment's key, not gospel: this box's generation model
 * (`gemini-3.8-flash`) is already ahead of the public catalogue, so the embeddings name may
 * move too — hence the environment escape hatch rather than a hardcoded constant.
 */
const DEFAULT_EMBED_MODEL = 'gemini-embedding-001';

/** The embeddings model in effect, for display without making a call. */
export function activeEmbedModel(): string {
  const override = process.env['GEMINI_EMBED_MODEL'];
  return override && override.trim() !== '' ? override.trim() : DEFAULT_EMBED_MODEL;
}

/**
 * Requested output dimensionality, or `undefined` to take the model's default.
 *
 * `gemini-embedding-001` supports Matryoshka truncation to a shorter vector. Pinning this
 * (via `GEMINI_EMBED_DIMS`) bounds the JSONB row size in `work_embeddings` and fixes the
 * comparison basis; leaving it unset uses the model default. Either way the caller persists
 * the *actual* returned length — this is a request, not a guarantee.
 */
export function activeEmbedDims(): number | undefined {
  const raw = process.env['GEMINI_EMBED_DIMS'];
  if (!raw || raw.trim() === '') return undefined;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export interface EmbedOptions {
  /** Gemini task type. Defaults to `SEMANTIC_SIMILARITY` — the right hint for pairwise dedup. */
  taskType?: string;
  /** Request a truncated vector length. Defaults to {@link activeEmbedDims}. */
  outputDimensionality?: number;
  /** Override the embeddings model for one call. */
  model?: string;
  /** Override the timeout for one call. */
  timeoutMs?: number;
}

export interface EmbedResult {
  /** The embedding vector. Its `.length` is the source of truth for `dims` — never assume. */
  vector: number[];
  /** The model that actually served the request, for the cache row and its invalidation. */
  model: string;
  /** Vector length, read from the response, not from the request. */
  dims: number;
  /** Wall-clock milliseconds around the successful attempt only. */
  latency_ms: number;
  /** Attempt number that succeeded, 1-based. */
  attempts: number;
}

/**
 * Embed one text. Throws the same {@link ApiError} set as {@link generateText}
 * (`503 LLM_UNCONFIGURED`, `502 LLM_AUTH`/`LLM_FAILED`, `504 LLM_TIMEOUT`).
 */
export async function embedText(text: string, options: EmbedOptions = {}): Promise<EmbedResult> {
  const [only] = await callEmbed([text], options);
  // callEmbed guarantees one result per input on success, so this is defined; the throw is a
  // belt-and-braces guard that keeps the return type honest rather than asserting non-null.
  if (!only) {
    throw new ApiError(502, 'LLM_FAILED', 'The embeddings call returned no vector for the input.');
  }
  return only;
}

/**
 * Embed many texts in one call, result order aligned to the input order. Returns `[]` for an
 * empty input without a network call. Same failure semantics as {@link embedText}.
 */
export async function embedTexts(texts: string[], options: EmbedOptions = {}): Promise<EmbedResult[]> {
  return callEmbed(texts, options);
}

/**
 * The one place this codebase performs an embeddings HTTP call.
 *
 * Always uses `:batchEmbedContents`, even for a single text, so there is exactly one embed
 * retry loop — the same reasoning that funnels both generation entry points through
 * {@link callModel}. Mirrors that function's key handling, per-attempt timeout controller,
 * backoff, auth-failure guidance and retry/no-retry split; only the URL, body and response
 * parse differ. The REST batch body repeats `model` inside each request, which the API
 * requires.
 */
async function callEmbed(texts: string[], options: EmbedOptions): Promise<EmbedResult[]> {
  if (texts.length === 0) return [];

  const key = apiKey();
  if (!key) {
    throw new ApiError(
      503,
      'LLM_UNCONFIGURED',
      'No Gemini credential configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in ' +
        'backend/.env — the file is gitignored, so the key stays out of the repository. ' +
        'Create an auth key at https://aistudio.google.com/apikey.',
    );
  }

  const model = options.model ?? activeEmbedModel();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dims = options.outputDimensionality ?? activeEmbedDims();
  const taskType = options.taskType ?? 'SEMANTIC_SIMILARITY';
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:batchEmbedContents`;

  const requests = texts.map((text) => {
    const req: Record<string, unknown> = {
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
    };
    if (dims) req['outputDimensionality'] = dims;
    return req;
  });
  const body = { requests };

  let lastError = '';
  let timedOut = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
          throw new ApiError(502, 'LLM_AUTH', describeAuthFailure(res.status, text));
        }
        lastError = `HTTP ${res.status}: ${redact(text).slice(0, 300)}`;
        if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) break;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }

      const json = (await res.json()) as { embeddings?: { values?: number[] }[] };
      const vectors = json.embeddings?.map((e) => e.values ?? []) ?? [];

      // A short or ragged response is a failed reading, not a partial answer to paper over —
      // a missing vector would otherwise become a zero-length one that cosineSimilarity rejects.
      if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
        lastError = `incomplete embeddings response (${vectors.length}/${texts.length} vectors)`;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }

      const latency_ms = Date.now() - started;
      return vectors.map((vector) => ({
        vector,
        model,
        dims: vector.length,
        latency_ms,
        attempts: attempt,
      }));
    } catch (err) {
      if (err instanceof ApiError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        timedOut = true;
        lastError = `timed out after ${timeoutMs}ms`;
      } else {
        lastError = redact(err instanceof Error ? err.message : String(err));
      }
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  if (timedOut) {
    throw new ApiError(
      504,
      'LLM_TIMEOUT',
      `The embeddings call did not respond within ${timeoutMs}ms after ${MAX_ATTEMPTS} attempts.`,
    );
  }
  throw new ApiError(
    502,
    'LLM_FAILED',
    `The embeddings call failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
  );
}
