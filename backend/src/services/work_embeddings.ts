/**
 * Work embeddings — semantic duplicate detection on demand (P-03).
 *
 * The batch detector `detectors/duplicate.ts` (R-009) already flags duplicate works, but only
 * where the *titles share tokens*: `tokenSetRatio` is a bag-of-words overlap, so "Construction
 * of anganwadi centre" and "Building of creche for children" — the same work described twice —
 * score near zero and never corroborate. This service closes that gap with a model that
 * compares *meaning*: it embeds each work's descriptive text and ranks same-district peers by
 * cosine similarity of those vectors.
 *
 * ## It is a finding, not an alert
 *
 * This endpoint mints no alerts. It writes nothing to `alerts`, touches no district alert
 * budget, and is not scored against the evaluation answer key. It ranks candidates for a human
 * to look at — the same discipline as the P-04 document checks and P-06 photo checks. R-009's
 * own alert, severity, budget and (emergent, unscored) evaluation are left exactly as they are;
 * this sits beside R-009, not on top of it. Where a candidate pair *also* tripped R-009's
 * deterministic corroboration, that is reported (`also_flagged_by_r009`) so the two agree
 * visibly rather than competing.
 *
 * ## The vector is cached, and the cache invalidates honestly
 *
 * Embedding text costs a model call, so a work's vector is stored in `work_embeddings` and
 * reused. The cache key is the sha256 of the exact text embedded — so an edited title
 * recomputes — **and** the model name, because a vector from one embedding model cannot be
 * compared against another's (cross-model cosine is noise, not similarity). A change to the
 * pinned output dimensionality invalidates it too. Reuse requires all three to match; anything
 * else is recomputed and the stale row superseded, never overwritten, so the history of what
 * was compared survives.
 *
 * ## Testable without a credential
 *
 * Every model call goes through an injected {@link EmbedBatchFn} that defaults to the real
 * client. Tests supply a deterministic stub and exercise the caching, superseding, cosine
 * ranking and R-009 cross-referencing with no key and no network. See
 * `backend/tests/work_embeddings.test.ts`.
 */

import { ApiError } from '../http.ts';
import { all, get, insert, update } from '../db.ts';
import { newId, nowIso, sha256, cosineSimilarity, haversineMeters, clamp, roundTo, isDefaultedCoordinate } from '../util.ts';
import { appendAudit } from './audit_chain.ts';
import type { Alert, Work } from '../types.ts';
import {
  embedTexts,
  activeEmbedModel,
  activeEmbedDims,
  isConfigured,
  type EmbedOptions,
  type EmbedResult,
} from './llm.ts';

/**
 * The Gemini task type every work vector is embedded under, and the value persisted in each
 * row's `task_type`. Passed explicitly (rather than relying on the client's default) so the
 * stored task type is a truthful record of how the vector was produced — a vector embedded
 * for `SEMANTIC_SIMILARITY` and one embedded for `RETRIEVAL_DOCUMENT` are not interchangeable,
 * and the row must say which it is.
 */
const TASK_TYPE = 'SEMANTIC_SIMILARITY';

/** Default cosine threshold a peer must clear to be returned. Overridable per call. */
const DEFAULT_THRESHOLD = 0.8;

/** Default and maximum number of candidates returned, ranked most-similar first. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Largest batch sent to `:batchEmbedContents` in one call. The uncached peers of a populous
 * district can exceed the endpoint's per-request ceiling, so they are chunked. This is a
 * request-shaping constant, not a coverage cap: every uncached peer is embedded, just across
 * more than one call when a district is large.
 */
const MAX_EMBED_BATCH = 100;

/** The model seam, so tests supply a reader with no credential. Batch-shaped, as `llm.ts` is. */
export type EmbedBatchFn = (texts: string[], options?: EmbedOptions) => Promise<EmbedResult[]>;

/** A `work_embeddings` row as stored. Mirrors migration 015. */
export interface WorkEmbedding {
  id: string;
  work_id: string;
  content_sha256: string;
  source_text: string;
  model: string;
  task_type: string;
  dims: number;
  vector: number[];
  latency_ms: number | null;
  created_by: string;
  created_at: string;
  superseded_at: string | null;
}

/** One ranked peer in a duplicate-check result. */
export interface DuplicateCandidate {
  work_id: string;
  title: string;
  category: string;
  location_name: string;
  /** Cosine similarity of the two works' text embeddings, 0..1, rounded for display. */
  similarity: number;
  /**
   * Metres between the two works, or null when either lacks a geotag. Never 0 for a missing
   * coordinate — (0,0) is a real point in the Gulf of Guinea. Doctrine 11.
   */
  distance_m: number | null;
  /**
   * Relative gap between sanctioned amounts as a percentage, or null when either amount is
   * missing/non-positive. 0 is a real value here — it means the two amounts are identical —
   * and is distinct from null, which means an amount could not be read.
   */
  amount_diff_pct: number | null;
  /** True when the deterministic R-009 detector already flagged this exact pair. */
  also_flagged_by_r009: boolean;
}

export interface DuplicateCheckResult {
  work_id: string;
  model: string;
  dims: number;
  threshold: number;
  /** How many peers were actually compared (had a dimension-compatible vector). */
  compared: number;
  candidates: DuplicateCandidate[];
}

/**
 * The one place a work's embedding text is built.
 *
 * Title, category and location, joined. Kept to the descriptive, duplication-relevant fields:
 * two records of the same work will share these, while amounts and dates legitimately differ
 * between a genuine pair of distinct works and would only add noise to the vector. This string
 * is the sole input to the cache key — its sha256 — so it is built here and nowhere else, or a
 * second construction site would silently miss the cache and recompute every time.
 */
export function embeddingText(work: Pick<Work, 'title' | 'category' | 'location_name'>): string {
  return [work.title, work.category, work.location_name]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s !== '')
    .join(' — ');
}

/**
 * Supersede a work's current embeddings and insert a freshly-computed one.
 *
 * The transactionless analogue of the document extraction path (see `services/documents.ts`):
 * migration 015's partial unique index allows one current vector per work, so the supersede
 * must precede the insert or the insert violates the index. If the insert throws, the
 * supersede has already committed — this layer has no transactions (see `db.ts`) — so the
 * previous rows are restored to current rather than left with the work holding no vector at
 * all.
 *
 * @param currentRows the work's rows that are currently un-superseded, fetched by the caller.
 */
async function persistEmbedding(
  workId: string,
  sourceText: string,
  contentSha256: string,
  result: EmbedResult,
  actor: string,
  currentRows: WorkEmbedding[],
): Promise<WorkEmbedding> {
  const supersededAt = nowIso();
  const supersededIds = currentRows.map((e) => e.id);
  for (const id of supersededIds) {
    await update('work_embeddings', { id }, { superseded_at: supersededAt });
  }

  try {
    return await insert<WorkEmbedding>('work_embeddings', {
      id: newId(),
      work_id: workId,
      content_sha256: contentSha256,
      source_text: sourceText,
      model: result.model,
      task_type: TASK_TYPE,
      dims: result.dims,
      vector: result.vector,
      latency_ms: result.latency_ms,
      created_by: actor,
      created_at: nowIso(),
      superseded_at: null,
    });
  } catch (err) {
    for (const id of supersededIds) {
      await update('work_embeddings', { id }, { superseded_at: null });
    }
    throw err;
  }
}

/**
 * Whether a stored embedding may be reused for the given text, model and pinned dimensionality.
 *
 * The cache-invalidation rule, in one place and pure so it is tested directly rather than only
 * through the database path: the text's sha256 must match (an edited title recomputes), the
 * model must match (a vector from another embedding model is not comparable — cross-model
 * cosine is noise), and — only when a dimensionality is pinned — the stored `dims` must equal
 * it (re-pinning GEMINI_EMBED_DIMS invalidates the cache). Used for both the anchor and every
 * peer, so freshness is defined identically for the work under scrutiny and its comparison set.
 */
export function isReusable(
  row: Pick<WorkEmbedding, 'content_sha256' | 'model' | 'dims'>,
  contentSha256: string,
  model: string,
  wantDims: number | undefined,
): boolean {
  return (
    row.content_sha256 === contentSha256 &&
    row.model === model &&
    (wantDims === undefined || row.dims === wantDims)
  );
}

/**
 * A work's current embedding, computing and caching it if the text or model has changed.
 *
 * Reuse requires the stored row to match on content sha256, model, and — when a dimensionality
 * is pinned — dims (see {@link isReusable}). A miss recomputes via the injected client and
 * supersedes the stale row. The model call happens before any write, so a failed embedding
 * leaves the cache untouched and propagates the `ApiError` set `embedText`/`embedTexts` raise.
 */
export async function getOrComputeEmbedding(
  work: Work,
  actor: string,
  embed: EmbedBatchFn = embedTexts,
): Promise<WorkEmbedding> {
  const sourceText = embeddingText(work);
  const contentSha256 = sha256(sourceText);
  const model = activeEmbedModel();
  const wantDims = activeEmbedDims();

  const current = await all<WorkEmbedding>('work_embeddings', {
    where: { work_id: work.id, superseded_at: null },
  });
  const reusable = current.find((e) => isReusable(e, contentSha256, model, wantDims));
  if (reusable) return reusable;

  const [result] = await embed([sourceText], { taskType: TASK_TYPE });
  if (!result) {
    throw new ApiError(502, 'LLM_FAILED', 'The embeddings call returned no vector for the work.');
  }
  return persistEmbedding(work.id, sourceText, contentSha256, result, actor, current);
}

/**
 * Metres between two works, or null when either carries no usable geotag. Never 0 for absent.
 *
 * "Usable" has to include the ingest's Delhi-centroid placeholder, or that promise is false in
 * the worst possible way. Two works whose coordinates were never captured both carry that exact
 * point, so a haversine over them returns **0** — and `DuplicateCheckPanel` renders a 0 as the
 * literal words "same coordinates", the strongest geographic corroboration the duplicate check
 * can offer. Two works with no location on record would appear to sit on top of each other,
 * manufactured entirely out of a data gap. Null is the honest answer, and the panel already
 * renders a null as "no coordinates on record".
 *
 * `== null`, not `=== null`: `db.ts` selects '*', so a column absent from the table arrives as
 * `undefined` and a strict check would fall through to a NaN distance.
 */
export function distanceBetween(a: Work, b: Work): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return null;
  }
  if (isDefaultedCoordinate(a.latitude, a.longitude) || isDefaultedCoordinate(b.latitude, b.longitude)) {
    return null;
  }
  return Math.round(haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude));
}

/** Relative gap between sanctioned amounts as a percentage, or null when either is missing. */
export function amountDiffPct(a: Work, b: Work): number | null {
  const x = a.sanctioned_amount;
  const y = b.sanctioned_amount;
  if (typeof x !== 'number' || typeof y !== 'number' || x <= 0 || y <= 0) return null;
  const max = Math.max(x, y);
  return roundTo((Math.abs(x - y) / max) * 100, 1);
}

/**
 * Whether the deterministic R-009 detector already flagged this exact pair.
 *
 * Membership beats parsing: work ids may contain underscores, so splitting a `duplicate_<a>_<b>`
 * origin_id back into its two ids is ambiguous, but reconstructing the two possible keys (the
 * detector emits the pair in one order, and this work could be either side of it) and testing
 * the set for them is not. Pure, so the cross-reference is tested without an alerts table.
 */
export function r009Flagged(originIds: Set<string>, workId: string, peerId: string): boolean {
  return (
    originIds.has(`duplicate_${workId}_${peerId}`) || originIds.has(`duplicate_${peerId}_${workId}`)
  );
}

/**
 * The scoring core: rank a work's peers by cosine similarity to its anchor vector.
 *
 * Pure by construction — every input is already resolved (the anchor vector, the peers, each
 * peer's vector, the R-009 origin-id set), so all the substance that a duplicate check turns on
 * lives here and is tested with no model, no database and no credential: the cosine ranking, the
 * threshold filter, the sort, the limit, the dimension-mismatch skip, the R-009 cross-reference,
 * and the null-versus-zero discipline of distance and amount. {@link duplicateCheck} is the thin
 * I/O shell that resolves those inputs and calls this.
 *
 * A peer whose vector dimensionality does not match the anchor's is skipped rather than compared
 * — comparing them would throw in `cosineSimilarity`, and fabricating a score would be worse —
 * and `compared` counts only the peers actually scored, so the caller can tell "checked, nothing
 * similar" (compared > 0, no candidates) from "nothing comparable to check against" (compared 0).
 */
export function rankCandidates(
  work: Work,
  anchorVector: number[],
  peers: Work[],
  vectorByWork: Map<string, number[]>,
  r009OriginIds: Set<string>,
  threshold: number,
  limit: number,
): { compared: number; candidates: DuplicateCandidate[] } {
  const candidates: DuplicateCandidate[] = [];
  let compared = 0;
  for (const p of peers) {
    const vec = vectorByWork.get(p.id);
    if (!vec || vec.length !== anchorVector.length) continue;
    compared++;
    const similarity = cosineSimilarity(anchorVector, vec);
    if (similarity < threshold) continue;
    candidates.push({
      work_id: p.id,
      title: p.title,
      category: p.category,
      location_name: p.location_name,
      similarity: roundTo(similarity, 4),
      distance_m: distanceBetween(work, p),
      amount_diff_pct: amountDiffPct(work, p),
      also_flagged_by_r009: r009Flagged(r009OriginIds, work.id, p.id),
    });
  }
  candidates.sort((a, b) => b.similarity - a.similarity);
  return { compared, candidates: candidates.slice(0, limit) };
}

/**
 * Rank a work's same-district peers by semantic similarity of their descriptive text.
 *
 * The subject's vector is the anchor; each peer is scored by cosine similarity against it.
 * Peers are restricted to the same district, matching R-009's own gate — a work in another
 * district is another district's budget and is never a duplicate of this one. The subject is
 * excluded from its own comparison.
 *
 * Peer vectors are reused from the cache when they match the peer's present text, model and
 * dims (a stale, cross-model or wrong-dimension cached vector is recomputed, not compared), and
 * the uncached remainder is embedded in one batched pass — then persisted, so a second check
 * across the same district reuses them and costs nothing. A peer whose vector dimensionality
 * does not match the anchor's is skipped rather than compared, and `compared` counts only the
 * peers actually scored.
 *
 * Raises no alert. Records one audit event — that an officer ran the check, under which model,
 * and which candidates surfaced — because that is an oversight action worth a ledger entry, not
 * a finding against the work.
 */
export async function duplicateCheck(
  workId: string,
  actor: string,
  options: { threshold?: number; limit?: number; embed?: EmbedBatchFn } = {},
): Promise<DuplicateCheckResult> {
  const threshold = clamp(options.threshold ?? DEFAULT_THRESHOLD, 0, 1);
  const limit = clamp(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1, MAX_LIMIT);
  const embed = options.embed ?? embedTexts;

  const work = await get<Work>('works', { id: workId });
  if (!work) {
    throw new ApiError(404, 'NOT_FOUND', `No work with id '${workId}'.`);
  }

  const model = activeEmbedModel();
  const wantDims = activeEmbedDims();

  // The anchor. Persisted and reused like any other work's vector.
  const anchor = await getOrComputeEmbedding(work, actor, embed);

  const peers = (await all<Work>('works', { where: { district_id: work.district_id } })).filter(
    (w) => w.id !== work.id,
  );

  // All current vectors, indexed by work: used both to reuse model-matching peer vectors and,
  // per work, as the exact set persistEmbedding must supersede on a recompute.
  const currentByWork = new Map<string, WorkEmbedding[]>();
  for (const e of await all<WorkEmbedding>('work_embeddings', { where: { superseded_at: null } })) {
    const list = currentByWork.get(e.work_id) ?? [];
    list.push(e);
    currentByWork.set(e.work_id, list);
  }

  // Resolve each peer to a comparable vector: reuse a current row that matches the peer's
  // *present* text, model and dims — the same freshness rule as the anchor, so a peer whose
  // title was edited since it was cached is recomputed rather than compared against its stale
  // vector — else queue it for embedding.
  const vectorByWork = new Map<string, number[]>();
  const toEmbed: Work[] = [];
  for (const p of peers) {
    const pSha = sha256(embeddingText(p));
    const reusable = (currentByWork.get(p.id) ?? []).find((e) => isReusable(e, pSha, model, wantDims));
    if (reusable) vectorByWork.set(p.id, reusable.vector);
    else toEmbed.push(p);
  }

  // Embed the uncached peers, chunked, persisting each so the next check is free. A persist
  // that loses the single-current-vector race to a concurrent check falls back to using the
  // freshly-computed vector in memory rather than failing the whole check.
  for (let i = 0; i < toEmbed.length; i += MAX_EMBED_BATCH) {
    const chunk = toEmbed.slice(i, i + MAX_EMBED_BATCH);
    const texts = chunk.map((p) => embeddingText(p));
    const results = await embed(texts, { taskType: TASK_TYPE });
    for (let k = 0; k < chunk.length; k++) {
      const p = chunk[k]!;
      const r = results[k];
      if (!r) continue;
      try {
        const persisted = await persistEmbedding(
          p.id,
          texts[k]!,
          sha256(texts[k]!),
          r,
          actor,
          currentByWork.get(p.id) ?? [],
        );
        vectorByWork.set(p.id, persisted.vector);
      } catch {
        vectorByWork.set(p.id, r.vector);
      }
    }
  }

  // R-009's alerts, as the exact origin_id strings the detector mints for a pair. The per-
  // candidate cross-reference is resolved inside rankCandidates (see r009Flagged).
  const r009 = new Set(
    (await all<Alert>('alerts', { where: { rule_id: 'R-009' } })).map((a) => a.origin_id),
  );

  // Everything above resolved the inputs from the database; the scoring itself is pure.
  const { compared, candidates: top } = rankCandidates(
    work,
    anchor.vector,
    peers,
    vectorByWork,
    r009,
    threshold,
    limit,
  );

  await appendAudit(actor, 'WORK_DUPLICATE_CHECKED', 'work', work.id, {
    model,
    dims: anchor.dims,
    threshold,
    compared,
    candidates_returned: top.length,
    candidate_work_ids: top.map((c) => c.work_id),
  });

  return {
    work_id: work.id,
    model,
    dims: anchor.dims,
    threshold,
    compared,
    candidates: top,
  };
}

/** Capability report for `GET /api/works/duplicate-check/status`. Same honesty as siblings. */
export interface DuplicateCheckCapability {
  available: boolean;
  reason: string | null;
  model: string;
  /** The pinned output dimensionality, or null when the model's default is used. */
  dims: number | null;
  default_threshold: number;
  tier: string;
}

export function capability(): DuplicateCheckCapability {
  const configured = isConfigured();
  return {
    available: configured,
    reason: configured
      ? null
      : 'No Gemini credential is configured on the server. Set GEMINI_API_KEY in ' +
        'backend/.env and restart. Semantic duplicate detection reports unavailable rather ' +
        'than returning matches from a template — a fabricated similarity would be acted on ' +
        'as evidence. The deterministic R-009 detector (title/geo/amount corroboration) runs ' +
        'in the batch analysis and is unaffected by this.',
    model: activeEmbedModel(),
    dims: activeEmbedDims() ?? null,
    default_threshold: DEFAULT_THRESHOLD,
    tier:
      'Tier 1 — semantic embedding similarity. It surfaces candidates for a human reviewer; ' +
      'it raises no alerts and does not enter the per-district alert budget.',
  };
}
