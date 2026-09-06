# HANDOFF — DRISHTI · MPLADS Insight & Integrity Platform

**SIH 2026 · Problem Statement SIH26102 (MoSPI / DIID)**
Node **24.11.1**, npm workspaces, Windows dev box. Handoff written **2026-09-07**.

This document is for an AI or developer picking the project up **cold, with no prior
chat context**. Read it top to bottom before editing anything. It is written to be
falsifiable: every count in it was measured against the tree at the time of writing,
and the command to re-measure is given alongside. Where something is *not* built, it
says so plainly rather than describing the plan as though it shipped.

**The single most important habit to adopt:** this codebase has been through a long
cleanup pass whose entire subject was **fabricated numbers** — UI that rendered
`total_sanctioned * 0.62` as "Released to Agencies", a chart built from six literal
rupee figures, an agencies page with four hardcoded rows and "DRDA — 88.4% timely
execution" that made no API call. Every one of those has been removed. The replacement
pattern is: **compute it, or return `null` and render `'—'`.** Never a plausible
default. If you find yourself typing a number into a component, stop.

---

## 0 — ORIENTATION IN 60 SECONDS

```
backend/        Express 5 API, Node native TypeScript, Supabase/PostgreSQL
frontend/       React 19 + Vite 7 + Tailwind 4, 20 routed pages
data-gen/       deterministic synthetic-corpus generator (seeded, no clock reads)
supabase/       migrations 001–011, full_schema.sql, seed.sql
docs/           API_CONTRACT, DATA_CONTRACT, ARCHITECTURE, DEMO_SCRIPT
```

```bash
npm install && npm run typecheck && npm run dev
```

`npm run dev` starts the API on **:4000** and the web app on **:5173** (Vite proxies
`/api` → `:4000`). The app needs `backend/.env` with `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; without it the server boots but every query fails and the
test suite fails on connection rather than on logic. `.env` is gitignored and has never
been committed (verified with `git log --all`).

Seeding: apply `supabase/full_schema.sql`, then `npm run generate`, then load
`supabase/seed.sql` with `psql -f`. There is no `npm run seed` — it used to point at
`backend/scripts/seed.ts`, which does not exist, so the documented setup path ended in
`MODULE_NOT_FOUND`. That script has been deleted rather than repointed.

---

## PART 1 — WHAT THIS IS AND WHY

### 1.1 The pitch

MPLADS sanctioned **₹6,680.29 Cr** over 1 Apr 2023 – 22 Jan 2026, of which
**₹3,387.38 Cr** worth of works are recorded complete — **50.71% by value** against
**61.88% by count** (69,061 of 1,11,600 works). Both figures are from the **Standing
Committee on Rural Development** (*not* MoSPI — that misattribution was corrected
throughout; do not reintroduce it). The eleven-point spread is the interesting part:
the works that complete are systematically cheaper than the works that stall.

The public dashboard shows only aggregates; work-level detail lives in the e-SAKSHI
portal behind a login. DRISHTI is a **read-only review layer on top of e-SAKSHI** that
turns work records into a **prioritised worklist for a monitoring officer**: which works
are stalled, which have money released ahead of progress, which look duplicated, which
are missing utilisation certificates.

> The framing that must survive every design decision:
> **"e-SAKSHI is the ledger. This platform is the auditor's worklist."**

### 1.2 The constraint that shapes everything

**We are students and cannot get e-SAKSHI data access.** So the MVP is **not a pilot on
real data — it is a self-contained demonstration vehicle**. Consequences already
designed in:

- The demo runs on a **synthetic corpus of 2,000 works** with a **derived answer key** —
  797 labelled conditions across 11 anomaly types, written by `data-gen` to
  `supabase/seed.sql`. Ground truth is derived from the *finished* corpus, not recorded
  at plant time, because several conditions arise organically and labelling only the
  deliberate plants would score every correct alert on an organically-anomalous work as
  a false positive.
- **Recall measures pipeline fidelity, not detection accuracy.** The key restates each
  rule's own physical condition, so a miss means the condition did not survive the
  catalogue → status filters → probation → alert store. Neither the UI nor this document
  claims a rule would catch real procurement fraud. No synthetic corpus can measure that.
- Precision/recall are computed over the **eleven covered rules only**; `/evaluation`
  names them and counts the alerts it could not judge. Ten rules sit outside the key for
  three distinct reasons recorded in `data-gen`'s `UNCOVERED_RULES`. The generator warns
  if a catalogued rule appears in neither list — that check is how R-021 was found.
- **Calibration agreement is arithmetic, not evidence.** The generator draws from the
  published figures, so a close deviation confirms the generator works and says nothing
  about the scheme. The residual gap was deliberately *not* tuned away.

### 1.3 Product doctrine — non-negotiable, enforced structurally

1. **Read-only.** DRISHTI never writes to e-SAKSHI and never mutates a source record.
2. **Severity tiers with reason codes, never a composite 0–100 risk score.** A number
   invites ranking people; reason codes invite investigation.
3. **No MP-level risk aggregation anywhere.** An MP's name is a fact on a work record;
   it is never a *subject of aggregation* in an integrity context. **Agency-level and
   district-level aggregation are explicitly fine** — the agency is where execution
   accountability sits, and that is exactly what makes `services/agency_performance.ts`
   legal. Nothing in it reads `works.mp_name` or `constituencies.mp_name`.
4. **The public/citizen view is a whitelist, never a blacklist.** `PublicWork` is built
   by explicitly naming safe fields, never by deleting keys off a `Work`.
   `backend/tests/public_leakage.test.ts` enforces this and **must not be weakened**.
5. **Honesty contract on rules.** Every rule declares `verification_status`: `VERIFIED`
   (arithmetic or scheme design), `NEEDS_VERIFICATION` (threshold believed right, not
   yet checked against the official 2023 guidelines PDF), or `PLATFORM_POLICY` (an
   operational threshold we chose). The UI shows the marker. Every alert's `rule_id`
   must resolve to a catalogued rule.
6. **A rule must never fire on a null field.** Missing data is a data-quality finding at
   most, never evidence of wrongdoing.
7. **Explainable detectors.** Robust MAD z-score for cost outliers, not IsolationForest —
   "3.4× the district median for this category" is followable by an officer. Duplicate
   detection needs **2-of-3** corroboration (text + geo + amount). Photo-reuse is
   **cross-work only**.
8. **Officer-trust machinery.** *Rule probation* auto-suspends a rule dismissed too often
   (below 40% actionable over 25 reviews). *Alert budget* caps open alerts at 10 per
   district; the rest go to a visible **BACKLOG**, never hidden.
9. **Tamper-evident audit ledger.** Hash-chained append-only log; the live tamper demo
   makes `/verify` go red on the edited row. Honest claim: **retroactive edits cannot be
   silent** — *not* "blockchain-grade immutability."
10. **Synthetic data is always labelled synthetic**, never presented as a real finding
    about a real person or agency.

**The eleventh, added by the cleanup pass and the reason this file was rewritten:**
**never render an unmeasured quantity as a number.** `null` → `'—'`, and say in prose
why it is unmeasured.

### 1.4 Stack, and why

- **Node 24 native TypeScript** via `--experimental-strip-types`. No build step, no
  `tsx`. This is why **relative imports carry `.ts`** and why
  `enum` / `namespace` / parameter-properties / decorators are **banned** — Node strips
  types, it does not compile them.
- **Express 5** — async handler rejections auto-forward to the error middleware. **Do
  not wrap handlers in try/catch to build error responses**; `throw new ApiError(...)`.
- **Supabase / PostgreSQL** via the service-role key. There is **no transaction helper**:
  Supabase's REST interface exposes none, so multi-statement atomicity is unavailable
  through `db.ts`. Queries needing joins or aggregates call `getDb()` and use the
  PostgREST builder directly.
- **React 19 + Vite 7 + Tailwind 4 + react-router-dom 7 + Recharts 3.**
- **No GPU, no Docker required** — itself a procurement argument for government.

---

## PART 2 — THE VERIFICATION GATE (read this before your first edit)

Three workspaces typecheck. **Measure with `grep -c "error TS"`, never `wc -l`** — a
single TS error spans multiple lines and `wc -l` over-counts.

```bash
npx tsc -p backend --noEmit    2>&1 | grep -c "error TS"    # expect 46
npx tsc -p data-gen --noEmit   2>&1 | grep -c "error TS"    # expect 0
cd frontend && npx tsc -b --force --noEmit 2>&1 | grep -c "error TS"   # expect 0
```

Four things will bite you here, in order of how often they have:

1. **The frontend must be typechecked from inside `frontend/`, with `-b --force`.** The
   project uses TS project references; `-p` is *invalid* combined with `-b`, and without
   `--force` a stale `.tsbuildinfo` reports success over broken code.
2. **The shell's cwd persists between commands.** After any `cd .../frontend && …`, the
   next backend typecheck **must** re-prefix an absolute
   `cd /c/sih_antigravity/.claude/worktrees/<name>` (or the repo root), or you get a
   spurious `error TS5058: The specified path does not exist: 'backend'` that `grep -c`
   dutifully counts as 1. This has fired repeatedly. Order the calls backend-first,
   frontend-last, and re-`cd` when in doubt.
3. **Backend's 46 errors are a pre-existing baseline, not your regression.** They were
   there before the cleanup pass and are unrelated to it. The majority are
   `Record<string, unknown>` constraint mismatches in `services/alerts.ts` and
   `routers/alerts.ts`. **46 is pass. 47 is a regression you introduced.** Do not "fix"
   them opportunistically as part of an unrelated change; if you take them on, take them
   on as their own task.
4. **`npm test`** runs 4 suites plus `verify_db.ts`
   (`node --test --experimental-strip-types tests/**/*.test.ts`). Without
   `backend/.env` they fail **on connection, not on logic** — 5 environmental failures
   is the expected state on a fresh clone. `tests/audit_chain.test.ts` (16 assertions on
   the hash formula and four tamper vectors) is the one that must never go red.

**Python is not available on this box.** For ad-hoc verification write a throwaway Node
ESM script, not a `.py`.

---

## PART 3 — MEASURED STATE OF THE TREE

Every figure below was counted, with the command that counts it. Re-run them rather than
trusting this table after you have made changes — the previous version of this document
went stale precisely because it asserted counts nobody re-measured.

| Thing | Count | How to re-measure |
|---|---|---|
| Backend routers | **18** | `ls backend/src/routers/*.ts \| wc -l` |
| Router mounts in `server.ts` | **18** | `grep -c "app.use('/api" backend/src/server.ts` |
| HTTP endpoints | **38** | `grep -rhoE "router\.(get\|post\|patch\|put\|delete)\(" backend/src/routers/*.ts \| wc -l` |
| Backend services | **18** | `ls backend/src/services/*.ts \| wc -l` |
| Detectors | **4** | `cost_outlier`, `delay`, `duplicate`, `photo_reuse` |
| Rules in the YAML catalogue | **21** | `grep -cE "^  - id: R-" backend/src/rules/mplads_rules.yaml` |
| Tables | **19** | `grep -rhoE "^CREATE TABLE (IF NOT EXISTS )?[a-z_]+" supabase/migrations/*.sql \| sed 's/.*TABLE //; s/IF NOT EXISTS //' \| sort -u \| wc -l` |
| Migrations | **001–011** | `ls supabase/migrations/` |
| Routed frontend pages | **20** | count `<Route>` in `frontend/src/App.tsx` |
| Files in `frontend/src/pages/` | **25** | 5 are orphans — see below |

**The 19 tables:** `agencies alerts answer_key audit_events calibration_snapshots
constituencies digest_history districts documents evaluation_runs field_sync_queue
health_reports inspection_items inspections meta payments review_actions rule_probation
works`.

**Five orphan pages** — imported by nothing, routed to nowhere, left from an earlier
iteration: `AlertQueue.tsx`, `AuditLog.tsx`, `Dashboard.tsx`, `Digests.tsx`,
`FieldInspection.tsx`. They are superseded by `QueuePage`, `AuditPage`, `OverviewPage`,
`DigestPage`, `InspectionListPage`. **A file count in `pages/` is not a screen count.**
Deleting them is safe and unclaimed work.

### 3.1 Load-bearing contracts you must not break

**The audit chain formula** — matched byte-for-byte by `tests/audit_chain.test.ts`:

```
payload_hash = sha256(canonicalJson(payload))
this_hash    = sha256(`${seq}|${prev_hash}|${payload_hash}`)
genesis prev_hash = '0'.repeat(64)
```

`appendAudit(actor, action, entity_type, entity_id, payload = {})`. **Every state
mutation calls it. No exceptions.**

**The API envelope.** `frontend/src/lib/api.ts`'s `request<T>` returns `json?.data`, so
**every router must respond `res.json({ data: … })`**. A router that returns a bare
object silently delivers `undefined` to the page.

**Unique keys.** `alerts` is unique on `(work_id, origin_id)`; `health_reports` on
`(work_id, report_date)`. `reason_code` columns are plain `TEXT NOT NULL` with **no
CHECK constraint** — validation is in application code only.

**`WORK_STATUSES`** = `NOT_STARTED | IN_PROGRESS | COMPLETED | CANCELLED | ON_HOLD`.
**`SEVERITY_RANK`** = `CRITICAL:1, HIGH:2, MEDIUM:3, LOW:4` (lower rank = more severe).

**Determinism.** `Math.random()` is **banned**; use `makeRng(seed)` (Mulberry32,
`SEED = 12345`). Every generator date derives from `CORPUS_AS_OF = '2026-09-05'`, never
from the clock, so re-running on a different day reproduces the same corpus.

**Money is rupees as a number, everywhere.** Dates `YYYY-MM-DD`; timestamps ISO-8601 `Z`.
`formatCurrency` (frontend `lib/utils.ts`): ≥1e7 → `₹X.XX Cr`, ≥1e5 → `₹X.XX L`, else
`en-IN` grouping.

### 3.2 Where things live

| Path | What it is |
|---|---|
| `backend/src/types.ts` | **THE source of truth for every shape.** Read before declaring any type. Never shadow or duplicate. |
| `frontend/src/types.ts` | Frontend mirrors of the same shapes. Keep in lockstep with the backend file. |
| `backend/src/util.ts` | `canonicalJson`, `sha256`, `stableId`, `newId`, `daysBetween`, `monthsBetween`, `addDays`, `toMonth`, `median`, `percentile`, `mad`, `robustZ`, `fmtINR`, `haversineMeters`, `tokenSetRatio`, `jaccard`, `hexHamming`, `renderTemplate`, `makeRng`, `pick`, `randInt`. |
| `backend/src/db.ts` | `getDb`, `all`, `get`, `insert`/`insertMany`, `upsert`/`upsertMany`, `update`, `del`, `count`, `truncateAll`, storage helpers. **No `run`/`scalar`/`tx`/`exec`** — see §3.4. |
| `backend/src/http.ts` | `qstr`, `qnum`, `qbool`, `paging`, `actorOf`, `requireBody`, `requireString`, `requireOneOf`, `notFound`, `requireDemoMode`. |
| `backend/src/rules/mplads_rules.yaml` | **The compliance logic as versioned config.** The only place a rule ID may be minted. Plus `probation` and `alert_budget` config and the eligible/ineligible category lists. |
| `backend/src/services/audit_chain.ts` | `appendAudit`, `appendAuditMany`, `verifyChain`, `readAudit`, `chainHead`, `demoTamper`/`demoRestore` (DEMO_MODE-gated). |
| `frontend/src/lib/api.ts` | The one HTTP client, grouped by resource (`api.works.list`, `api.alerts.review`, `api.agencies.get`). Pages never fetch directly. There is no `useApi` hook — pages use `useEffect` + `useState`. |
| `frontend/src/components/ui.tsx` | The UI kit. `StatCard` variants: `'default' \| 'critical' \| 'warning' \| 'success' \| 'info'`, plus `colorScheme`, `trend`, `trendType`. |
| `frontend/src/lib/scheme_reference.ts` | `BENCHMARK_PCT_BY_VALUE` / `BY_COUNT` — the published figures, in one place. |
| `docs/API_CONTRACT.md` | The HTTP surface: base `/api`, error shape `{error:{code,message,details?}}`, the fixed analyze-pipeline order, queue ordering `severity_rank DESC, created_at ASC`, the mount list. |
| `docs/DATA_CONTRACT.md` | The CSV ingest field table, `payment_history` stage encoding, calibration reference aggregates, the integration ask. |

### 3.3 An unmerged branch you must look at before touching ingest

`git branch` shows **`wip/main-checkout-ingest`** (commit `bcd7ed1`, parented on
`07ab68e`). It is **not merged into `main` and must not be merged blindly.**

It preserves work that was sitting **uncommitted in the main checkout's working tree**
when the cleanup branch landed — roughly 1,300 lines across 34 files, dated 2026-08-27.
It was committed verbatim, byte-for-byte verified against the working tree, and only
then was `main` fast-forwarded, so nothing was lost. Its substantive content:

- **`backend/src/services/csv.ts` and `backend/src/services/corpus.ts`** with
  `backend/tests/csv.test.ts` and `corpus.test.ts` — a real CSV parsing layer
  (`parseCsv`, `CsvParseError`) that `main` does not have.
- **A different `backend/src/routers/ingest.ts`** — 498 lines, built on that parser.
  `main`'s version is 381 lines and took a different route. **These two genuinely
  conflict**; one has to be chosen deliberately.
- `data-gen/generate_ingest_test_csv.ts`, and changes to `heatmap.ts`, `meta.ts`,
  `public.ts`, `inspection.ts`, `state.tsx` that `main` does not carry.
- It also touches `OverviewPage.tsx`, `dashboard.ts` and `types.ts` — the same files the
  cleanup pass rewrote. **Take nothing from those three without reading `main`'s version
  first**; the WIP predates the fabrication cleanup and reintroducing its versions would
  bring the hardcoded figures back.

Suggested approach: cherry-pick the *new* files (`csv.ts`, `corpus.ts`, their tests,
the generator script) onto `main` first, verify the gate still reads 46/0/0, then
reconcile `ingest.ts` by hand. Do not `git merge` it wholesale.

### 3.4 Things this document used to claim that were never true

Kept deliberately, so nobody re-adds them from an old copy:

- **`docs/SERVICE_CONTRACTS.md` was never written.** The old handoff called it "the
  keystone" and said every service signature was "already pinned" in it. Nothing was
  pinned anywhere; the services were built from their call sites. **The authority for a
  module's signature is the module.**
- **`db.ts` never had `run`, `scalar`, `tx`, `upsertSql` or `dbPath`.** The old table
  listed all five, and described rows as null-prototype **node:sqlite** objects — this
  backend is Supabase/PostgreSQL and always was.
- **`exec()` did exist and is now removed.** It called a `SECURITY DEFINER raw_sql(query
  TEXT)` Postgres function that interpolated caller SQL — an unexercised SQL-injection
  sink. Nothing ever called it. Dropped in `supabase/migrations/011_drop_raw_sql.sql`
  and removed from both schema files.
- **These frontend files do not exist**: `frontend/src/theme.ts` (chart colours are
  inline), `frontend/src/api.ts` (it is `lib/api.ts`), `frontend/src/offline.ts` (no
  IndexedDB queue — `Inspection.synced` exists and the form posts straight to the API,
  so an inspection recorded offline is **lost, not queued**), and the three shells
  `OfficerShell`/`FieldShell`/`PublicShell` (officer, field and public routes all share
  one `MainLayout`, so the public tree is not visually separated and there is no EN/HI
  toggle).
- **`backend/scripts/` does not exist** — no `seed.ts`, `reset.ts` or `evaluate.ts`.
  Evaluation is computed live by `GET /api/insight/evaluation`; there is no CLI entry
  point and no persisted `evaluation_runs` row from a scripted run.
- **`docker-compose.yml` was never written.** The production shape is prose in
  `docs/ARCHITECTURE.md`.
- **`vite-plugin-pwa` is a dependency but is never registered in `vite.config.ts`.** The
  app is not an installable PWA. Do not claim it is.

---

## PART 4 — HONEST SECURITY POSTURE

State this accurately if asked; it is deliberately not papered over.

- **There is no authentication or authorisation.** `http.ts` reads a `Bearer` token and
  **discards it**, falling back to a client-forgeable `x-user-id` header, then to
  `'demo-officer'` when `DEMO_MODE === 'true'`. Do not describe the platform as having
  role-based access control.
- **`db.ts` uses the Supabase service-role key, which bypasses all RLS.** The RLS
  policies in `migrations/002_rls_policies.sql` exist and are correct, and the API does
  not go through them.
- The live Supabase project URL was **scrubbed from `README.md`**. No key rotation was
  needed: the `eyJhbGci…` fragment that was there is 8 characters of universal JWT
  header carrying no secret material, and `backend/.env` was never committed.
- The `raw_sql()` SQL-injection sink is **removed** (see §3.4).
- The public-view whitelist is the one access control that genuinely holds, and
  `tests/public_leakage.test.ts` is what holds it.

---

## PART 5 — WHAT WAS JUST FINISHED (the cleanup pass)

All **28 F-items** in `C:/sih_antigravity/CODE_CHANGES.md` are complete. That file is
**not in the repo** — it is untracked in the main checkout at
`C:/sih_antigravity/CODE_CHANGES.md`. Read it by absolute path; it is the plan document
and Part 2 of it is the remaining feature backlog.

The pass had one theme: **remove every number the UI stated but had not measured.** A
partial inventory of what was found and fixed, useful mainly as a map of where this
codebase's failure modes cluster:

- `AgenciesPage.tsx` made **zero API calls** and rendered four hardcoded agency rows,
  "14.2 Mo" average pacing and "DRDA — 88.4% timely execution".
- `OverviewPage.tsx` charted a six-month financial series from **literal rupee figures**
  with only the last point wired to anything real; rendered "Released to Agencies" as
  **`total_sanctioned * 0.62`** in two places; badged "24.1% utilized" as a string;
  carried "+14.2%", "+2.1% YoY" and "88.4% pace" as StatCard trends, all three with an
  upward arrow regardless of the data; charted "Peak Casework Velocity" with a
  "Thursday Peak" caption over a Monday-to-Friday literal — **nothing in the schema
  records when an officer opened a case**, so that chart measured nothing at all; and
  showed a hardcoded `FY 2024–26` window chip.
- `GET /dashboard/districts` handed **every district the global open-alert count** —
  four identical numbers on the canonical four-district corpus, each roughly 4× the
  real load, which is why it read as a coincidence and survived.
- `DashboardStats.works_by_category` was returned as `{}` with a `// TODO: compute`
  beside it. An empty map is not neutral: it says every category has zero works.
- `sla_engine.ts` swallowed its upsert error, and reverted reviewed alerts to `OPEN`
  with a fresh `newId()`. Both SLA implementations had a `Math.abs` signed-interval bug;
  `avgDays` had a wrong denominator; a third divergent `SLAStats` shape existed;
  `/sla/stats` filtered status on a non-enum value.
- `works.updated_at` was never written, so **R-015 measured every hold as zero days.**
- The running-bill budget released **more than sanctioned on ~30% of paid works.**
- `evaluation.ts` counted every alert on an unkeyed work as a false positive;
  `PLANTED_ANOMALY_TYPES` excluded every value `answer_key` actually held; R-011's
  ineligible list shared **no value** with the accepted categories, so it could not fire.
- `HealthReportForm.tsx` fabricated `evidence_image_key`. The inspection form defaulted
  all eight checklist items to **checked**.
- R-021 was in neither the answer key nor `UNCOVERED_RULES`. `full_schema.sql` embedded
  200 stale works. 11 of 37 endpoints were undocumented.

**The new artifact worth understanding before you touch it** —
`backend/src/services/agency_performance.ts`, served by `routers/agencies.ts` at
`GET /api/agencies` and consumed entirely by `AgenciesPage.tsx`:

A league table on raw completion rate ranks **portfolios, not agencies** — an agency
handed forty ₹2 lakh handpumps out-completes one handed four ₹5 crore bridges every
time. So each completed work is compared against the **corpus-wide median duration for
its (category × size-band) cell**, and an agency's `pacing_index` is its total actual
days over its total expected days. 1.00× means it delivers *its own mix of work* at the
corpus median; 1.30× means 30% longer than the same work takes elsewhere. Four
properties are load-bearing and easy to break:

- The expectation is built **corpus-wide, never per-agency** — a per-agency expectation
  compares each agency to itself and puts everyone at exactly 1.0 by construction.
- `MIN_CELL_SIZE = 3`, falling back cell → category → corpus, and a work with no
  expectation at any level is **excluded, not assigned an invented one**.
- Nulls **sort last**. A null sorting to the top of an ascending list is exactly how an
  agency that has completed nothing gets presented as the best performer.
- The measured sample size **travels with every index** in the UI. An index over two
  works and one over eighty look identical otherwise, and the first is not a
  performance figure.
- There is deliberately **no "timely execution rate"**. It needs a per-work deadline,
  and `works.completion_target_date` is populated for roughly a fifth of works
  (`data-gen/generate.ts:788`) and is **absent from the CSV ingest contract entirely**.
  Scheme-timeline breaches are reported as R-006 alerts, which is where that finding
  belongs.

`DashboardStats.trend` is now genuinely computed (`routers/dashboard.ts:computeTrend`) —
a monthly rollup over `works.sanction_date`, `works.actual_completion_date`,
`payments.payment_date`, `alerts.created_at` and `alerts.reviewed_at`. Interior months
are filled so a quiet month reads as quiet rather than as a gap in the axis; months
outside the observed range are **not** padded, because a zero is a measurement and an
absent row is not. `released` comes from `payments`, not `works.released_amount` — that
column is a running total carrying no date, so no month can be attributed to it. **There
is no `expenditure` series and must not be**: `works.expenditure` has the same defect
with no substitute.

### 5.1 Rule verification-status decisions taken, and why they are blocked

Three changes, all pending the same non-code blocker (**the official 2023 MPLADS
guidelines PDF**):

- **R-006** stays `NEEDS_VERIFICATION`.
- **R-017** promoted `PLATFORM_POLICY` → `NEEDS_VERIFICATION`.
- **R-011** demoted `VERIFIED` → `NEEDS_VERIFICATION`.
- Three new `fund_flow_regimes` all sit at `NEEDS_VERIFICATION`.
- **R-019** remains `PLATFORM_POLICY` and is now accurately described.
- **R-010** stays `PLATFORM_POLICY` but is newly declared **dormant** — it needs
  perceptual-hashable evidence images, which the generator does not produce, so its
  recall is *unmeasurable* rather than zero.

### 5.2 The vintage adjustment (verified numerically, keep the numbers)

Window **1027 days**; matured fraction (1027−365)/1027 = **0.64460**; matured sanctioned
**₹4,306.09 Cr**; adjusted completion rate **78.66%**; overdue **₹918.71 Cr**. The count
basis works out to **96.00%** — saturated, and deliberately **not shipped**, because a
saturated metric looks like excellent performance and is really an artifact of the
denominator. All of it is derived in `services/calibration.ts`, never hardcoded.

---

## PART 6 — WHAT TO BUILD NEXT

`CODE_CHANGES.md` Part 2 lists **17 feature gaps (P-01 … P-17)** across the four
authority roles, each with a **tier label that is a commitment — ship it in the UI next
to the feature**. Its own execution order says: build **P-01, then P-15, P-04, P-06,
P-03**. **P-12 is already delivered** as the agency-performance work above.

**P-01 · Free-text eligibility screening · Tier 1 · highest value in the plan.**
An MP's recommendation arrives as prose: *"construction of community hall cum marriage
hall near the Hanuman temple, Ward 7."* The guidelines carry a long annexure of
eligible/ineligible items. This is a **text-understanding problem, not a lookup**, which
is precisely why R-011 is dead: it checks a 15-value dropdown while the eligibility
signal lives in the description the dropdown throws away. Build a retrieval-augmented
classifier over the annexure returning *eligible / ineligible / needs human review*
**with the specific clause quoted back** — the citation is what makes it usable and what
satisfies Doctrine 7. Data you have: `title`, `description`. Data you need: **the
annexure as text — the single highest-value document to obtain, and a hard blocker.**
Why first: **₹6,654.76 Cr of recommendations never reach sanction**, roughly twice the
value stalled *after* sanction, and this is the only feature that acts on that pool.

**P-15 · Natural-language questions over the corpus · Tier 1 · faked today.**
Text-to-SQL against a **read-only view**, with the **generated query displayed** to the
officer — auditable (Doctrine 7), cannot mutate (Doctrine 1). Converts the worst
integrity liability in the product into its best demo, reusing an interface that already
exists. Shares a screen with P-01 naturally.

**P-04 · Document AI on UCs, certificates and bills · Tier 1 · total gap.**
OCR → key-value extraction → cross-field consistency against the portal record,
surfacing only mismatches. The data model currently reduces this to `has_uc BOOLEAN` and
a `uc_date` nothing reads. The largest volume of pure drudgery in the workflow and the
most AI-native task in the scheme.

**P-06 · Evidence photo verification · Tier 1 · existing piece dead.**
Five distinct checks hide inside "verify the photo" — **do not conflate them**: geotag
inside the project area (Tier 3, pure EXIF, do not call it AI); same photo reused across
works (perceptual hashing — honest label **computer vision, not machine learning**); does
the image show the asset type claimed (Tier 1); completed asset or a foundation (Tier 1,
harder, and where the money leaks since payment is gated on completion); manipulated,
re-photographed off a screen, or synthetically generated (Tier 1, the most contemporary
angle available).
**Critical design constraint:** e-SAKSHI **permits uploading corrected photographs**, so
photo replacement is a sanctioned routine operation and a naive reuse-or-change detector
will flag legitimate corrections. Treat "image changed" as normal and reason about the
*sequence*. **Confirm the retention behaviour before asserting the ledger argument** — if
e-SAKSHI does version images, pitch the hashing as independent corroboration instead.

**P-03 · Pre-sanction duplicate detection · Tier 2 · cheap upgrade.**
Keep the 2-of-3 architecture. Three improvements: swap `tokenSetRatio` (a Dice
coefficient over token sets, purely lexical — it misses *"CC road"* vs *"cement concrete
road"*, *"Anganwadi Kendra"* vs *"Anganwadi Centre"*, and any transliteration or
paraphrase) for **multilingual sentence embeddings**; use `description`, which is
currently discarded entirely; and **run it at recommendation time, not only post-hoc** —
free change, large value.

**On P-02, be precise:** the MAD z-score detects works expensive **relative to peers**,
not works that breach the Schedule of Rates. An engineer in the room will know the
difference.

### 6.1 Non-code blockers (cannot be written in code)

1. **MPLADS guidelines annexure as text** — hard blocker for P-01 and for every
   `NEEDS_VERIFICATION` in §5.1.
2. **State PWD Schedule of Rates** — needed for P-02's real form.
3. **Screenshots of the live e-SAKSHI report menu** — settles how much incumbent overlap
   is real *before* any "they don't have this" claim.
4. **Clause and page numbers for every Part F answer** — sources are named but not
   pinpointed; "where does it say that?" needs an exact citation.
5. **Confirmation of e-SAKSHI photo retention behaviour** — decides P-06's framing.
6. **Current district count** — the ~780 figure is domain knowledge, not sourced.

### 6.2 Small unclaimed work, in rough value order

- Delete the five orphan pages in `frontend/src/pages/` (§3).
- Register `vite-plugin-pwa` in `vite.config.ts` or drop the dependency and the PWA
  claim.
- Build the offline inspection queue (`frontend/src/offline.ts`); `idb` is already a
  dependency and `Inspection.synced` already exists.
- Produce perceptual-hashable evidence images in `data-gen` so R-010 leaves
  `UNCOVERED_RULES`.
- Take on the 46 backend typecheck errors as their own task.
- Separate the public tree from the officer shell and add the EN/HI toggle.

---

## PART 7 — THE DEMO

The 4-minute golden thread in `docs/DEMO_SCRIPT.md`: **Overview** (the completion gap) →
**Queue** → **Alert detail** (explainability + reason codes) → **Inspection** → **Audit
tamper demo** (goes red, then green) → **Evaluation** (measured precision/recall against
the answer key, or `—` for any metric with a zero denominator) → **Calibration** (the
corpus deviation from 50.71%-by-value and 61.88%-by-count, whatever it turns out to be)
→ **Readiness** (the field-by-field integration ask — DRISHTI's own 21-column proposal;
no official MoSPI column list was ever located, and the screen says so).

**The closing frame, which is true of the architecture as built:**
*"Explainable statistics where statistics suffice; AI only where the input is
unstructured — free text, scanned documents, photographs, speech — because that is where
rules genuinely cannot reach."*

---

## APPENDIX — house rules that trip people up

- Relative imports **carry `.ts`**. Type-only imports use **`import type`**.
- No `enum`, `namespace`, parameter properties, or decorators.
- Money is **rupees as a number**, everywhere. Dates `YYYY-MM-DD`; timestamps ISO-8601 `Z`.
- **Every state mutation calls `appendAudit()`.** No exceptions.
- **`Math.random()` is banned.** Use `makeRng(seed)`.
- Express 5 auto-forwards async rejections — `throw new ApiError(...)`, don't build error
  responses in handlers.
- Every router responds `{ data: … }` or the frontend receives `undefined`.
- **Never render an unmeasured quantity as a number.** `null` → `'—'`, with prose saying
  why.
- Read the module you are importing from. There is no pinned-signature document.
- A stale `.tmpcheck/` dir may exist at repo root (gitignored) — throwaway, delete it.
