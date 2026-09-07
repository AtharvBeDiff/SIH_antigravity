# DRISHTI — MPLADS Insight & Integrity Platform — API Contract

Base URL: `/api`
Data Format: JSON — every response is wrapped as `{ "data": … }`; errors as `{ "error": { "code", "message", "details"? } }`. The frontend client unwraps `.data`, so a router returning a bare value reaches the UI as `undefined`.
Currency: Amounts as numeric Indian Rupees (`INR`).
Dates: `YYYY-MM-DD`. Timestamps: ISO-8601 UTC (`Z`).

**37 endpoints across 17 routers.** This document covered 26 of them for a while: the
whole of `/dashboard`, `/heatmap`, `/quota`, `/sla` and `/health_reports`, plus
`/review/stats`, were live and undocumented — so a reader building against this
contract would have concluded that SLA tracking, reservation compliance and the
10-day health cadence were unbuilt. `backend/src/server.ts` is the authority on what
is mounted.

**No authentication is enforced.** `http.ts` reads a `Bearer` token and discards it
without decoding, falling back to a client-supplied `x-user-id` header and then to
`demo-officer`. The actor recorded in the audit ledger is therefore whatever the
caller claims to be. See §11.

---

## 1. Metadata & Ingest
- `GET /api/meta` — Returns platform schema version, demo mode status, synthetic corpus flag, and district list.
- `POST /api/ingest` — Ingest a work export as CSV. Reads the 22 columns in
  `docs/DATA_CONTRACT.md` §1; four are required headers. Responds with `count`,
  `payments_written`, `payments_rejected` (per-entry reasons, never a bare count of
  silently dropped rows) and `legacy_installment_rows_ignored`.
- `GET /api/ingest/history` — Past ingest runs, read from the `INGEST_ATTEMPT` rows of
  the audit chain, each with its chain hash.

## 2. Works & Projects
- `GET /api/works` — Paginated list of infrastructure works. Query params: `page`, `page_size`, `district_id`, `category`, `status`, `search`.
- `GET /api/works/:id` — Full work dossier including milestone progress, installment schedule, payments, documents, and active alerts.

## 3. Risk Triage & Alerts
- `GET /api/alerts` — Prioritized alert queue ordered by `severity_rank ASC, created_at ASC`. Query params: `district_id`, `severity`, `status`, `page`, `page_size`.
- `GET /api/alerts/:id` — Single alert casework dossier with explainable algorithmic evidence, work record, and audit history.
- `PATCH /api/alerts/:id` — Officer review action. Body: `{ action: "ACKNOWLEDGED" | "DISMISSED" | "ESCALATED", dismiss_reason?: string, note?: string }`.

## 4. Pipeline & Analysis
- `POST /api/analyze` — Trigger complete compliance pipeline (benchmarks → rule engine → detectors → budgeting → audit ledger).
- `GET /api/analyze/status` — Status of active or latest analysis pipeline execution.

## 5. Compliance Rules & Probation
- `GET /api/rules` — Catalog of every rule in `backend/src/rules/mplads_rules.yaml` (21 at present) with verification status (`VERIFIED`, `NEEDS_VERIFICATION`, `PLATFORM_POLICY`) and live probation state. Any `rule_id` appearing on an alert resolves here.

  A rule may carry `dormant_reason`. That means it is enabled and implemented and still
  cannot fire, because the field it reads has no writer — R-010 compares
  `works.evidence_image_key` and nothing populates that column. A client must not
  present a dormant rule as an active check: its silence is not a finding, and reading
  it as one turns "we cannot look" into "we looked and found nothing". `enabled: false`
  is a different thing entirely — an operator switched the rule off.
- `GET /api/rules/:ruleId` — Specific rule detail with `probation` state. Returns the same rule object as the list, so `dormant_reason` applies here too.

## 5a. Review Statistics
- `GET /api/review/stats` — Counts of officer review actions: `{ total_reviews, by_action }`, where `by_action` maps each `AlertStatus` an officer has recorded to its count. Read from `review_actions`, the append-only record of officer decisions — not from `alerts.status`, which holds only each alert's current state.

## 6. Cryptographic Audit Ledger
- `GET /api/audit` — Sequential stream of cryptographic audit blocks.
- `GET /api/audit/verify` — Mathematical chain verification (`valid: boolean, checked: number, first_break: null | object`).
- `POST /api/audit/_demo/tamper` — (Demo mode only) Simulate malicious state mutation at a block sequence.
- `POST /api/audit/_demo/restore` — (Demo mode only) Restore corrupted block to valid cryptographic hash.

## 7. Inspections (Field PWA)
- `GET /api/inspections` — List geotagged field inspection reports.
- `POST /api/inspections` — Create/sync field inspection report with 8-point checklist and GPS coordinates.
- `GET /api/inspections/:id` — Inspection detail with checklist findings.

## 8. Executive Digests
- `GET /api/digest` — List past generated district digests.
- `POST /api/digest/generate` — Compile self-contained email-safe HTML digest.
- `GET /api/digest/:id` — Download or view digest HTML document.

## 9. Insights & Calibration
- `GET /api/insight/evaluation` — Precision, recall, and F1 measured against `answer_key`, which `data-gen` writes (797 rows across 11 anomaly types on the seeded corpus). Returns `null` for any metric whose denominator is zero, never a placeholder.

  Two fields state the scope, and a caller that omits them will overstate what the figures cover:

  - `covered_rule_ids` — the rules the answer key has ground truth for. Precision and recall are computed over **these only**.
  - `unscored_alerts` — alerts from rules outside that set. Neither credited as true positives nor penalised as false positives, because the key has nothing to say about them. The uncovered rules are those whose ground truth is emergent (R-001's per-category cost outliers, R-009's duplicate detection — both defined against the whole corpus, not one work), needs artifacts the generator does not produce (R-010's photo hashes), is a compliance statistic rather than an alert (R-016, R-017), or — for R-021 alone — has simply not been written. `data-gen`'s `UNCOVERED_RULES` records which is which; this field cannot distinguish them, so a caller reporting the figure should not imply the corpus is the limit in every case.

  Recall here measures **pipeline fidelity**: the key is the generator's own restatement of each rule's physical condition, so a miss means the condition did not survive the catalogue, the status filters, probation and the alert store. It is not evidence that a rule would catch genuine wrongdoing.
- `GET /api/insight/calibration` — The corpus's own completion rates against the published MPLADS figures, on **both** bases: by value (50.71%) and by count (61.88%). The two differ by over eleven points, so a single "completion rate" is ambiguous and each is reported against its own reference.

  The source is the aggregate placed before the **Standing Committee on Rural Development** for 1 Apr 2023 – 22 Jan 2026, not a MoSPI publication — this line called it "the official MoSPI benchmark", which named the wrong body. `services/calibration.ts` derives both rates from the four published totals rather than hardcoding them, so the arithmetic is checkable.

  `corpus_completion_rate*` and both `deviation_pct*` fields are `null` on an empty corpus. They must not fall back to the benchmark: that produces a deviation of exactly 0 and renders an empty database as perfectly calibrated. `by_category[*].reference_pct` is `null` for every category because the published aggregates carry no category split; filling it with the scheme-wide figure would assume every category completes at the same rate, which is the assumption this comparison exists to test.
- `GET /api/insight/readiness` — DRISHTI's proposed integration schema: each requested field, its target column, and whether anything populates it today. A target mapping, not a certification, and not an external MoSPI requirement.

## 9a. Sanction-Decision SLA
- `GET /api/sla/stats` — Aggregated statistics for the 45-day sanction-decision window (R-020 breach, R-021 early warning). Both thresholds are read from `mplads_rules.yaml`, so a YAML edit moves this tile and the alerts together.

  The counts **partition** the works with no sanction date on record, and two of the five are not findings:

  - `breached`, `atRisk`, `safe` — still awaiting a decision, measured from the recommendation date.
  - `rejected` — a decision was taken, but there is no `rejection_date` column, so whether it landed inside the limit is unknown. **Not a breach.**
  - `notTrackable` — no usable recommendation date, so the clock has no start (Doctrine 6).

  `avgDays` is `null`, never `0`, when nothing measurable is pending — `0` would read as "decisions are instantaneous", the opposite of "we cannot tell". `measuredCount` says how many works the average is over.
- `POST /api/sla/evaluate` — Re-run the SLA engine and persist its alerts. Responds `{ alerts_upserted, breached, at_risk }`.

  `alerts_upserted` counts **rows written**, which includes alerts that already existed and were recomputed in place. It is not a count of newly discovered breaches. Alerts an officer has already reviewed keep their status, reviewer, timestamp and dismissal reason; only the evidence text and day count are recomputed. Audited as `SLA_ALERTS_EVALUATED`, or `SLA_ALERTS_SKIPPED` when both rules are disabled or suspended — a run that wrote nothing because the rules were off is distinguishable in the ledger from a run that found nothing.

## 9b. Compliance Statistics (not risk)
Doctrine #3 applies: nothing in this section is ranked, and nothing is attributed to a named Member of Parliament. These are compliance statistics about a portfolio, not risk scores.

- `GET /api/quota` — SC/ST reservation compliance (R-016). Query param: `district_id`.

  The denominator is **`entitlement_periods` × ₹5 Cr** — the annual entitlement per constituency per financial year — not the district's own sanctioned total. A share of the portfolio in itself is not the guideline's test. `scsp_pct` and `tsp_pct` are `null` when the denominator is zero, and `works_missing_recommended_date` reports how many works were excluded for want of a date, so a caller can see that the percentages understate rather than assume they are complete.
- `GET /api/quota/inspection` — Physical inspection coverage (R-017). Query param: `district_id`.

  The population is **works under implementation**, not completed assets. `inspections_outside_population` counts real field visits to works outside that population — genuine effort this particular mandate does not measure, reported rather than discarded so coverage is not read as total effort.

## 9c. Activity Heatmap
- `GET /api/heatmap` — Daily activity counts across works sanctioned, works completed, payments and inspections. Query param: `district_id`. Each element is `{ date, count, worksSanctioned, worksCompleted, payments, inspections }`, sorted ascending by date; `count` is the sum of the four.

  **Known limitation:** `district_id` filters works only. Payments and inspections are counted corpus-wide regardless of the filter, so a district-filtered response mixes one district's works with every district's payments. Fixing it needs a join through `payments.work_id` and `inspections.work_id`.

## 9d. Work Health Reports (the 10-day check-in)
- `GET /api/health_reports` — Reports newest first. Query param: `work_id` (omit for the 100 most recent across the corpus).
- `POST /api/health_reports` — File a report. Body: `{ work_id, progress_pct, reported_by?, report_date?, evidence_image_key?, remarks? }`. `work_id` and `progress_pct` are required. Audited.

  `evidence_image_key` is **optional** deliberately. Requiring it meant an inspector without a photo could file nothing at all, and a work with no report is indistinguishable from a work nobody visited — which is exactly what R-019 exists to surface. A report without a photo is a weaker record, not a worse outcome than no record.

  This router does **not** swallow a missing-table error. It used to answer `200 []` when `health_reports` did not exist, so a caller could not tell "no reports filed" from "nowhere to file them".

## 9e. Dashboard Aggregates
- `GET /api/dashboard` — Corpus aggregates. Query param: `district_id`. Returns `DashboardStats`: work and value totals, `completion_rate_by_count` / `completion_rate_by_value`, `open_alerts`, `backlog_alerts`, and the `works_by_status` / `works_by_category` / `alerts_by_severity` breakdowns.

  `alerts_by_severity` covers **OPEN and BACKLOG only** — reviewed and dismissed alerts are excluded, so it is a measure of live queue load, not of everything the pipeline ever raised. `trend` is `null`: the monthly series is not computed, and `null` rather than `[]` so a client cannot chart "no activity in any month" by accident. The two completion rates are the **corpus's own** ratios; comparing them to the published 50.71% / 61.88% figures is `/api/insight/calibration`'s job.
- `GET /api/dashboard/districts` — Per-district `{ district, total_works, open_alerts }`. `open_alerts` is counted through the `works` FK, so it is that district's load; it previously omitted the predicate and handed every district the global total.

## 10. Public Citizen Portal (Doctrine #4: Whitelist Only)
- `GET /api/public/works` — Searchable public infrastructure directory strictly containing safe public fields.
- `GET /api/public/works/:id` — Public work asset detail guaranteed to exclude all internal risk scores, alerts, and officer notes.

  The guarantee is an explicit field whitelist in `services/public_view.ts`, enforced by
  `backend/tests/public_leakage.test.ts` — a new internal column is excluded by default
  rather than by remembering to exclude it.

## 10a. Ask the Corpus — natural-language questions (text-to-SQL)

- `GET /api/query/status` — Whether the feature can be used, and under what limits. Returns `{ available, reason, model, readable_relations, max_rows, statement_timeout_ms }`.

  `available: false` with a `reason` when no model credential is configured. **200, not 503**: a deployment without a key is a fact about the deployment, and the UI needs to render an honest disabled state rather than a text box that always fails.

- `GET /api/query/examples` — Questions known to translate well, each with a one-line reason. Not decoration: a blank box in front of a text-to-SQL system produces unanswerable questions, and the officer reads the resulting error as the product being broken. Every example aggregates by agency, district, category or rule — never by elected representative — so the affordance leads toward questions the platform will answer.

- `POST /api/query` — Body: `{ question: string }`, max 500 characters. Returns `{ question, sql_generated, sql_executed, relations, truncated, rows, row_count, columns, model, latency_ms: { model, database }, audit_seq }`. Audited on every execution **and on every rejection**.

  `POST` for a read, deliberately: it appends to the audit ledger, a question belongs in a body rather than a URL, and a GET would put the question in every intermediary's logs.

  `sql_generated` and `sql_executed` differ — the row cap wraps the model's query rather than appending to it. Both are returned because the answer's provenance is part of the answer (Doctrine 7). `truncated` is true only when the cap was **binding and reached**; a 12-row answer is not truncated merely because no `LIMIT` was written.

  **Three layers stand between the question and the database**, and each assumes the previous may have failed:

  1. The prompt (`services/nl_query.ts`) describes only the eleven allowlisted relations and never names `mp_name`. This shapes output; it constrains nothing. A quality measure, not a security control.
  2. The guard (`services/sql_guard.ts`) is an allowlist that fails closed — single `SELECT`, no CTE, no dollar quoting, no quoted identifiers, no catalogue access, no Doctrine-3 column, allowlisted relations only. 54 adversarial tests in `backend/tests/sql_guard.test.ts`, which **must not be weakened**.
  3. The database (`supabase/migrations/012_readonly_sql_role.sql`) executes through `drishti_readonly_select`, whose body runs `SET TRANSACTION READ ONLY`. Postgres refuses any write regardless of what text got through — including a data-modifying CTE, and including constructs the guard has never heard of. This is the layer that survives a bug in the other two.

  Errors: `503 LLM_UNCONFIGURED` (no credential — checked before the actor is resolved, so a keyless deployment does not report an authentication problem instead), `400 UNSAFE_QUERY` (the guard refused; `details.sql` carries the SQL), `422 QUERY_FAILED` (Postgres refused, usually an invented column; distinguished from `UNSAFE_QUERY` because the officer's next action differs — rephrase, versus this question is not permitted), `502 LLM_AUTH`, `504 LLM_TIMEOUT`, `502 LLM_FAILED`, `502 LLM_BLOCKED`.

  Three relations are deliberately **not** readable: `constituencies` (carries `mp_name`/`mp_party`; Doctrine 3 needs an enforcement point here because the query author is a model that has never read the doctrine), `audit_events` (read it through `/api/audit`, which verifies the hash chain as it reads), `answer_key` (evaluation ground truth — a query that can read it can flatter the detectors).

  The audit payload carries the question and both SQL forms but **not the rows**: the ledger is append-only and hash-chained, so result sets would grow it without bound and copy corpus data into a structure that is never pruned. The query text is reproducible, which is what makes the entry useful.

---

## 11. Authentication and access control — what does not exist

Stated plainly because the rest of this document would otherwise imply otherwise, and
because the audit ledger's value depends on it.

**There is no authentication.** `actorOf` in `backend/src/http.ts` takes the actor's
name from the client-supplied `x-user-id` header and returns it unverified, falling back
to `demo-officer` when `DEMO_MODE=true`. A `Bearer` token was previously read and
discarded without being decoded, under a comment promising JWT verification "in
production"; the token is no longer read, so the code no longer suggests a check that
never happened.

**There is no authorisation.** No roles, no permissions, no per-district scoping. Every
endpoint is reachable by every caller, including the mutating ones —
`PATCH /api/alerts/:id`, `POST /api/analyze`, `POST /api/ingest`,
`POST /api/sla/evaluate`, `POST /api/health_reports` and the demo tamper endpoints.

**RLS is bypassed.** `backend/src/db.ts` connects with the Supabase service-role key.
The row-level security policies in `supabase/full_schema.sql` are real and are not in
force for any request the API makes.

**This is why `POST /api/query` is fenced the way it is.** §10a executes model-generated
SQL, and the two facts above are the reason its guard is an allowlist and its execution
path is a read-only transaction rather than a `db.ts` helper: an unauthenticated caller
reaches a client that bypasses every RLS policy, so prompt injection through the question
would otherwise be a direct path to arbitrary SQL. Migration 012 bounds what a generated
query can *do*. It does not bound *who may ask* — that is this section's gap, and it is
still open.

**What this means for the audit ledger.** The chain is genuinely tamper-evident: the
`seq | prev_hash | payload_hash` construction means a recorded entry cannot be altered
or removed without `GET /api/audit/verify` reporting the break. What it does *not* do is
attest to the actor. An entry proves that this payload, naming this actor, was written
at this position and has not changed since. It does not prove that the named officer
was the one who acted. Integrity, not authenticity.

**To close it,** in dependency order: verify the Supabase JWT signature and read the
subject from its claims; issue a per-request client carrying the caller's token so RLS
applies instead of the service-role bypass; then add role checks on the mutating
endpoints. Until all three are in place, DRISHTI must not be presented as having
role-based access control — including in a demo.
