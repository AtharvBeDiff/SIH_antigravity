# DRISHTI (दृष्टि) — MPLADS Insight & Integrity Platform

> **Digital Real-time Integrity & Surveillance Hub for Transparent Infrastructure**  
> *AI & Cryptographic Oversight Engine for the Member of Parliament Local Area Development Scheme (MPLADS)*

---

## 🏛️ Executive Summary

**Project DRISHTI** bridges the national **19.24% fund-to-completion delivery gap** using explainable algorithmic triage, 17 automated compliance rules, multi-modal anomaly detectors (Cost Outlier MAD z-score, Delay Pacing, 2-of-3 Duplicate Corroboration, Photo Reuse Hash Matching, and 10-Day Health Cadence Monitoring), and a **tamper-evident SHA-256 cryptographic audit ledger**.

---

## 🚀 Quickstart & Local Execution

### 1. Prerequisites
- **Node.js**: v24.11.1+ (Native TypeScript Type-Stripping)
- **Supabase Account**: Live PostgreSQL connection

### 2. Environment Configuration
Both backend and frontend `.env` files are configured:
```bash
# backend/.env
PORT=4000
SUPABASE_URL=https://lsfoaxxxqmtxgcxwafvm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# frontend/.env.local
VITE_SUPABASE_URL=https://lsfoaxxxqmtxgcxwafvm.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

### 3. Run Development Servers
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
1. The **19.24% Gap Insight** on the Executive Dashboard (`/`).
2. The **Explainable Alert Queue** with officer triage & dismissal reason codes (`/alerts`).
3. The **Cryptographic Tamper-Evident Ledger** showing simulated malicious tampering and instant restoration (`/audit`).
4. The **17 Rules Catalog & Empirical Probation Matrix** (`/rules`).
5. Real measured **Precision/Recall/F1 metrics** evaluated against ground truth (`/evaluation`).
6. The **Field Inspection PWA** with offline synchronization (`/inspection`).
7. The **Public Citizen Transparency Portal** with strict leak-prevention (`/public`).

---

## 📐 System Architecture

- **Frontend**: React 19, Vite 8, Tailwind CSS v4, Lucide React, Framer Motion.
- **Backend**: Express 5, Node 24 Native TypeScript, YAML rule parser.
- **Database**: Supabase PostgreSQL (19 Tables, RLS, Storage Buckets).
- **Security & Integrity**: Append-only SHA-256 cryptographic chain, DPDP Act 2023 compliance.
