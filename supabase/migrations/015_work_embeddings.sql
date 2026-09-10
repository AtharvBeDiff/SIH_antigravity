-- MPLADS Platform — P-03 Semantic Duplicate Detection: cached work text embeddings
--
-- What this migration exists to fix
--
-- The batch duplicate detector (R-009, backend/src/detectors/duplicate.ts) requires two of
-- three corroborations — title similarity, geographic proximity, matching amount — and its
-- title test is `tokenSetRatio`, a bag-of-words overlap. So two records of the *same* work
-- written in different words ("Construction of anganwadi centre" vs "Building of creche for
-- children") share almost no tokens, score near zero on the title leg, and never reach the
-- 2-of-3 bar. The duplicate slips through precisely because it was paraphrased.
--
-- This table backs an on-demand check that compares *meaning* instead of *tokens*: it stores a
-- model-produced embedding of each work's descriptive text so same-district peers can be ranked
-- by cosine similarity of those vectors. It sits beside R-009, not on top of it — the endpoint
-- raises no alert, enters no district budget, and is not scored against the answer key. Where a
-- candidate pair also tripped R-009, that agreement is reported, not double-counted.
--
-- ## The vector is JSONB, not pgvector
--
-- Deliberately, and consistent with the rest of this backend's minimal-dependency posture (no
-- pgvector extension, no vector index). At MPLADS district scale the peer set is small and the
-- comparison is a single pass of cosine similarity in application code
-- (backend/src/util.ts:cosineSimilarity). A JSONB array of doubles needs no extension, no
-- migration of the Supabase instance, and no ANN index to reason about; if the corpus ever
-- outgrows a linear scan, that is the point to add pgvector, not before.
--
-- ## The row is a cache, and it supersedes rather than overwrites
--
-- Embedding text costs a model call, so a work's vector is stored and reused. The cache key is
-- `content_sha256` — the sha256 of the exact text embedded — together with `model`: a vector
-- from one embedding model cannot be compared against another's (cross-model cosine is noise),
-- so a model change invalidates the cache as surely as an edited title does. On a recompute the
-- stale row is stamped `superseded_at` and a new row inserted, never edited in place, so the
-- record of what was compared, under which model and dimensionality, survives. The partial
-- unique index below is what makes "the current vector" unambiguous.

-- ─── The cached embedding: one work's text as a vector ──────────────────────

CREATE TABLE IF NOT EXISTS work_embeddings (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  work_id           TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- sha256 of `source_text`. Half the cache key: an edited title changes the text, changes
  -- this hash, and forces a recompute. Not unique — two works with identical descriptive text
  -- legitimately share it, and that itself is a strong duplicate signal.
  content_sha256    TEXT NOT NULL,

  -- The exact text that was embedded (title — category — location), kept verbatim so a
  -- surprising similarity can be inspected without re-deriving what went into the vector.
  -- Built in exactly one place: embeddingText() in services/work_embeddings.ts.
  source_text       TEXT NOT NULL,

  -- The embedding model that produced this vector, and the task type it was embedded under.
  -- The other half of the cache key: a vector is only comparable against others from the same
  -- model. `task_type` records how it was produced (SEMANTIC_SIMILARITY) — a vector embedded
  -- for retrieval is not interchangeable with one embedded for similarity.
  model             TEXT NOT NULL,
  task_type         TEXT NOT NULL,

  -- Length of `vector`, read from the model's response, never assumed. Pinning
  -- GEMINI_EMBED_DIMS truncates the vector (Matryoshka); leaving it unset takes the model
  -- default. Either way this column holds the actual stored length, and a change to the pinned
  -- value invalidates the cache the same way a model change does.
  dims              INTEGER NOT NULL,

  -- The embedding itself, as a JSONB array of doubles. See the header for why JSONB and not
  -- pgvector. Cosine similarity is computed in application code over this array.
  vector            JSONB NOT NULL,

  latency_ms        INTEGER,

  -- Who triggered the computation. Not authentication — `actorOf` reads a client-supplied
  -- header (see docs/API_CONTRACT.md §11). Recorded for attribution, labelled as unverified.
  created_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set when a recompute (changed text, model or dimensionality) replaces this row. NULL = the
  -- current vector for the work.
  superseded_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_work_embeddings_work ON work_embeddings(work_id);

-- One current vector per work. Partial unique index so history accumulates freely while "which
-- vector is live" stays unambiguous — and so the supersede-then-insert in
-- services/work_embeddings.ts is enforced by the database, not just by convention: inserting a
-- second current row for a work fails here rather than silently leaving two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_embeddings_current
  ON work_embeddings(work_id)
  WHERE superseded_at IS NULL;

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Enabled with a read policy to match the P-04 and P-06 tables. The honest caveat from
-- docs/API_CONTRACT.md §11 holds: backend/src/db.ts connects with the service-role key, which
-- bypasses every policy below. This exists so the table is not the one unprotected set if a
-- non-service-role client is ever introduced — it is not in force for any request the API
-- makes today.

ALTER TABLE work_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_all_work_embeddings" ON work_embeddings;
CREATE POLICY "auth_read_all_work_embeddings" ON work_embeddings
  FOR SELECT TO authenticated USING (TRUE);
