# DRISHTI (दृष्टि) — MPLADS Insight & Integrity Platform

> **Digital Real-time Integrity & Surveillance Hub for Transparent Infrastructure**  
> *AI & Cryptographic Oversight Engine for the Member of Parliament Local Area Development Scheme (MPLADS)*

---

## 🏛️ Executive Summary

**Project DRISHTI** targets the gap between MPLADS funds sanctioned and works actually completed — **50.71% by value, 61.88% by count** (Standing Committee on Rural Development, 1 Apr 2023 – 22 Jan 2026: ₹3,387.38 Cr completed of ₹6,680.29 Cr sanctioned; 69,061 of 1,11,600 works). The two figures differ by over eleven points because the works that finish are systematically cheaper than the works that stall, which is itself the shape of the problem. DRISHTI addresses it with explainable algorithmic triage, 21 automated compliance rules, multi-modal anomaly detectors (Cost Outlier MAD z-score, Delay Pacing, 2-of-3 Duplicate Corroboration, and 10-Day Health Cadence Monitoring), and a **tamper-evident SHA-256 cryptographic audit ledger**.

A fifth detector, Photo Reuse Hash Matching, is implemented but **dormant**: it compares perceptual hashes across works, and nothing writes `works.evidence_image_key` — not the CSV ingest, not the generator, not the inspection upload. It is listed as `DORMANT` on `/rules` and as `NOT_INGESTED` on `/readiness` rather than presented as an active check, because a CRITICAL anti-fraud rule that silently never fires reads as "no photo reuse in this corpus", which is a finding DRISHTI has not made. Lifting it needs perceptual hashing at evidence-upload time; the comparison itself needs no change.

---

## 🚀 Quickstart & Local Execution

### 1. Prerequisites
- **Node.js**: v24.11.1+ (Native TypeScript Type-Stripping)
- **Supabase Account**: Live PostgreSQL connection

### 2. Environment Configuration
Create `backend/.env` and `frontend/.env.local` from your own Supabase project's
settings. Both files are gitignored and must stay that way — never commit real
values, and never paste a project URL or key into this file.
```bash
# backend/.env
PORT=4000
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server-only, never expose to the browser

# frontend/.env.local
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-key>
```

### 3. Database Setup
Apply the migrations in order, then load the corpus. The two are separate steps because
they are different kinds of thing: a migration is history, applied once and never
rewritten; a seed is current-state data, replaced wholesale whenever the corpus changes.

```bash
# Schema — 19 tables, RLS policies, storage buckets and reference data
# (4 districts, 4 agencies, 4 constituencies). No works.
# Apply supabase/migrations/*.sql in filename order, or push the whole thing at once:
psql "$DATABASE_URL" -f supabase/full_schema.sql

# Corpus — 2,000 works, ~6,300 stage payments, ~31,950 health reports,
# 797 answer-key rows
npm run generate -w data-gen
psql "$DATABASE_URL" -f supabase/seed.sql
```

`full_schema.sql` used to carry 200 works of its own, from an old generator run, so
running both steps produced a 2,200-work corpus — 200 of them with statuses and
categories no rule recognises. It is now schema plus reference data only, and the two
steps compose.

`npm run generate -w data-gen` rebuilds `supabase/seed.sql`, the ingest CSV, and prints
what it planted. It is seeded, so a given seed always produces the same corpus. See
[`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) §3 for what the answer key covers — and,
importantly, what it does not.

### 4. Run Development Servers
```bash
# In backend terminal:
cd backend
npm run dev

# In frontend terminal:
cd frontend
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## 🧪 Test Suite Execution

Run all 8 unit and integration test suites:
```bash
cd backend
npm test
```
**Test Results:**
- `✔ audit_chain formula logic (pure math)`
- `✔ audit_chain database append and verify integrity`
- `✔ audit_chain tamper detection and restoration`
- `✔ doctrine #4: public view strictly prevents internal leakage`
- `✔ doctrine #6: rule engine null-field safety`
- `✔ rule engine evaluates cost overrun (R-004)`
- `✔ duplicate detector 2-of-3 corroboration`
- `✔ analysis pipeline runs end-to-end against live DB`

---

## 🧭 Golden Demo Guide

Follow the step-by-step instructions in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) to showcase:
1. The **Delivery Gap** cards on the Executive Dashboard (`/`), and `/calibration` for how the corpus compares to the published 50.71%-by-value and 61.88%-by-count figures.
2. The **Explainable Alert Queue** with officer triage & dismissal reason codes (`/alerts`).
3. The **Cryptographic Tamper-Evident Ledger** showing simulated malicious tampering and instant restoration (`/audit`).
4. The **Rules Catalog & Empirical Probation Matrix** (`/rules`).
5. The **Evaluation Harness** (`/evaluation`) — precision, recall and F1 measured against the answer key, over the eleven rules it has ground truth for. The screen names those rules and counts the alerts it could not judge, and any metric with a zero denominator renders as `—`. Recall here measures pipeline fidelity, not real-world detection accuracy; the page says so, and so should you.
6. The **Field Inspection PWA** with offline synchronization (`/inspection`).
7. The **Public Citizen Transparency Portal** with strict leak-prevention (`/public`).

---

## 📐 System Architecture

- **Frontend**: React 19, Vite 8, Tailwind CSS v4, Lucide React, Framer Motion.
- **Backend**: Express 5, Node 24 Native TypeScript, YAML rule parser.
- **Database**: Supabase PostgreSQL (19 Tables, Storage Buckets, RLS policies defined — see the security note below on why they are not in force).
- **Integrity**: Append-only SHA-256 cryptographic chain over every state mutation, verifiable at `/audit`.

### Security posture — read this before demoing

DRISHTI has **no authentication and no authorisation**. `actorOf` in
`backend/src/http.ts` takes the acting officer's name from a client-supplied
`x-user-id` header and returns it unverified; `backend/src/db.ts` connects with the
Supabase service-role key, which bypasses every RLS policy in the schema. There are no
roles and no per-district scoping, so every endpoint — including `PATCH /api/alerts/:id`
and `POST /api/analyze` — is reachable by any caller, acting as any officer.

This bounds what the audit ledger proves. The chain is genuinely tamper-evident: an
entry cannot be altered or removed without `/audit/verify` reporting exactly where the
break is. But the actor named in an entry is only as trustworthy as the header it came
from. **Integrity, not authenticity** — the ledger proves a record has not changed since
it was written, not that it was true when written.

The fix is three steps in order (verify the Supabase JWT; issue a per-request client so
RLS applies; add role checks on the mutating endpoints), and none of them is done. See
[`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) §11.
