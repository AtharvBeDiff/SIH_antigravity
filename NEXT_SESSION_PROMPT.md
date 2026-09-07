# Prompt for the next session

Everything below is the message to paste into a fresh session. It is self-contained.

---

You are continuing work on **DRISHTI** — the MPLADS Insight & Integrity Platform, our
entry for Smart India Hackathon 2026 (problem statement SIH26102, MoSPI / DIID). It is a
**read-only oversight layer over e-SAKSHI**. The framing that governs every design
decision: *e-SAKSHI is the ledger; this platform is the auditor's worklist.*

## Where you are

- **Work only in this directory:** `C:\sih_antigravity\.claude\worktrees\reverent-chandrasekhar-03b3be`
  It is a git worktree on branch `claude/reverent-chandrasekhar-03b3be`. **Never `cd` to
  `C:\sih_antigravity`** to do work — that is the main checkout, and it has uncommitted
  untracked files of its own.
- Local `main` and the worktree HEAD are both at `0961d3d` and the worktree is clean.
  Everything through P-15 is committed.
- **Nothing has ever been pushed to `origin`** (`https://github.com/AtharvBeDiff/SIH_antigravity.git`),
  and no PR exists. Do not push or open one unless explicitly told to.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared with the
  main checkout and other worktrees. Use a temporary WIP commit, or
  `git stash push -u -m "<unique-tag>"` and restore with `git stash apply <sha>`.
- **Never use `git checkout-index`.** It reads the index rather than a commit, and it
  destroyed the main checkout's working tree earlier in this project. `git reset --hard <ref>`
  is the correct tool.
- To land a worktree commit on local `main`: `git fetch . <branch>:main` is refused. The
  pattern that works is
  `git update-ref refs/heads/main <new-sha> <old-sha>` then
  `cd /c/sih_antigravity && git reset -q --hard main`.

## Read these first, in this order

1. **`HANDOFF.md`** — the whole thing. Part 2 is the verification gate, Part 6 is the
   backlog, **§6.3 is P-15 as built** and records what is unfinished about it.
2. **`CODE_CHANGES.md`** — Part 2 is the P-01…P-17 feature backlog with tier labels.
3. **`docs/API_CONTRACT.md`** — §10a covers the newest endpoints, §11 is the honest
   security posture.
4. **`RESEARCH_AUDIT.md`** — which claims are sourced and which are not.

There is also a graphify knowledge graph at `graphify-out/graph.json` (1441 nodes, 2328
links, 125 communities, built at commit `a019c28` so it is two commits stale). Query it
with `graphify query "<question>"` rather than rebuilding it. It is **not** in git.

## The verification gate — run this after every change

Measure with `grep -c "error TS"`, **never** `wc -l`.

```bash
npx tsc -p backend --noEmit 2>&1 | grep -c "error TS"       # baseline 46 — 46 passes, 47 is a regression
npx tsc -p data-gen --noEmit 2>&1 | grep -c "error TS"      # baseline 0
```

Frontend must be run **from inside `frontend/`**, and needs both flags:

```bash
cd frontend && npx tsc -b --force --noEmit 2>&1 | grep -c "error TS"    # baseline 0
```

`-p` is invalid with `-b`; without `--force`, a stale `.tsbuildinfo` will report success
over broken code.

**Four traps, all of which have burned someone already:**

- The 46 backend errors are pre-existing `Record<string, unknown>` constraint failures in
  `alerts.ts` and `routers/alerts.ts`. They are a known task, not your bug.
- **cwd persists between Bash calls.** After any `cd frontend`, the next backend
  typecheck must re-prefix
  `cd /c/sih_antigravity/.claude/worktrees/reverent-chandrasekhar-03b3be`
  or tsc emits a spurious `error TS5058` that `grep -c` counts as a real error.
- `npm test` from `backend/` runs all six test files, and **3 tests in
  `rule_engine.test.ts` + `sla_engine.test.ts` fail without `backend/.env`**
  (`Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`). Verified pre-existing, not
  regressions. Run individual files directly to avoid the noise.
- The credential-free tests are `sql_guard.test.ts` (54), `nl_query.test.ts` (21) and
  `public_leakage.test.ts` (1) — **76/76 pass** and must keep passing:
  ```bash
  cd backend && node --test --experimental-strip-types tests/sql_guard.test.ts tests/nl_query.test.ts tests/public_leakage.test.ts
  ```

## Product doctrine — non-negotiable

1. **Never write to e-SAKSHI** or mutate a source record. Read-only, always.
2. Severity **tiers with reason codes**, never a composite 0–100 risk score.
3. **No MP-level risk aggregation anywhere.** Agency-level and district-level are
   explicitly fine. This reaches into the SQL layer: `FORBIDDEN_COLUMNS = ['mp_name','mp_party']`.
4. The public/citizen view is a **whitelist**. `backend/tests/public_leakage.test.ts`
   enforces it and **must not be weakened**.
5. Every rule declares a `verification_status`.
6. **A rule must never fire on a null field.**
7. Explainable detectors only — MAD z-score, not IsolationForest; duplicates need 2-of-3.
8. Rule probation below 40% actionable over 25 reviews; alert budget 10 per district,
   overflow to a visible `BACKLOG` status.
9. Hash-chained audit ledger. The honest claim is *"retroactive edits cannot be silent"* —
   not "tamper-proof".
10. Synthetic data is always labelled.
11. **Never render an unmeasured quantity as a number.** `null` → `'—'`, with prose
    saying why. This was learned the hard way during a cleanup pass that removed
    fabricated figures across the entire product.

**Every state mutation calls `appendAudit()`.** Signature:
`appendAudit(actor, action, entity_type, entity_id, payload = {}): Promise<AuditEvent>`,
returning a row with `seq`. Chain:
`payload_hash = sha256(canonicalJson(payload))`,
`this_hash = sha256(\`${seq}|${prev_hash}|${payload_hash}\`)`, genesis `prev_hash = '0'.repeat(64)`.

## Stack facts that will bite you

- npm workspaces monorepo: `backend`, `frontend`, `data-gen`.
- Backend is Express 5 running TypeScript via `node --experimental-strip-types`:
  - **`.ts` import extensions are mandatory** (`import x from './y.ts'`).
  - No `enum`, no `namespace`, no parameter properties, no decorators — the stripper
    cannot erase them.
  - Express 5 **auto-forwards async rejections** to the error middleware. Do **not**
    try/catch to build a response; `throw new ApiError(status, code, message, details?)`
    from `backend/src/http.ts`.
- `frontend/src/lib/api.ts`'s `request<T>` returns `json?.data`, so **every router must
  respond `{ data: … }`**.
- Frontend: React 19, Vite 7 (proxies `/api` → `http://localhost:4000`), Tailwind 4,
  react-router-dom 7, Recharts 3, framer-motion, lucide-react. All shared UI lives in the
  single file `frontend/src/components/ui.tsx` (`Card`, `PageHeader`, `StatCard`,
  `BenchmarkGauge`, `SeverityChip`, `StatusBadge`, `VerificationBadge`, `Button`,
  `Spinner`, `SyntheticBanner`) — there is **no** `components/ui/` directory.
- **Python is not available** on this machine for ad-hoc scripting. Use `node -e`.
  (graphify has its own uv-managed interpreter and is unaffected.)
- Vocabularies live in `backend/src/types.ts` lines 25–130.
  `SEVERITY_RANK = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }`;
  `WORK_STATUSES = NOT_STARTED | IN_PROGRESS | COMPLETED | CANCELLED | ON_HOLD`;
  `ALERT_STATUSES = OPEN | ACKNOWLEDGED | DISMISSED | ESCALATED | AUTO_RESOLVED | BACKLOG`;
  `payments.stage` CHECK = `MOBILISATION_ADVANCE | RUNNING_BILL | FINAL_BILL | RETENTION_RELEASE`;
  15 `WORK_CATEGORIES`; `INELIGIBLE_CATEGORIES = ['RELIGIOUS_HERITAGE']`.
- Today is **2026-09-07**. `CORPUS_AS_OF = '2026-09-05'`. `SEED = 12345` (Mulberry32).
  **`Math.random()` is banned** — use `makeRng(seed)`.
- The published benchmarks, which are load-bearing in the pitch: **50.71% utilisation by
  value** (₹3,387.38 Cr of ₹6,680.29 Cr) and **61.88% by count** (69,061 of 1,11,600),
  from the **Standing Committee on Rural Development** — *not* MoSPI — covering
  1 Apr 2023 – 22 Jan 2026. Vintage-adjusted that is **78.66%** against matured value,
  leaving ~₹918.71 Cr genuinely overdue. Do not round these or reattribute them.

## Measured state of the tree

19 routers / 19 mounts / 41 endpoints, 21 services, 12 migrations (`001`–`012`),
6 backend test files, 23 routed pages across 26 page files (**5 are orphans** —
`AlertQueue`, `AuditLog`, `Dashboard`, `Digests`, `FieldInspection` — deleting them is on
the cleanup list).

All **28 F-items are complete**. Of 17 P-items, **P-12 and P-15 are delivered**.

## What was just finished: P-15, Ask the Corpus

Live at `/ask`. `GET /api/query/status`, `GET /api/query/examples`, `POST /api/query`,
documented in `docs/API_CONTRACT.md` §10a. A plain-language question becomes SQL, the SQL
is checked, executed read-only, and **shown above the rows, always, unfolded.** That
display is the feature, not decoration.

Three layers of defence, in increasing order of trustworthiness — know which is which
before editing any of them:

1. `backend/src/services/nl_query.ts` — schema description + system prompt. **Shapes**
   output, **constrains nothing.** A quality measure, not a security control.
2. `backend/src/services/sql_guard.ts` — the application guard. Strong, and still
   application code. One `SELECT`, no CTEs, no stacked statements, no dollar-quoting, no
   quoted identifiers, an 11-relation allowlist (`READABLE_RELATIONS`), forbidden columns
   `mp_name`/`mp_party`, 500-row cap applied by **wrapping** the query rather than
   appending `LIMIT`. Check order in `guardQuery` is deliberate — the
   dollar-quoting/quoted-identifier/unterminated-construct checks run **before** comment
   and literal stripping.
3. `supabase/migrations/012_readonly_sql_role.sql` — `SET TRANSACTION READ ONLY` inside
   `public.drishti_readonly_select(query_text, timeout_ms)`. **This is the layer that
   survives a bug in the two above**, and given that the backend holds a service-role key
   bypassing every RLS policy, it is why the feature is defensible at all.

`sql_guard.test.ts` stands to the guard exactly as `public_leakage.test.ts` stands to the
public view: **a change that makes a test here pass by relaxing the guard has broken the
product, not fixed the test.** `nl_query.test.ts` drives `answerQuestion` with a hostile
stub model — the model client is injected precisely so the boundary is testable with no
credential and no database.

**Two things about P-15 are genuinely unfinished. Both matter:**

1. **Migration 012 has never been applied to any database.** Until an operator runs it,
   `POST /api/query` returns `500 QUERY_SHAPE`. The three verification queries at the foot
   of that file, each expecting SQLSTATE `25006`, have **not been run** — nobody has
   confirmed the read-only transaction actually refuses a write. Run them before trusting
   layer 3.
2. **The Gemini HTTP call has never executed live.** Everything up to it is tested; the
   call itself is not.

## The credential situation — do this

`backend/src/services/llm.ts` handles Gemini's **September 2026 auth-key migration**:
keys are now credentials bound to a Google Cloud service account, sent in the
**`x-goog-api-key`** header (not `Authorization: Bearer`). Keys minted in AI Studio are
auth keys automatically. Unrestricted standard keys are already rejected and *all*
standard keys are rejected from September 2026, so a pre-migration key fails with 401
rather than degrading. If you see `Expected OAuth 2 access token`, **that message is
misleading** — the fix is a fresh auth key from https://aistudio.google.com/apikey, not
an OAuth flow. `GOOGLE_API_KEY` takes precedence over `GEMINI_API_KEY` when both are set,
matching Google's own SDKs.

**A Gemini key was pasted into a previous session's transcript and is sitting in
plaintext on disk. It must be rotated.** The agreed handling for the replacement: the
**user** writes it into `backend/.env` as `GEMINI_API_KEY=…` themselves and does **not**
paste it into the conversation. Code reads `process.env.GEMINI_API_KEY`. `backend/.env`
is gitignored (`.gitignore:17`) and has never been committed — verified with
`git log --all`.

Copy `backend/env.example` → `backend/.env` and fill it in. **That template is named
without a leading dot on purpose:** `.gitignore:18` (`**/.env.*`) matched `.env.example`,
so the file `db.ts` told every operator to copy was invisible to git and missing from
every clone. Do not "fix" the name.

With no key, `/api/query/status` reports `available: false` with a reason and the screen
renders a disabled state. **It does not fall back to a canned answer** — a fabricated
result is worse than an absent one. Preserve that.

## What to build next

The live order is **P-01 → P-04 → P-06 → P-03**, but **P-01 is hard-blocked** on a
document nobody has obtained. If you cannot get it, start at P-04.

- **P-01 · Free-text eligibility screening · Tier 1 · highest value in the plan.** An MP's
  recommendation arrives as prose. The guidelines carry a long annexure of
  eligible/ineligible items. This is a **text-understanding problem, not a lookup**, which
  is exactly why R-011 is dead: it checks a 15-value dropdown while the eligibility signal
  lives in the `description` the dropdown discards. Build a retrieval-augmented classifier
  returning *eligible / ineligible / needs human review* **with the specific clause quoted
  back** — the citation is what makes it usable and satisfies Doctrine 7. **Blocker: the
  MPLADS guidelines annexure as text.** Why it's first: ₹6,654.76 Cr of recommendations
  never reach sanction, roughly twice the value stalled after sanction, and this is the
  only feature that acts on that pool.
- **P-04 · Document AI on UCs, certificates and bills · Tier 1 · total gap.** OCR →
  key-value extraction → cross-field consistency against the portal record, surfacing
  **only mismatches**. The data model currently reduces all of this to `has_uc BOOLEAN`
  and a `uc_date` nothing reads. Largest volume of pure drudgery in the workflow.
- **P-06 · Evidence photo verification · Tier 1.** Five distinct checks hide inside
  "verify the photo" — **do not conflate them**: geotag inside the project area (Tier 3,
  pure EXIF, **do not call it AI**); same photo reused across works (perceptual hashing —
  honest label is **computer vision, not machine learning**); does the image show the
  asset type claimed (Tier 1); completed asset versus a foundation (Tier 1, harder, and
  where the money leaks since payment is gated on completion); manipulated,
  re-photographed off a screen, or synthetic (Tier 1). **Critical constraint:** e-SAKSHI
  *permits uploading corrected photographs*, so replacement is a sanctioned routine
  operation and a naive reuse-or-change detector will flag legitimate corrections. Treat
  "image changed" as normal and reason about the **sequence**. Confirm e-SAKSHI's
  retention behaviour before asserting the ledger argument.
- **P-03 · Pre-sanction duplicate detection · Tier 2 · cheap upgrade.** Keep the 2-of-3
  architecture. Three changes: replace `tokenSetRatio` (a Dice coefficient over token
  sets, purely lexical — it misses *"CC road"* vs *"cement concrete road"*, *"Anganwadi
  Kendra"* vs *"Anganwadi Centre"*, and any transliteration) with **multilingual sentence
  embeddings**; use `description`, currently discarded entirely; and **run it at
  recommendation time, not only post-hoc** — free change, large value.
- **On P-02, be precise:** the MAD z-score detects works expensive **relative to peers**,
  not works breaching the Schedule of Rates. An engineer in the room will know the
  difference.

**Six small cleanups**, rough value order: delete the 5 orphan pages; register
`vite-plugin-pwa` in `vite.config.ts` or drop the dependency and the PWA claim; build the
offline inspection queue at `frontend/src/offline.ts` (`idb` is already a dependency and
`Inspection.synced` already exists); produce perceptual-hashable evidence images in
`data-gen` so R-010 leaves `UNCOVERED_RULES`; take on the 46 backend typecheck errors as
their own task; separate the public tree from the officer shell and add the EN/HI toggle.

**One real bug noticed and not fixed:** `frontend/src/lib/api.ts:26` sends header
`x-actor`, but `backend/src/http.ts:103` reads `x-user-id`. So every call through the
shared API client silently attributes to `demo-officer` instead of the real actor.
`AskPage.tsx` sidesteps it by sending `x-user-id` directly. Pick one name and fix both
sides — the audit ledger is only as honest as the actor string it records.

**Six non-code blockers** are listed in `HANDOFF.md` §6.1. The first, the annexure, gates
both P-01 and every `NEEDS_VERIFICATION` rule in §5.1.

## Honest security posture — do not overstate it

There is **no authentication**. `backend/src/http.ts`'s `actorOf(req)` reads the
client-forgeable `x-user-id` header, falls back to `'demo-officer'` when
`DEMO_MODE === 'true'`, else throws `401 NO_ACTOR`. No `Bearer` token is read at all —
deliberately, since reading one would imply a verification that does not happen.
`backend/src/db.ts:9` uses the Supabase **service-role key**, which bypasses every RLS
policy in `supabase/full_schema.sql`. This is disclosed in `HANDOFF.md` Part 4 and
`docs/API_CONTRACT.md` §11. **Do not claim role-based access anywhere in the UI or the
pitch.** Migration 012 bounds *what* a generated query can do; it does not bound *who may
ask*, and that gap is still open.

An unexercised SQL-injection sink — a `SECURITY DEFINER raw_sql(query TEXT)` function —
was found dormant and removed in migration `011_drop_raw_sql.sql` along with the `db.ts`
`exec()` wrapper. Do not reintroduce anything of that shape.

## How to work

Pick the next item, read the code around it before writing, run the full gate after every
change, and commit with a message that explains **why** rather than restating the diff.
Do not delegate to subagents or workflows unless asked. Do not push to `origin`.
