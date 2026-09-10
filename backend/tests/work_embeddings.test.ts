/**
 * Work-embeddings tests — the semantic duplicate check's substance, with no model, no database
 * and no credential.
 *
 * The design that makes this file possible: every part of the P-03 check that can be *wrong* —
 * the cache-invalidation rule, the cosine ranking, the threshold, the sort, the limit, the
 * dimension-mismatch skip, the R-009 cross-reference, and the null-versus-zero discipline of
 * distance and amount — lives in a pure function that takes already-resolved inputs. This file
 * exercises those directly.
 *
 * What is deliberately NOT here: `duplicateCheck`, `getOrComputeEmbedding` and `persistEmbedding`
 * are the thin database shell around that substance — they call `all`/`get`/`insert`/`update`
 * from `db.ts`, which needs a live Supabase connection, and the test runner is invoked without
 * `--experimental-test-module-mocks`. This mirrors the P-04 sibling (`document_ai.test.ts`),
 * which tests the parsing and reconciliation and leaves `storeDocument`'s persistence to
 * integration. The substance moved out of the shell precisely so the shell needs no test.
 *
 * The bias of the file, like its sibling: **most of it is about not fabricating.** A missing
 * coordinate must read as null and never as (0,0); an unreadable amount must read as null and
 * never as 0; a peer that cannot be compared must be skipped and never scored. Each of those,
 * gone wrong, is a fabricated similarity acted on as evidence.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import type { Work } from '../src/types.ts';
import {
  amountDiffPct,
  capability,
  distanceBetween,
  embeddingText,
  isReusable,
  r009Flagged,
  rankCandidates,
} from '../src/services/work_embeddings.ts';
import { INGEST_DEFAULT_LATITUDE, INGEST_DEFAULT_LONGITUDE } from '../src/util.ts';

/**
 * A work that agrees with itself, in Delhi, ₹10 L sanctioned. Override per fixture.
 *
 * The coordinate is 28.62/77.21 — deliberately a few hundred metres off the ingest's Delhi
 * centroid (28.6139/77.209). It used to be the centroid exactly, which made every fixture built
 * on it sit on the placeholder `isDefaultedCoordinate` refuses, so a test asserting "two works at
 * the same point measure 0 metres" was really asserting "two works with no location on record
 * measure 0 metres" — the fabricated co-location the guard exists to prevent.
 */
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
    latitude: 28.62,
    longitude: 77.21,
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

// ─── embeddingText: the one place the cache-key input is built ───────────────

test('embeddingText joins title, category and location with an em-dash', () => {
  assert.strictEqual(
    embeddingText({ title: 'Anganwadi centre', category: 'HEALTH', location_name: 'Ward 4' }),
    'Anganwadi centre — HEALTH — Ward 4',
  );
});

test('embeddingText trims each field', () => {
  // The leading space on ' HEALTH' is the entire point of the test and must not be tidied away.
  // `Work['category']` is a union of clean literals, so an untrimmed category is unrepresentable
  // in the type — which is exactly why the cast is here: ingest reads categories out of a CSV,
  // where stray whitespace is ordinary, and this asserts the joiner absorbs it.
  assert.strictEqual(
    embeddingText({ title: '  Anganwadi centre ', category: ' HEALTH' as any, location_name: 'Ward 4  ' }),
    'Anganwadi centre — HEALTH — Ward 4',
  );
});

test('embeddingText drops an empty field rather than leaving a dangling separator', () => {
  // A work with no location must not produce "Title — HEALTH — " — the trailing separator would
  // change the hash for two works that are otherwise identical, splitting the cache pointlessly.
  assert.strictEqual(
    embeddingText({ title: 'Anganwadi centre', category: 'HEALTH', location_name: '   ' }),
    'Anganwadi centre — HEALTH',
  );
});

test('embeddingText is stable for equal inputs and changes when the text changes', () => {
  // Stability is the whole basis of the sha256 cache key: identical descriptive text must give
  // an identical string (so the cache hits), and an edited title must give a different one (so
  // it misses and recomputes).
  const a = embeddingText({ title: 'Community hall', category: 'COMMUNITY_INFRASTRUCTURE', location_name: 'Ward 7' });
  const b = embeddingText({ title: 'Community hall', category: 'COMMUNITY_INFRASTRUCTURE', location_name: 'Ward 7' });
  const c = embeddingText({ title: 'Creche building', category: 'COMMUNITY_INFRASTRUCTURE', location_name: 'Ward 7' });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

// ─── isReusable: the cache-invalidation rule ─────────────────────────────────

test('isReusable reuses a row when sha and model match and no dimensionality is pinned', () => {
  const row = { content_sha256: 'abc', model: 'm1', dims: 768 };
  assert.strictEqual(isReusable(row, 'abc', 'm1', undefined), true);
});

test('isReusable reuses a row when sha, model and pinned dims all match', () => {
  const row = { content_sha256: 'abc', model: 'm1', dims: 768 };
  assert.strictEqual(isReusable(row, 'abc', 'm1', 768), true);
});

test('isReusable recomputes when the text changed (sha differs)', () => {
  const row = { content_sha256: 'abc', model: 'm1', dims: 768 };
  assert.strictEqual(isReusable(row, 'xyz', 'm1', undefined), false);
});

test('isReusable recomputes when the model changed', () => {
  // A vector from another embedding model is not comparable — cross-model cosine is noise. A
  // model change must invalidate the cache as surely as an edited title does.
  const row = { content_sha256: 'abc', model: 'm1', dims: 768 };
  assert.strictEqual(isReusable(row, 'abc', 'm2', undefined), false);
});

test('isReusable recomputes when a pinned dimensionality differs from the stored one', () => {
  // Re-pinning GEMINI_EMBED_DIMS changes the comparison basis; a 1536-d vector cannot be scored
  // against 768-d ones. Only enforced when a dimensionality is pinned.
  const row = { content_sha256: 'abc', model: 'm1', dims: 1536 };
  assert.strictEqual(isReusable(row, 'abc', 'm1', 768), false);
});

// ─── distanceBetween: a missing coordinate is null, never (0,0) ──────────────

test('distanceBetween returns the metres between two geotagged works', () => {
  // One degree of latitude is ~111 km. The exact figure matters only enough to prove the
  // haversine is wired the right way round and returns a rounded metre count, not a bug.
  const d = distanceBetween(makeWork({ latitude: 0, longitude: 0 }), makeWork({ latitude: 1, longitude: 0 }));
  assert.ok(d !== null);
  assert.ok(Math.abs(d - 111_195) < 500, `expected ~111195 m, got ${d}`);
  assert.strictEqual(Number.isInteger(d), true, 'distance is rounded to whole metres');
});

test('distanceBetween treats (0,0) as a real location, not a missing one', () => {
  // Doctrine 11. (0,0) is a real point in the Gulf of Guinea. A work sitting there compared
  // against a real point is a real, enormous distance — never null, and never silently 0.
  //
  // The far point is 28.62/77.21, deliberately a few hundred metres off the ingest's Delhi
  // centroid. It used to be the centroid exactly, which made this test assert the opposite of
  // what it reads as: not "(0,0) is real" but "(0,0) against a placeholder is real".
  const d = distanceBetween(makeWork({ latitude: 0, longitude: 0 }), makeWork({ latitude: 28.62, longitude: 77.21 }));
  assert.ok(d !== null, '(0,0) must not read as a missing coordinate');
  assert.ok(d > 1_000_000, `Gulf of Guinea to Delhi is thousands of km, got ${d}`);
});

test('distanceBetween is null when either work sits on the ingest placeholder', () => {
  // The bug this guard closes. Every work whose CSV row carried no coordinate was written to the
  // Delhi centroid, so two of them compare at **0 metres** — and `DuplicateCheckPanel` renders a
  // 0 as the words "same coordinates", the strongest geographic corroboration it can show. Two
  // works with no location on record would appear to sit on top of each other, corroborating a
  // duplicate claim out of nothing but the platform's own data gap.
  //
  // Either component is enough, because the ingest defaults latitude and longitude
  // independently — see `isDefaultedCoordinate`.
  const both = makeWork({ latitude: INGEST_DEFAULT_LATITUDE, longitude: INGEST_DEFAULT_LONGITUDE });
  assert.strictEqual(distanceBetween(both, both), null, 'two uncaptured works are not co-located');
  assert.strictEqual(
    distanceBetween(both, makeWork({ latitude: 12.34, longitude: 56.78 })),
    null,
    'a distance measured to the placeholder is a distance to Delhi, not to the site',
  );
  assert.strictEqual(
    distanceBetween(makeWork({ latitude: 12.34, longitude: INGEST_DEFAULT_LONGITUDE }), makeWork()),
    null,
    'a half-defaulted pair is plausible rather than obviously Delhi, and so more dangerous',
  );
});

test('distanceBetween is null when either coordinate column is absent, not just null', () => {
  // `db.ts` selects '*', so a column missing from the table arrives as `undefined`. The guard
  // uses `== null` for that reason; a strict `=== null` would fall through to a NaN distance,
  // and NaN is neither null nor a number the panel can render honestly.
  assert.strictEqual(distanceBetween(makeWork({ latitude: undefined as any }), makeWork()), null);
  assert.strictEqual(distanceBetween(makeWork(), makeWork({ longitude: undefined as any })), null);
});

test('distanceBetween is null when either work lacks a coordinate', () => {
  assert.strictEqual(distanceBetween(makeWork({ latitude: null }), makeWork()), null);
  assert.strictEqual(distanceBetween(makeWork({ longitude: null }), makeWork()), null);
  assert.strictEqual(distanceBetween(makeWork(), makeWork({ latitude: null, longitude: null })), null);
});

test('distanceBetween is 0 for two works at the same point — a real 0, distinct from null', () => {
  const d = distanceBetween(makeWork({ latitude: 12.34, longitude: 56.78 }), makeWork({ latitude: 12.34, longitude: 56.78 }));
  assert.strictEqual(d, 0);
});

// ─── amountDiffPct: 0 means identical, null means unknown ────────────────────

test('amountDiffPct is the relative gap as a percentage of the larger amount', () => {
  // ₹10 L vs ₹15 L: a ₹5 L gap over the ₹15 L larger figure is 33.3%.
  assert.strictEqual(
    amountDiffPct(makeWork({ sanctioned_amount: 1_000_000 }), makeWork({ sanctioned_amount: 1_500_000 })),
    33.3,
  );
});

test('amountDiffPct is 0 for two identical amounts — a real 0, not null', () => {
  // The null-versus-zero line for money. 0 here means "the two sanctions are identical", which
  // is itself a duplicate signal; null means an amount could not be read. They must not collapse.
  assert.strictEqual(
    amountDiffPct(makeWork({ sanctioned_amount: 1_000_000 }), makeWork({ sanctioned_amount: 1_000_000 })),
    0,
  );
});

test('amountDiffPct is null when either amount is missing or non-positive', () => {
  // A work whose sanction has not been keyed in is unknown, not zero-valued. Comparing against
  // it would report a 100% gap for every peer — a fabricated finding from absent data.
  assert.strictEqual(amountDiffPct(makeWork({ sanctioned_amount: 0 }), makeWork()), null);
  assert.strictEqual(amountDiffPct(makeWork(), makeWork({ sanctioned_amount: 0 })), null);
  assert.strictEqual(amountDiffPct(makeWork({ sanctioned_amount: -5 }), makeWork()), null);
});

// ─── r009Flagged: membership beats parsing an underscored id ─────────────────

test('r009Flagged is true when R-009 minted the pair in either order', () => {
  const forward = new Set(['duplicate_w-anchor_w-peer']);
  const reverse = new Set(['duplicate_w-peer_w-anchor']);
  assert.strictEqual(r009Flagged(forward, 'w-anchor', 'w-peer'), true);
  assert.strictEqual(r009Flagged(reverse, 'w-anchor', 'w-peer'), true);
});

test('r009Flagged is false when the pair is absent', () => {
  const set = new Set(['duplicate_w-anchor_w-other']);
  assert.strictEqual(r009Flagged(set, 'w-anchor', 'w-peer'), false);
});

test('r009Flagged handles work ids that themselves contain underscores', () => {
  // The reason this is set-membership and not string-splitting: given ids "w_1" and "p_2", the
  // stored key "duplicate_w_1_p_2" is built and tested exactly, with no attempt to split it back
  // into its two ids (which would be ambiguous). The check is exact for the actual pair held; a
  // different, absent pair simply builds a different key and does not match.
  const set = new Set(['duplicate_w_1_p_2']);
  assert.strictEqual(r009Flagged(set, 'w_1', 'p_2'), true);
  assert.strictEqual(r009Flagged(set, 'w_1', 'p_3'), false, 'an absent pair does not match');
});

// ─── rankCandidates: the scoring core ────────────────────────────────────────
//
// anchor vector [1,0]. Peers, by cosine similarity to it:
//   p-identical  [2,0]   -> 1.0     (same direction)
//   p-close      [10,1]  -> ~0.995  (small angle)
//   p-45         [1,1]   -> ~0.7071 (45 degrees)
//   p-ortho      [0,1]   -> 0       (orthogonal)
//   p-baddim     [1,0,0] -> skipped (dimension mismatch — would throw in cosineSimilarity)
//   p-novec      (absent from the vector map) -> skipped

const ANCHOR = makeWork({ id: 'w-anchor', sanctioned_amount: 1_000_000, latitude: 28.62, longitude: 77.21 });

function rankFixture(): { peers: Work[]; vectors: Map<string, number[]>; r009: Set<string> } {
  const peers = [
    makeWork({ id: 'p-identical', title: 'Identical work', sanctioned_amount: 1_000_000, latitude: 28.62, longitude: 77.21 }),
    makeWork({ id: 'p-close', title: 'Very similar work', sanctioned_amount: 1_500_000, latitude: null, longitude: null }),
    makeWork({ id: 'p-45', title: 'Somewhat similar', sanctioned_amount: 2_000_000 }),
    makeWork({ id: 'p-ortho', title: 'Unrelated work', sanctioned_amount: 3_000_000 }),
    makeWork({ id: 'p-baddim', title: 'Wrong dimensionality', sanctioned_amount: 1_000_000 }),
    makeWork({ id: 'p-novec', title: 'No vector', sanctioned_amount: 1_000_000 }),
  ];
  const vectors = new Map<string, number[]>([
    ['p-identical', [2, 0]],
    ['p-close', [10, 1]],
    ['p-45', [1, 1]],
    ['p-ortho', [0, 1]],
    ['p-baddim', [1, 0, 0]],
    // p-novec deliberately omitted.
  ]);
  // R-009 flagged the anchor/p-close pair, minted in the reverse order to prove the two-key test.
  const r009 = new Set(['duplicate_p-close_w-anchor']);
  return { peers, vectors, r009 };
}

test('rankCandidates ranks by cosine similarity, most similar first', () => {
  const { peers, vectors, r009 } = rankFixture();
  const { candidates } = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 0.8, 10);
  assert.deepStrictEqual(
    candidates.map((c) => c.work_id),
    ['p-identical', 'p-close'],
    'only the two above 0.8, most similar first',
  );
  assert.strictEqual(candidates[0]!.similarity, 1);
  assert.strictEqual(candidates[1]!.similarity, 0.995);
});

test('rankCandidates counts every dimension-compatible peer as compared, threshold or not', () => {
  // `compared` is the honest denominator: p-identical, p-close, p-45 and p-ortho are all scored
  // (4), even though only two clear the threshold. p-baddim and p-novec are not comparable and
  // are excluded — so "compared: 4, candidates: 2" reads as "checked four, two were similar",
  // never as "found only two peers".
  const { peers, vectors, r009 } = rankFixture();
  const { compared, candidates } = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 0.8, 10);
  assert.strictEqual(compared, 4);
  assert.strictEqual(candidates.length, 2);
});

test('rankCandidates skips a dimension-mismatched peer rather than throwing or fabricating', () => {
  const { peers, vectors, r009 } = rankFixture();
  const { candidates } = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 0, 50);
  assert.ok(!candidates.some((c) => c.work_id === 'p-baddim'), 'the 3-d vector must be skipped');
  assert.ok(!candidates.some((c) => c.work_id === 'p-novec'), 'the vector-less peer must be skipped');
});

test('rankCandidates applies the limit after sorting', () => {
  const { peers, vectors, r009 } = rankFixture();
  const { compared, candidates } = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 0.8, 1);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0]!.work_id, 'p-identical', 'the single most similar survives');
  assert.strictEqual(compared, 4, 'the limit caps output, not how many were compared');
});

test('rankCandidates respects the threshold at the boundary (>=, not >)', () => {
  // At threshold 1.0 only an exact-direction match (cosine 1.0) survives; p-close at 0.995 does
  // not. A boundary of `>` would drop a genuine identical-text duplicate scoring exactly 1.0.
  const { peers, vectors, r009 } = rankFixture();
  const { candidates } = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 1, 10);
  assert.deepStrictEqual(candidates.map((c) => c.work_id), ['p-identical']);
});

test('rankCandidates carries the R-009 cross-reference, distance and amount per candidate', () => {
  const { peers, vectors, r009 } = rankFixture();
  const { candidates } = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 0.8, 10);
  const identical = candidates.find((c) => c.work_id === 'p-identical')!;
  const close = candidates.find((c) => c.work_id === 'p-close')!;

  // p-identical: same point as the anchor (distance 0, a real 0) and same amount (diff 0, a real
  // 0); R-009 never flagged this pair.
  assert.strictEqual(identical.distance_m, 0);
  assert.strictEqual(identical.amount_diff_pct, 0);
  assert.strictEqual(identical.also_flagged_by_r009, false);

  // p-close: no coordinates (distance null, never 0), a ₹5 L gap over ₹15 L (33.3%), and R-009
  // did flag the pair — reported so the deterministic and semantic signals agree visibly.
  assert.strictEqual(close.distance_m, null);
  assert.strictEqual(close.amount_diff_pct, 33.3);
  assert.strictEqual(close.also_flagged_by_r009, true);
});

test('rankCandidates returns nothing when no peer clears the threshold, but still reports compared', () => {
  // "Checked, nothing similar" — the clean-work case. Distinct from an empty district, which
  // would report compared 0.
  const { peers, vectors, r009 } = rankFixture();
  const { compared, candidates } = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 0.999, 10);
  assert.strictEqual(candidates.length, 1, 'only the exact match beats 0.999');
  assert.strictEqual(compared, 4);

  const none = rankCandidates(ANCHOR, [1, 0], peers, vectors, r009, 1.001, 10);
  assert.deepStrictEqual(none.candidates, [], 'nothing can exceed a threshold above 1');
  assert.strictEqual(none.compared, 4, 'they were still compared');
});

// ─── capability: honest about being unconfigured, and about raising no alerts ─

test('capability reports a reason exactly when it is unavailable', () => {
  // The status contract: reason is null iff available. Asserted as a biconditional so the test
  // holds whether or not a credential happens to be present in the environment.
  const cap = capability();
  assert.strictEqual(cap.reason === null, cap.available);
});

test('capability advertises the default threshold and that it raises no alerts', () => {
  const cap = capability();
  assert.strictEqual(cap.default_threshold, 0.8, 'the documented default');
  assert.strictEqual(typeof cap.model, 'string');
  assert.ok(cap.dims === null || typeof cap.dims === 'number');
  assert.match(cap.tier, /no alert/i, 'the tier text must say it raises no alerts');
});

test('capability, when unavailable, names the credential and reassures that R-009 is unaffected', () => {
  const cap = capability();
  if (!cap.available) {
    assert.match(cap.reason!, /GEMINI_API_KEY/, 'the reason must name the credential to set');
    assert.match(cap.reason!, /R-009/, 'and reassure that the deterministic detector still runs');
  }
});
