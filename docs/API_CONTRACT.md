# DRISHTI — MPLADS Insight & Integrity Platform — API Contract

Base URL: `/api`
Data Format: JSON — every response is wrapped as `{ "data": … }`; errors as `{ "error": { "code", "message", "details"? } }`. The frontend client unwraps `.data`, so a router returning a bare value reaches the UI as `undefined`.
Currency: Amounts as numeric Indian Rupees (`INR`).
Dates: `YYYY-MM-DD`. Timestamps: ISO-8601 UTC (`Z`).

**59 endpoints across 21 routers.** This document covered 26 of them for a while: the
whole of `/dashboard`, `/heatmap`, `/quota`, `/sla` and `/health_reports`, plus
`/review/stats`, were live and undocumented — so a reader building against this
contract would have concluded that SLA tracking, reservation compliance and the
10-day health cadence were unbuilt. `backend/src/server.ts` is the authority on what
is mounted. The surface has since grown with the AI features — Document AI (§10b),
Photo AI (§10c) and the semantic duplicate check (§2a) — and agency performance
(§9f); all four are documented below.

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

## 2a. Semantic duplicate check (P-03)

Mounted on the works router, so its URLs are `/api/works/*`, but it belongs to the same family as Document AI (§10b) and Photo AI (§10c): read-only, credential-gated, and **a finding, not an alert**. The batch detector R-009 (`detectors/duplicate.ts`) already flags duplicates, but its title test is `tokenSetRatio` — a bag-of-words overlap — so two records of the same work written in different words ("Construction of anganwadi centre" vs "Building of creche for children") share almost no tokens and never reach its 2-of-3 bar. This check compares *meaning* instead: it embeds each work's descriptive text (`title — category — location`) and ranks same-district peers by cosine similarity of those vectors. It sits beside R-009, not on top of it.

Unlike §10b/§10c it has **no persistent findings, no worklist and no check catalogue**: it mints no `alerts` rows, no `D-0xx`/`V-0xx` ids, enters no per-district alert budget, and is not scored against `answer_key`. It ranks candidates inline for a human and records one `WORK_DUPLICATE_CHECKED` audit event — an oversight action worth a ledger entry, not a finding against the work. Where a candidate pair *also* tripped R-009's deterministic corroboration that is reported (`also_flagged_by_r009`), a read-only cross-reference to `rule_id='R-009'` that changes nothing about R-009's own alert, severity, budget or evaluation.

The vector is cached in `work_embeddings` and reused. The cache key is the sha256 of the embedded text **and** the model name — a vector from another embedding model is not comparable (cross-model cosine is noise) — and a change to the pinned output dimensionality invalidates it too. A recompute supersedes the stale row rather than overwriting it, so the record of what was compared survives. JSONB, not pgvector: at district scale the comparison is one linear pass in application code (`util.ts:cosineSimilarity`). Full rationale in `supabase/migrations/015_work_embeddings.sql`.

- `GET /api/works/duplicate-check/status` — Whether semantic duplicate detection is configured. Returns `{ available, reason, model, dims, default_threshold, tier }`. **200, not 503**, when no credential is set — same contract as `/api/documents/status` and `/api/photos/status`: a keyless deployment renders an honest disabled state, and `reason` names `GEMINI_API_KEY` and reassures that the deterministic R-009 detector is unaffected. `dims` is the pinned output dimensionality or `null` for the model default. Declared **before** `/:id` so the literal path is never captured as a work id.

- `POST /api/works/:id/duplicate-check` — Rank the work's same-district peers by semantic similarity. Body, both optional: `{ threshold?, limit? }`, clamped in the service to `0..1` and `1..50` respectively, so an out-of-range tuning value is corrected rather than rejected. The credential check comes **first**, before the work is even looked up (`503 LLM_UNCONFIGURED`), so a keyless deployment answers "not configured" rather than a 404 — same ordering as `POST /api/documents/:id/extract` and `POST /api/photos/:id/analyze`. Returns `{ work_id, model, dims, threshold, compared, candidates }`, where `compared` is how many peers had a dimension-compatible vector — the honest denominator, so "compared 4, 2 candidates" reads as "checked four, two were similar", never as "found only two peers". Each candidate is:
  - `work_id`, `title`, `category`, `location_name` — the peer.
  - `similarity` — cosine similarity, `0..1`, rounded.
  - `distance_m` — metres between the two works, or `null` when either lacks a geotag. **Never `0` for a missing coordinate** — `(0,0)` is a real point in the Gulf of Guinea (Doctrine 11); a real `0` means the same point.
  - `amount_diff_pct` — relative gap between sanctioned amounts as a percentage, or `null` when either amount is missing or non-positive. `0` is a real value (identical amounts, itself a duplicate signal) and distinct from `null` (an amount could not be read).
  - `also_flagged_by_r009` — true when R-009 already flagged this exact pair, in either order.

  Errors: `503 LLM_UNCONFIGURED` (checked before the work lookup), `404 NOT_FOUND` (no such work), `502 LLM_AUTH`, `502 LLM_FAILED`, `504 LLM_TIMEOUT`. `LLM_BLOCKED` does not apply — the embeddings path has no safety-block response.

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

  Filing an inspection compares it against nothing. The comparison of what an inspector recorded against what the work record claims is **§10d**, and it is a separate, explicitly-invoked call.

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

## 9f. Agency Performance
Doctrine #3 again: this attributes to **implementing agencies**, which the doctrine permits, and touches no `mp_name` — not selected, not aggregated, not returned.

- `GET /api/agencies` — Per-agency workload, delivery pacing and open-alert counts. Query param: `district_id`. The pacing expectation is rebuilt from the **scoped** corpus when a district is given, so a district-scoped pacing index compares agencies against that district's own medians, not the national ones — the right comparison for a district officer, and a different number from the unscoped one. The arithmetic, and what is deliberately not computed, lives in `services/agency_performance.ts`.

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

## 10b. Document AI — UCs, certificates and bills (P-04)

Read-only extraction of Utilisation Certificates, completion certificates and bills, followed by arithmetic reconciliation against the portal record. Two stages, deliberately separate: `services/document_ai.ts` reads fields off the page (Tier 1 — one model call), `services/document_reconcile.ts` compares them against the work (subtraction, date ordering, string comparison — no model). `|8.2L − 11.6L| / 11.6L = 29%` can be recomputed by anyone reading the finding; a model asked "do these disagree?" would answer confidently and unauditably. The UI labels the two stages differently because they carry different kinds of trust.

A **finding is not an alert.** `check_id` values are `D-0xx`, not `R-0xx`: they raise no `alerts` rows, do not enter the per-district alert budget, carry no `verification_status`, and are never scored against `answer_key`. Mixing them would corrupt `/evaluation` and put uncalibrated findings into a triage queue whose precision is measured. `GET /api/documents/checks` publishes the catalogue with that statement attached.

The discipline the feature rests on (Doctrine 11): **a null extracted field skips its check — it never becomes a finding.** An amount that could not be read is `null`, never `0`; comparing `null` against `works.expenditure` and reporting a total shortfall is precisely the fabrication the cleanup pass before this feature spent its length removing. `fields_found / fields_expected` is a *measured* completeness, recorded in place of a model's uncalibrated self-reported confidence.

- `GET /api/documents/status` — Whether extraction is configured, and under what limits. Returns `{ available, reason, tier, model, document_kinds, accepted_mime_types, max_bytes, max_upload_bytes }` — `max_bytes` is the model's inline-read ceiling and `max_upload_bytes` the store ceiling; both are 5 MB today but come from separate constants (a model limit and a storage limit), held in the order `max_upload_bytes <= max_bytes` by a test rather than derived from each other. That ordering is the contract a client can rely on: a file the store accepts is one the extractor will accept too, so an upload's second step never fails on size — a client sizing an upload should honour `max_upload_bytes`. **200, not 503** when no credential is set — same contract as `/api/query/status`: a keyless deployment renders an honest disabled state, not an upload button whose second step always fails.

- `GET /api/documents/checks` — The `D-0xx` catalogue, each id with its one-line description, plus the note that these are document-versus-record comparisons rather than catalogued rules. Same reasoning as `GET /api/rules` for the R-catalogue: a finding that says "D-001" and nothing else is unactionable.

- `GET /api/documents/findings?limit=` — Open findings across the corpus, most severe first (`limit` 1–500, default 100). The document-AI worklist, kept separate from `/api/alerts` on purpose — a different job from triaging rule alerts.

- `GET /api/documents?work_id=` — A work's documents, each with its current extraction and that extraction's findings. `work_id` is required (`400 MISSING_PARAM` otherwise): an unfiltered list of every document would mean signing URLs for files nobody asked about.

- `POST /api/documents` — Store a file against a work. Body `{ work_id, type, filename, content_base64, content_type }`; base64 in a JSON body, not multipart (no multipart parser; the precedent is `POST /api/ingest` posting a CSV as a JSON string). Validated on the **decoded** bytes — `400 UNSUPPORTED_TYPE` (MIME outside the vision list — a file that stores but can never be read is worse than a refused upload), `400 EMPTY_FILE`, `413 FILE_TOO_LARGE`; `404 NOT_FOUND` when `work_id` names no work. `201` with `{ document, readable_kind, duplicate_of }`. `readable_kind` is null when `type` names no kind this platform can read, reported now rather than when extraction refuses. `duplicate_of` names other works already holding byte-identical content — not an error (a re-upload correcting metadata is routine), but the same certificate on two works is worth seeing at the moment it happens.

- `POST /api/documents/:id/extract` — Read the stored file and reconcile it. Credential check **first**, before the document is even looked up (`503 LLM_UNCONFIGURED`), so a keyless deployment answers "not configured" rather than a 404. Returns `{ extraction, findings, checks_run, superseded_extraction_id }`. `checks_run` sits beside `findings` because zero-findings-of-eight-checks and zero-findings-of-zero-checks look identical on a dossier and mean opposite things. Extractions are **append-only, latest-wins**: a re-read inserts a new current reading, sets `superseded_at` on the prior one, and closes that reading's still-open findings to status `SUPERSEDED` — so the cross-corpus worklist never surfaces a stale duplicate, and a superseded reading's findings can no longer be reviewed. Errors: `422 UNKNOWN_DOCUMENT_KIND` (the type names no readable kind — guessing it would run UC checks against a photograph of a site board), `422 DOCUMENT_UNREADABLE` (the model returned no field set; a failed reading, distinct from a document that states nothing, and nothing is recorded), `400 DOCUMENT_UNSUPPORTED_TYPE` / `413 DOCUMENT_TOO_LARGE` (from `services/llm.ts`), `404 NOT_FOUND` (the document, or the work it hangs off, no longer exists), `502 LLM_AUTH`, `504 LLM_TIMEOUT`, `502 LLM_FAILED`, `502 LLM_BLOCKED`.

- `GET /api/documents/:id/url` — A 5-minute signed URL; the evidence bucket is private.

- `PATCH /api/documents/findings/:id` — Accept or dismiss. Body `{ status: 'ACCEPTED' | 'DISMISSED', note?, reason? }`. A dismissal requires a `reason` (same as `PATCH /api/alerts/:id`): a dismissal with no stated reason is indistinguishable from a queue being cleared, and these dismissals are the only evidence a check produces noise — D-005 especially is expected to be dismissed often. **Accepting D-007 is the one path in this feature that writes to `works`**: it sets `has_uc = true` and `uc_date` to the certificate's date, gated on a human because `has_uc` gates R-003 and a model reading of a poor scan must not be able to silence a compliance rule. Errors: `404 NOT_FOUND`; `409 ALREADY_REVIEWED` (the finding is not `OPEN`); `409 EXTRACTION_SUPERSEDED` (the finding belongs to a reading a later extraction has replaced — reviewing it, and above all flipping `has_uc` from a discarded scan, must not be possible); `400 INVALID_VALUE` (status is neither `ACCEPTED` nor `DISMISSED` — a finding cannot be returned to `OPEN`, because the ledger records the decision that was made and reopening would leave two contradictory entries).

---

## 10c. Photo AI — geotags and blind vision on evidence photos (P-06)

Read-only verification of the photographs attached to a work, in two stages that carry different kinds of trust. Upload parses the deterministic facts in the file's bytes with **no model** — its sha256, and the EXIF geotag and capture time read by a dependency-free parser (`services/exif.ts`). Analysis then runs four checks: **V-001** is the geotag proximity test — haversine trigonometry on the EXIF coordinate against `works.latitude/longitude`, a distance in metres anyone can recompute (Tier 3, no model); **V-002/003/004** compare a vision model's *blind* reading — asset category, construction stage, and an authenticity concern — against the record (Tier 1, one model call). No model decides whether a finding exists; the comparison is code. The model is never told the work's claimed category or status, so it cannot agree its way into a false negative.

Upload and analysis are **separate calls** on purpose. A combined endpoint would fail a good upload because the model was rate-limited, and the operator's response — upload again — would produce a duplicate object for a failure that had nothing to do with the file. Storing first makes analysis retryable.

A **finding is not an alert.** `check_id` values are `V-0xx` (visual evidence), distinct from both `R-0xx` rules and `D-0xx` document findings: they raise no `alerts` rows, do not enter the per-district alert budget, carry no `verification_status`, and are never scored against `answer_key`. `GET /api/photos/checks` publishes the catalogue with that statement attached. The integrity check (V-004) is capped at `MEDIUM` in code: a model's authenticity concern prompts a human look, it does not indict a photograph as fake.

The same null discipline as the document feature (Doctrine 11): **a dimension the model could not read is `null` and skips its check — it never becomes a finding.** An absent EXIF geotag is `null`, **never `(0, 0)`**, which is a real point in the Gulf of Guinea; a photo with its location stripped (every messaging app does this) simply has no V-001 to run. A stored `integrity_concern` is only ever `null | POSSIBLE | LIKELY` — a literal `NONE` from the model folds to `null` in `coerceObservations`, because "the model saw nothing wrong" is the absence of a concern, not a concern to store. `fields_found / fields_expected` is a *measured* completeness recorded in place of an uncalibrated self-score, exactly as the document feature.

- `GET /api/photos/status` — Whether analysis is configured, and under what limits. Returns `{ available, reason, tier, model, asset_categories, construction_stages, integrity_levels, accepted_mime_types, max_bytes, max_upload_bytes }`. **200, not 503**, when no credential is set — same contract as `/api/documents/status`: a keyless deployment renders an honest disabled state rather than an upload button whose second step always fails.

- `GET /api/photos/checks` — The `V-0xx` catalogue, each id with its one-line description, plus the note that these are photo-versus-record comparisons rather than catalogued rules — V-001 deterministic geotag trigonometry, V-002/003/004 a model's blind reading compared by code.

- `GET /api/photos/findings?limit=` — Open findings across the corpus, most severe first (`limit` 1–500, default 100). The photo-AI worklist, kept separate from `/api/alerts` and `/api/documents/findings` on purpose — a different job from triaging rule alerts.

- `GET /api/photos?work_id=` — A work's photos, each with its current analysis and that analysis's findings. `work_id` is required (`400 MISSING_PARAM` otherwise): an unfiltered list of every photo would mean signing URLs for files nobody asked about.

- `POST /api/photos` — Store an image against a work. Body `{ work_id, caption?, filename, content_base64, content_type }`; base64 in a JSON body, not multipart, for the same reasons as documents (no multipart parser; the `POST /api/ingest` precedent). Validated on the **decoded** bytes, so `413 FILE_TOO_LARGE` names the operator's file size. `201` with `{ photo, duplicate_of, exif }`. `exif` is the geotag and capture time parsed at upload — `latitude`/`longitude` null when the image carried no geotag, **never `0`**. `duplicate_of` names other works already holding byte-identical content: the deterministic half of the photo-reuse concern (Doctrine 7), surfaced at the moment it happens — not an error, since a re-upload correcting a caption is routine. Perceptual near-duplicate reuse stays with the dormant R-010 and is not claimed here.

- `POST /api/photos/:id/analyze` — Read the stored image and compare it against the work. Credential check **first**, before the photo is even looked up (`503 LLM_UNCONFIGURED`) — the geotag check is deterministic but is produced within an analysis pass, so it too waits on a configured key. Returns `{ analysis, findings, checks_run, superseded_analysis_id }`. `checks_run` sits beside `findings` because zero-of-four and zero-of-zero look identical on a dossier and mean opposite things. Analyses are **append-only, latest-wins**: a re-read inserts a new current reading, sets `superseded_at` on the prior one, and closes that reading's still-open findings. Errors: `422 PHOTO_UNREADABLE` (the model returned no observation set — a failed reading, distinct from an image with nothing legible, and nothing is recorded), `400 DOCUMENT_UNSUPPORTED_TYPE` / `413 DOCUMENT_TOO_LARGE` (the shared `services/llm.ts` reader's own codes, surfaced verbatim — the same ones `POST /api/documents/:id/extract` lists; structurally unreachable on this path, since a stored photo's type was validated at upload against a subset of the reader's accepted types and its size against the same ceiling), plus the shared `502 LLM_AUTH` / `504 LLM_TIMEOUT` / `502 LLM_FAILED` / `502 LLM_BLOCKED`.

- `GET /api/photos/:id/url` — A 5-minute signed URL; the evidence bucket is private.

- `PATCH /api/photos/findings/:id` — Accept or dismiss. Body `{ status: 'ACCEPTED' | 'DISMISSED', note?, reason? }`. A dismissal requires a `reason` (same as `PATCH /api/alerts/:id`): these dismissals are the only evidence a check produces noise, and V-002 and the softer V-001 tier are expected to be dismissed often. **Unlike documents, no photo finding writes back to `works`** — accepting one records the officer's judgement and nothing on the work row changes. Errors: `404 NOT_FOUND`; `400 INVALID_VALUE` (status is neither `ACCEPTED` nor `DISMISSED` — a finding cannot be returned to `OPEN`, because the ledger records the decision that was made); `409 ALREADY_REVIEWED` (the finding has already been accepted or dismissed) and `409 ANALYSIS_SUPERSEDED` (a re-read has superseded the finding's analysis) — the same review guard as `PATCH /api/documents/findings/:id`, so a decision is recorded once, against the reading that was actually on screen.

---

## 10d. Inspection evidence vs the work record (P-10)

The platform stored field inspections and stored site photographs, and **nothing compared either against the work**. An inspector could stand at a site, record `WORK_NOT_STARTED`, sync it, and the work would go on reading `COMPLETED` on every dossier and every list in the product — because the inspection was filed *beside* the record rather than checked *against* it. This section is that comparison.

**No model and no credential.** Unlike §10b and §10c there is no upload and no model call. Every check is a distance, a date subtraction or an equality over values already on record: the inspector's row in `inspections`, the work's row in `works`, and the EXIF facts parsed from photographs at upload. That is why `/api/inspections/status` answers `available: true` unconditionally — there is no configuration state in which this cannot run. The logic is `services/inspection_reconcile.ts` (pure, no database) and `services/inspection_compare.ts` (the orchestration); tables are migration `017_inspection_evidence.sql`.

The four checks, published by `GET /api/inspections/checks`:

| id | what it compares | magnitude |
| --- | --- | --- |
| `I-001` | Inspector's GPS fix against the nearest **geotagged site photograph**. The photo EXIF is the one location signal the CSV ingest cannot poison — it is read from the image bytes. Keeps the closest photo's id on the finding so the officer can open the exact image. | metres |
| `I-002` | Inspector's recorded status against a **completion claim** (`works.status = 'COMPLETED'` or `physical_progress_pct >= 100`). The money-leak check: payment is released against completion. | none |
| `I-003` | Latest photograph's EXIF capture time against the **inspection date**, threshold 31 days. A provenance question — a later upload, a stock image, or a backdated record — not proof of any of them. Always `MEDIUM`. | days |
| `I-004` | Inspector's GPS fix against `works.latitude/longitude`. | metres |

**A finding is not an alert.** `check_id` values are `I-0xx` (inspection evidence), distinct from `R-0xx` rules, `D-0xx` document findings and `V-0xx` photo findings: they raise no `alerts` rows, do not enter the per-district alert budget, carry no `verification_status`, and are never scored against `answer_key`. An inspector disagreeing with the record is a prompt for a human to look, not a platform verdict about a work. Nothing reaches `CRITICAL` — an inspection is one observer on one day, and the gap may be a reporting lag.

**`deviation_unit` is part of the contract, not decoration.** Two checks measure a distance in metres and one measures a lag in days over the same `deviation` column. **Read the unit off the row; do not infer it from `check_id`** — a client that guesses renders "40 days" as "40 metres" the first time a check id moves. `deviation` and `deviation_unit` are null together or non-null together; `I-002` is categorical and carries neither.

**The record side names a column, never a person.** Findings carry `record_value` and `record_source` — deliberately not `agency_value`. No column records who entered a work's status, and `uploaded_by` on a photo is an unauthenticated header string (§11), so attributing the record side to an author would be a fabrication the schema cannot support. Doctrine 3 besides: accountability attaches to the work and its implementing agency, never to an elected representative.

**A missing input skips its check — it never becomes a finding** (Doctrine 6). No GPS fix on the inspection: `I-001` and `I-004` do not run. No geotagged photograph: `I-001` does not run. No photograph with a capture time: `I-003` does not run. A status outside the vocabulary the check understands, or no completion claim: `I-002` does not run. `I-004` additionally **refuses the Delhi-centroid placeholder** (`isDefaultedCoordinate`) — `ingest.ts` writes `28.6139, 77.2090` when a CSV row carries no coordinate, and without this guard every inspection outside Delhi on such a work would read as an 800-km location mismatch against a coordinate nobody captured.

- `GET /api/inspections/status` — `{ available, reason, tier, checks }`. `available` is unconditionally `true` and `reason` correspondingly `null`. Kept as an endpoint so a client's pre-render capability check is uniform across all three evidence features; the whole `I-` catalogue rides along, so a panel needs no second call.

- `GET /api/inspections/checks` — The `I-0xx` catalogue, each id with its one-line description, plus the note that these are inspection-versus-record comparisons rather than catalogued rules.

- `GET /api/inspections/findings?limit=` — Open findings across the corpus, most severe first (`limit` 1–500, default 100). The inspection-evidence worklist, kept separate from `/api/alerts` on purpose: mixing them would put uncalibrated findings into a queue whose precision is measured against the answer key.

- `GET /api/inspections/for-work/:workId` — Every inspection on a work, newest first, each with its **current** comparison and that comparison's findings. A `null` `comparison` means nobody has run the comparison yet. **It does not mean the inspection is clean**, and a client must render the two differently. A superseded run's findings do not appear here.

- `POST /api/inspections/:id/compare` — Compare one inspection against its work and that work's photographs. Returns `{ comparison, findings, checks_run, superseded_comparison_id }`. Comparisons are **append-only, latest-wins**: a re-run inserts a new current comparison, sets `superseded_at` on the prior one, and closes that run's still-open findings to `SUPERSEDED` — accepted and dismissed findings are left untouched, because they are decisions an officer made. The supersede happens *before* the insert, because migration 017's partial unique index enforces one current comparison per inspection. Errors: `404 NOT_FOUND` (no such inspection, or its work no longer exists).

  `comparison.checks_run` sits beside `findings` for the same reason as §10b and §10c, and it is the field that makes this feature honest: **zero findings out of four checks and zero out of zero look identical on a dossier and mean opposite things.** Three states, and a client must branch on all three — a non-empty array (these ran), `[]` (a measured result: nothing could be compared), and absent/`null` (nothing was recorded, which is not the same as nothing running). Narrow it with `Array.isArray()`, never a strict `!== null`. The column is nullable and has deliberately no `DEFAULT`, so a row written by anything other than `compareInspection` — a backfill, a data repair — carries SQL `NULL`; and because `db.ts` selects `'*'`, which cannot return a column the database does not have, the same guard also absorbs the `undefined` that §10c's `photo_analyses.checks_run` really does produce wherever migration 016 is unapplied. One narrowing across all three features. `photos_on_record`, `photos_with_geotag` and `photos_with_timestamp` are counted at comparison time and explain an empty `checks_run` without guesswork — they are never inferred back out of it, because `I-002` runs with no photographs at all.

- `PATCH /api/inspections/findings/:id` — Accept or dismiss. Body `{ status: 'ACCEPTED' | 'DISMISSED', note?, reason? }`. A dismissal requires a `reason`, as everywhere else: dismissals are the only evidence a check produces noise, and `I-001` is expected to be dismissed on large or linear sites — that record is how anyone would know to widen its tolerance. **No inspection finding writes back to `works`.** Accepting one records the officer's judgement; the correction to the record belongs in e-SAKSHI, on the register of authority. Errors: `404 NOT_FOUND`; `400 INVALID_VALUE` (status is neither — a finding cannot be returned to `OPEN`, because the ledger records the decision that was made and reopening would leave two contradictory entries with no way to tell which is current); `409 ALREADY_REVIEWED`; `409 COMPARISON_SUPERSEDED` (a re-run has replaced the finding's comparison) — the same review guard as documents and photos, so a decision is recorded once, against the comparison that was actually on screen.

Audited as `INSPECTION_COMPARED`, `INSPECTION_FINDING_ACCEPTED` and `INSPECTION_FINDING_DISMISSED`. The compare entry carries both `checks_run` and `findings_raised`, so the ledger itself distinguishes "four checks ran and found nothing" from "nothing could be checked".

**RLS caveat.** Migration 017 enables row-level security on `inspection_comparisons` and `inspection_findings` and gives both a read policy for `authenticated`, matching the P-04 and P-06 tables. §11 applies unchanged: `db.ts` connects with the service-role key, which bypasses every one of those policies. They exist so these are not the one unprotected set if a non-service-role client is ever introduced — they are not in force for any request the API makes today.

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
