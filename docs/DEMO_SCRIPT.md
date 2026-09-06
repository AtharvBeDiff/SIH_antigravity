# MPLADS Insight & Integrity Platform — 4-Minute Golden Demo Script

> **Goal**: Guide judges through a flawless, end-to-end demonstration of the platform's core innovations: the delivery gap between sanction and completion, explainable algorithmic triage, the tamper-evident hash ledger, empirical evaluation metrics, and citizen transparency.

---

### Minute 1: The Core Governance Challenge & Overview
1. **Open Overview Page (`http://localhost:5173/`)**:
   - Highlight the **Value Completion** and **Physical Completion** cards against the published benchmarks: **50.71% by value** and **61.88% by count** (Standing Committee on Rural Development, 1 Apr 2023 – 22 Jan 2026 — ₹3,387.38 Cr completed of ₹6,680.29 Cr sanctioned; 69,061 of 1,11,600 works). Say both numbers, and say why they differ: the works that complete are systematically cheaper than the works that stall, so an eleven-point spread between the two bases *is* the finding, not a rounding artefact. Quoting one figure against the other's denominator is the mistake this platform exists to stop making.
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
   - Show the **Rules Catalog** and the **Empirical Probation Matrix** that auto-prunes rules if false positives exceed 60% over 25 reviews. Every `rule_id` on an alert resolves to a catalogue entry with a `verification_status` — say so, and open one to prove it.
2. **Navigate to Empirical Evaluation (`/evaluation`)**:
   - Show precision, recall and F1 measured against the answer key — 797 labelled
     conditions across eleven anomaly types, written by `data-gen` and derived from the
     finished corpus rather than recorded at plant time.
   - **State the scope before the score.** The card below the three figures names the
     eleven covered rules and counts the alerts the key could **not** judge. Ten rules are
     outside it, and if asked, distinguish the reasons: R-001's cost outliers and R-009's
     duplicates are emergent — defined against the corpus, not one work — R-010 needs
     images, R-016 and R-017 are statistics rather than alerts, and R-021's label is simply
     unwritten. Scoring their alerts as false positives would make precision fall as those
     rules did more work.
   - **Say what recall means.** It measures pipeline fidelity: whether a condition known
     to be present survives the catalogue, the status filters, probation and the alert
     store. It is not a claim about catching real procurement fraud, and no synthetic
     corpus can measure that. The screen says this; say it out loud too — a judge who
     hears "94% recall" without it will hear the wrong claim.
   - Any metric whose denominator is zero still renders `—`, never a placeholder.
3. **Navigate to Citizen Portal (`/public`)**:
   - Show the citizen-facing interface and explain **Doctrine #4**: Whitelist-only data representation strictly preventing internal risk scores or officer deliberations from leaking to the public.
