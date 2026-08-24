# HANDOFF — MPLADS Insight & Integrity Platform

**SIH 2026 · Problem Statement SIH26102 (MoSPI / DIID)**
Read date for all external figures: **2026-08-23**. Node **24.11.1**, npm workspaces, Windows dev box.

This document is written to be picked up cold in a new IDE with no prior chat
context. It has three parts: **what we are building and why**, **what is already
built** (with the reasoning baked into each file), and **exactly what to build
next** (in dependency order, with the signatures already pinned).

---

## PART 1 — WHAT WE ARE BUILDING

### 1.1 The one-paragraph pitch

MPLADS (Members of Parliament Local Area Development Scheme) sanctions ~₹4,466 Cr
but only ~₹859 Cr worth of works are recorded complete — **~19.24% completion by
value**. The public dashboard shows only aggregates; the work-level detail lives
in the e-SAKSHI portal behind a login. We are building a **read-only review layer
that sits on top of e-SAKSHI** — it never writes back — that turns that pile of
work records into a **prioritised worklist for a monitoring officer**: which works
are stalled, which have money released ahead of progress, which look duplicated,
which are missing utilisation certificates. Two modules: **completion assurance**
(close the 19% gap) first, **integrity** (explain part of the gap) second.

> The framing that must survive every design decision:
> **"e-SAKSHI is the ledger. This platform is the auditor's worklist."**

### 1.2 The hard constraint that shapes everything

**We are students. We cannot get e-SAKSHI data access.** Winning SIH is what
unlocks government backing. So the MVP is **not a pilot on real data — it is a
self-contained demonstration vehicle** that proves the idea is real, correct, and
deployable. Consequences that are already designed in:

- The demo runs on a **synthetic corpus (~2,000 works) with a planted answer key**
  (~120 anomalies of 8 types). Because we planted them, we can compute **real
  measured precision/recall** on the `/evaluation` screen — not claims, measurements.
- A **calibration screen** shows the synthetic corpus sits near the *shape* of
  the real published aggregates (completion ratio within a few points of 19.24%).
- A **"Day-1 readiness" screen** enumerates the exact ~21-column ask of MoSPI, so
  an official can see integration is one nightly SFTP export, not a rebuild.

### 1.3 Product doctrine (these are non-negotiable, enforced structurally)

1. **Read-only.** This platform never writes to e-SAKSHI. It is a review layer.
2. **Severity tiers with reason codes, never a composite 0–100 risk score.** A
   number invites ranking people; reason codes invite investigation.
3. **No MP-level risk aggregation anywhere in the API.** An MP's name is a fact on
   a work record; it is never a subject of aggregation in an integrity context.
   ("Constituency X's MP has 14 flagged works" is a political weapon, not a
   finding.) SC/ST allocation (R-016) and inspection coverage (R-017) are reported
   as **compliance statistics**, not risk.
4. **The public/citizen view is a whitelist, never a blacklist.** `PublicWork` is
   built by explicitly naming safe fields, never by deleting keys off a `Work`.
   `tests/public_leakage.test.ts` enforces it and must not be weakened. Nothing
   about alerts, severity, reason codes, confidence, officers, or the answer key
   may reach a public response.
5. **Honesty contract on rules.** Every rule declares `verification_status`:
   `VERIFIED` (arithmetic/scheme design), `NEEDS_VERIFICATION` (threshold believed
   right, not yet checked against the official 2023 guidelines PDF), or
   `PLATFORM_POLICY` (an operational threshold we chose). The UI shows the marker.
6. **A rule must never fire on a null field.** Missing data is a data-quality
   finding at most, never evidence of wrongdoing.
7. **Explainable detectors.** Robust MAD z-score for cost outliers (not
   IsolationForest) — "3.4× the district median for this category" is followable
   by an officer. Duplicate detection needs **2-of-3** corroboration (text +
   geo + amount). Photo-reuse is **cross-work only**.
8. **Officer-trust machinery.** *Rule probation* auto-suspends a rule dismissed
   too often (below 40% actionable over 25 reviews). *Alert budget* caps open
   alerts at 10 per district; the rest go to a visible BACKLOG, never hidden.
9. **Tamper-evident audit ledger.** Hash-chained append-only log; a live tamper
   demo makes `/verify` go red on the edited row. Honest claim: **retroactive
   edits cannot be silent** — NOT "blockchain-grade immutability."
10. **Synthetic data is always labelled synthetic** and never presented as a real
    finding about a real person or agency.

### 1.4 The stack (and why)

- **Node 24 native TypeScript** — type-stripping, no build step, no `tsx`. Files
  run directly (`node src/server.ts`). This is why relative imports carry `.ts`
  and why `enum`/`namespace`/parameter-properties/decorators are banned.
- **`node:sqlite` built-in** — zero native deps, boots on any machine with Node
  22.6+. Schema is kept PostgreSQL-portable (no SQLite-only SQL, geo in app code).
- **Express 5** backend (async handlers auto-forward rejections to the error
  middleware — do **not** wrap handlers in try/catch to build responses).
- **React 19 + Vite 7 + Tailwind 4 + react-router-dom 7 + Recharts 3 +
  vite-plugin-pwa** frontend.
- **No GPU, no Docker required** — itself a procurement argument for government.

---

## PART 2 — WHAT IS ALREADY BUILT

**~20 files. The entire shared spine + 16 passing tests.** The spine was written
by hand deliberately, so the parallel feature build has one consistent surface and
agents/developers cannot each invent their own shapes.

### 2.1 Backend spine (done, do not rewrite)

| File | What it is |
|---|---|
| `db/schema.sql` | **Canonical schema, 19 tables.** `works` (~40 cols), `alerts` (with `severity_rank`, `UNIQUE(work_id, origin_id)`, `in_budget`), `audit_events` (`seq`, `payload_hash`, `prev_hash`, `this_hash`), plus demo-only `answer_key` and `evaluation_runs`. |
| `backend/src/types.ts` | **THE source of truth for every shape.** Read it before declaring any type. All domain types, all API envelopes, `SEVERITY_RANK`, `WORK_CATEGORIES`, `PLANTED_ANOMALY_TYPES`, `INSPECTION_CHECKLIST`, `DISMISS_REASON_CODES`. |
| `backend/src/util.ts` | `canonicalJson`, `sha256`, `stableId`, `newId`, date maths, `fmtINR`, `haversineMeters`, `median`/`percentile`/`mad`/`robustZ`, `tokenSetRatio`, `jaccard`, `hexHamming`, `renderTemplate`, `makeRng` (seeded RNG — `Math.random()` is banned), `pick`, `randInt`. |
| `backend/src/db.ts` | `getDb`, `all`/`get`/`run`/`exec`/`scalar`/`count`, `tx` (nested-flattening), `upsertSql`, `truncateAll`, `dbPath`, `SCHEMA_VERSION='1.0.0'`. Rows are returned as **plain objects** (null-prototype rows from node:sqlite are copied). |
| `backend/src/http.ts` | Request helpers: `qstr`/`qnum`/`qbool`, `paging`, `actorOf`, `requireBody`, `requireString`, `requireOneOf`, `notFound`, `requireDemoMode`. |
| `backend/src/server.ts` | Express app, mounts all 13 routers in contract order, `ApiError`, `PORT=4000`, `DEMO_MODE`. **Imports 12 routers that don't exist yet** — that's intentional; the app won't boot until they're created. |
| `backend/src/services/audit_chain.ts` | **The tamper-evident ledger.** `appendAudit`, `appendAuditMany`, `verifyChain` (reports first break), `readAudit`, `chainHead`, `rowToAuditEvent`, `demoTamper`/`demoRestore` (DEMO_MODE-gated). Chain formula is exact — see below. |
| `backend/src/routers/audit.ts` | The one router that's done. `GET /audit`, `GET /audit/verify`, `POST /audit/_demo/tamper`, `POST /audit/_demo/restore`. |
| `backend/src/rules/mplads_rules.yaml` | **The compliance logic as versioned config.** 17 rules R-001…R-017, each with severity, params, `verification_status`, `evidence_template`, `applies_to_status`. Plus `probation` and `alert_budget` config and the eligible/ineligible category lists. |
| `backend/tests/audit_chain.test.ts` | **16 tests, all passing.** Asserts the hash formula byte-for-byte and catches four tamper vectors (edit payload, edit payload+hash, rewrite row, delete row) plus the demo flow. |

**The audit chain formula (load-bearing, matched by the tests):**
```
payload_hash = sha256(canonicalJson(payload))
this_hash    = sha256(`${seq}|${prev_hash}|${payload_hash}`)
genesis prev_hash = '0'.repeat(64)
```

### 2.2 Frontend spine (done, do not rewrite)

| File | What it is |
|---|---|
| `frontend/src/theme.ts` | **Validated palette** (colours computed via the dataviz validator, not eyeballed — command + ΔE results recorded in the header). `STATUS`, `SEVERITY_STYLE`, `useChartTokens`, `useThemeToggle`, `MARKS`, and a **CHART CONTRACT** comment block deciding every chart's form + a FORBIDDEN list. |
| `frontend/src/index.css` | Tailwind 4 `@theme` with all colour tokens; light/dark; `.card`, textures. **CSS is the single source of truth for colour**; theme.ts reads live custom properties. |
| `frontend/src/api.ts` | **The one HTTP client.** One named function per endpoint (all 42, in contract order), plus `useApi<T>` (with a loading-vs-refetching distinction so refetches don't flash skeletons) and formatters. |
| `frontend/src/state.tsx` | `AppStateProvider` — fetches `/api/meta` once, exposes `meta`/`district`/`districts`/`online`/`isSynthetic`/`demoMode`. |
| `frontend/src/App.tsx` | 3 shells, 18 routes, `OFFICER_NAV` (grouped Casework / How it decides / Does it work). **Imports 18 page components that don't exist yet.** |
| `frontend/src/components/OfficerShell.tsx` | Sidebar nav, district selector, meta line, light/dark toggle, synthetic banner. |
| `frontend/src/components/FieldShell.tsx` | One-column PWA shell, online/offline pill. |
| `frontend/src/components/PublicShell.tsx` | Separate citizen route tree, EN/HI language toggle, `PUBLIC_STRINGS` dictionaries. |
| `frontend/src/components/ui.tsx` | The UI kit: `Card`, `PageHeader`, `StatCard`, `HeroFigure`, `SeverityChip`, `VerificationBadge`, `Button`, `Select`, `TableView`, `Spinner`, `ErrorBox`, `EmptyState`, `Banner`, `SyntheticBanner`, etc. |
| `frontend/src/components/charts.tsx` | Chart kit. Bar forms are **HTML/CSS** (label clipping & missing-axis-band bugs made structurally impossible); Recharts kept only for line charts. `CompletionBar`, `DeviationBars`, `CategoryBars`, `TrendLines`, `ChartLegend`. |
| `frontend/vite.config.ts` | react + tailwind + PWA plugin, proxy `/api` → `:4000`. |
| `frontend/src/types.ts` | Re-exports backend types (`export * from '../../backend/src/types.ts'`). |

### 2.3 The three contract documents (READ THESE — they pin every seam)

- **`docs/API_CONTRACT.md`** — the HTTP surface. Base `/api`, money as rupees,
  error shape `{error:{code,message,details?}}`, the fixed analyze-pipeline order,
  queue ordering `severity_rank DESC, created_at ASC`, and the full router mount list.
- **`docs/DATA_CONTRACT.md`** — the ingest field table (21 columns: 10 required,
  11 required-null-allowed, plus optionals each disabling one named capability),
  the calibration reference aggregates, the integration ask, and the 6 synthetic-
  corpus requirements.
- **`docs/SERVICE_CONTRACTS.md`** — **the keystone.** The exact exported signature
  of every service/detector module more than one part of the system calls, plus
  the file-ownership map. **This is your build spec for Part 3.**

---

## PART 3 — WHAT TO BUILD NEXT (in dependency order)

Nothing here is guesswork — every signature is already pinned in
`docs/SERVICE_CONTRACTS.md`. Build bottom-up: the app cannot boot until the 12
missing routers exist (server.ts imports them), and routers depend on services,
which depend on data existing, which depends on the generator.

**Verify continuously:**
```bash
npm run typecheck      # both workspaces
npm test               # backend node:test
npm run dev            # API :4000 + web :5173
```

### Wave 0 — make it boot (do first, unblocks everything)
The synthetic corpus is the root dependency: no data ⇒ nothing to analyse.

1. **`data-gen/`** — the deterministic generator (owner note: *synth*).
   - `data-gen/generate.ts` → writes ~2,000 works + payments + documents +
     `answer_key` (~120 plants across the 8 `PLANTED_ANOMALY_TYPES`).
   - Uses `makeRng(seed)` — **never `Math.random()`**. Same seed ⇒ same corpus ⇒
     same evaluation numbers.
   - Must satisfy DATA_CONTRACT §5: completion ratio by value within a few points
     of **19.24%**, realistic clean records **including false-positive traps**
     (approved-delay works, genuine "phase II" works, honestly expensive works).
   - Generate perceptual-hash-able evidence images for the photo-reuse plants.
2. **`backend/scripts/seed.ts`** and **`reset.ts`** — wrap the generator + ingest.
3. **`backend/src/services/{csv,field_map,validator,ingest}.ts`** + routers
   **`ingest.ts`, `meta.ts`** (owner: *ingest*). Once `meta.ts` exists, the
   frontend's `AppStateProvider` stops erroring.

### Wave 1 — the decision engine
4. **`services/rule_engine.ts`** + **`services/probation.ts`** + `routers/rules.ts`
   (owner: *rules*). 17 rules against the YAML; the null-field rule (doctrine #6)
   is the critical correctness property.
5. **`services/benchmarks.ts`** + **`detectors/cost_outlier.ts`** +
   **`detectors/delay.ts`** (owner: *detect-cost*).
6. **`detectors/duplicate.ts`** + **`detectors/photo_reuse.ts`** (owner: *detect-dup*).
7. **`services/alerts.ts`** + routers `analyze.ts`, `works.ts`, `alerts.ts`
   (owner: *alerts*). This is the integration hub — `runAnalyze` runs the fixed
   pipeline order (benchmarks → rules → detectors → upsert → auto-resolve →
   budget → audit). **Get the upsert-preserves-officer-decisions behaviour right.**

### Wave 2 — the rest of the API
8. **`services/inspections.ts`** + routers `review.ts`, `inspection.ts` (owner: *review*).
9. **`services/digest.ts`** + routers `dashboard.ts`, `digest.ts` (owner: *dashboards*).
   Digest HTML must be self-contained (inline styles, tables, no JS) — email-safe.
10. **`services/{evaluation,calibration,readiness,public_view}.ts`** + routers
    `insight.ts`, `public.ts` + `backend/scripts/evaluate.ts` (owner: *insight*).
    **`public_view.ts` is the whitelist — and write `tests/public_leakage.test.ts`
    alongside it.**

### Wave 3 — the screens (18 pages under `frontend/src/pages/`)
Each consumes only `frontend/src/api.ts` + the UI/chart kits. Never fetch directly;
never re-declare a type. Follow the CHART CONTRACT in `theme.ts`.
- **fe-queue:** `QueuePage`, `AlertDetailPage` (the hero screens — the demo lives here).
- **fe-overview:** `OverviewPage`, `WorksPage`, `WorkDetailPage`, `AgenciesPage`, `CompliancePage`, `DigestPage`.
- **fe-proof:** `RulesPage` (serves both `/rules` and `/rules/:ruleId`), `IngestPage`, `AuditPage`, `EvaluationPage`, `CalibrationPage`, `ReadinessPage`.
- **fe-field:** `InspectionListPage`, `InspectionFormPage`, `PublicListPage`, `PublicDetailPage` + `frontend/src/offline.ts` (IndexedDB queue for offline inspections).

### Wave 4 — docs & the demo
- `README.md` (clone → `npm install` → `npm run seed` → `npm run dev`).
- `docs/ARCHITECTURE.md` (production shape: NIC/MeitY hosting, PostgreSQL, head-hash
  anchoring for the audit ledger, CERT-In audit, DPDP Act 2023, GIGW/WCAG).
- `docs/DEMO_SCRIPT.md` — the 4-minute golden thread: Overview (the 19% gap) →
  Queue → Alert detail (explainability + reason codes) → Inspection → Audit tamper
  demo → Evaluation (measured precision/recall) → Calibration → Readiness.
- `docker-compose.yml` as the documented production shape (not required to run the demo).

### Definition of done
`npm run dev` serves the officer product, field PWA, and public view; the audit
tamper demo goes red then green; `/evaluation` shows real measured precision/recall
against the answer key; `/calibration` shows the corpus near 19.24%; the 4-minute
demo runs end to end. **`npm test` green, `npm run typecheck` clean in both workspaces.**

---

## APPENDIX — house rules that trip people up

- Relative imports **carry `.ts`**. Type-only imports use **`import type`**.
- No `enum`, `namespace`, parameter properties, or decorators (Node strips types; it doesn't compile).
- Money is **rupees as a number**, everywhere. Dates `YYYY-MM-DD`; timestamps ISO-8601 `Z` (`nowIso()`).
- **Every state mutation calls `appendAudit()`.** No exceptions.
- **`Math.random()` is banned.** Use `makeRng(seed)`.
- Express 5 auto-forwards async rejections — throw `ApiError`, don't build error responses in handlers.
- One file, one owner (see the SERVICE_CONTRACTS ownership map). Import across boundaries against the pinned signature; don't edit another module's file.
- Housekeeping: a stale `.tmpcheck/` dir may exist at repo root (in `.gitignore`) — delete it, it's throwaway.
