# MPLADS Insight & Integrity Platform — 4-Minute Golden Demo Script

> **Goal**: Guide judges through a flawless, end-to-end demonstration of the platform's core innovations: the 19.24% gap insight, explainable algorithmic triage, the tamper-evident hash ledger, empirical evaluation metrics, and citizen transparency.

---

### Minute 1: The Core Governance Challenge & Overview
1. **Open Overview Page (`http://localhost:5173/`)**:
   - Highlight the **19.24% Gap Insight Card**: Explain that historical MoSPI data proves only 19.24% of sanctioned capital turns into completed assets in timely cycles.
   - Point to the live telemetry cards: Sanctioned Capital, Physical vs. Value Completion, and Active Risk Alerts.
   - Demonstrate the **District Filter**: Switch between Delhi North, South, East, and West districts to show localized performance telemetry.

---

### Minute 2: Explainable Risk Triage & Officer Casework
1. **Navigate to Alert Queue (`/alerts`)**:
   - Show how alerts are ranked strictly by **Severity Rank** (CRITICAL → HIGH → MEDIUM → LOW) and constrained by the **Alert Budget** (max 10 open per district to prevent alert fatigue; excess assigned to Backlog).
2. **Open a Critical Alert Dossier (`/alerts/:id`)**:
   - Show the **Explainable Evidence Statement**: Demonstrates mathematical transparency (e.g. *MAD z-score 3.4× above district median* or *2-of-3 duplicate match on text and geo proximity*).
   - Point out the **Statutory Basis & Verification Badge**: Distinguishes between `VERIFIED` rules and `PLATFORM_POLICY`.
3. **Execute an Officer Review Decision**:
   - Select **Dismiss** or **Acknowledge**, choose a mandatory dismissal reason code (`APPROVED_DELAY` or `INSPECTION_VERIFIED_PHYSICAL`), type a brief note, and click **Commit Decision**.
   - Show the instant update in the **Immutable Action Audit Trail** at the bottom of the page.

---

### Minute 3: The Tamper-Evident Cryptographic Ledger (Hero Demo)
1. **Navigate to Audit Hash Ledger (`/audit`)**:
   - Show the green **"CHAIN SECURE: All sequential audit blocks mathematically validated"** banner.
   - Explain the cryptographic formula: $\text{this\_hash} = \text{sha256}(\text{seq} \mid \text{prev\_hash} \mid \text{payload\_hash})$.
2. **Trigger Malicious Tamper Simulation**:
   - Click **"Simulate Malicious Tampering"**.
   - The screen immediately transitions to a flashing red **"CRITICAL: Cryptographic Chain Broken!"** warning, explicitly highlighting the exact corrupted block sequence and showing non-repudiation in action.
3. **Restore Integrity**:
   - Click **"Restore Chain Integrity"** to show real-time cryptographic reconciliation returning the status to green.

---

### Minute 4: Rigor, Field PWA & Citizen Transparency
1. **Navigate to Rules Matrix & Probation (`/rules`)**:
   - Show the **17 Rules Catalog** and the **Empirical Probation Matrix** that auto-prunes rules if false positives exceed 60% over 25 reviews.
2. **Navigate to Empirical Evaluation (`/evaluation`)**:
   - Show the real measured **Precision (91.6%)**, **Recall (94.4%)**, and **F1 Score** evaluated against the planted ground truth answer key.
3. **Navigate to Citizen Portal (`/public`)**:
   - Show the citizen-facing interface and explain **Doctrine #4**: Whitelist-only data representation strictly preventing internal risk scores or officer deliberations from leaking to the public.
