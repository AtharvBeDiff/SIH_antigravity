# MPLADS Insight & Integrity Platform — API Contract

Base URL: `/api`  
Data Format: JSON  
Currency: Amounts formatted as numeric Indian Rupees (`INR`).  
Dates: `YYYY-MM-DD`. Timestamps: ISO-8601 UTC (`Z`).

---

## 1. Metadata & Ingest
- `GET /api/meta` — Returns platform schema version, demo mode status, synthetic corpus flag, and district list.
- `POST /api/ingest` — Ingest official 21-column e-SAKSHI dataset batch.
- `GET /api/ingest/history` — List past ingestion batches and cryptographic checksums.

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
- `GET /api/rules` — Catalog of all 17 rules with verification status (`VERIFIED`, `NEEDS_VERIFICATION`, `PLATFORM_POLICY`) and live probation state.
- `GET /api/rules/:ruleId` — Specific rule detail, parameters, and historical hit rate.

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
- `GET /api/insight/evaluation` — Measured Precision, Recall, and F1 per anomaly type against planted answer key.
- `GET /api/insight/calibration` — Live synthetic corpus completion rate compared to official 19.24% MoSPI benchmark.
- `GET /api/insight/readiness` — 21-column e-SAKSHI data contract day-1 integration checklist.

## 10. Public Citizen Portal (Doctrine #4: Whitelist Only)
- `GET /api/public/works` — Searchable public infrastructure directory strictly containing safe public fields.
- `GET /api/public/works/:id` — Public work asset detail guaranteed to exclude all internal risk scores, alerts, and officer notes.
