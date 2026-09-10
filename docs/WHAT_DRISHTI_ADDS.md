# What DRISHTI adds on top of e-SAKSHI

**Audience:** anyone deciding whether this is worth building, funding, or deploying — an evaluator, a judge at a demo, a ministry stakeholder.

**The one-line version:** e-SAKSHI is a *system of record*. There is no *system of review*. DRISHTI is the review layer, and it adds nothing to e-SAKSHI's job because it does not do e-SAKSHI's job.

> **Status honesty.** This document argues for the finished product. Parts of it are built and not yet switched on, and a few things in it are not built at all. `docs/DRISHTI_EXPLAINED.md` Part A states exactly which is which, feature by feature. Read it before repeating any claim here in public. §7 below is the short version.

---

## 1. The gap, stated fairly

e-SAKSHI does its job, and its job is not oversight.

It is the register of authority for MPLADS: every recommendation, sanction, release, progress update, and completion date is recorded there, correctly, and it is the system that *decides* what is true about a work. That is a system-of-record job, and replacing it would be both wrong and unnecessary.

But a register of record has two properties that follow from what it is, not from any flaw in how it was built:

**It is a table, not a queue.** Over a lakh works, a few hundred district officers, and no mechanism that says *look at this one first*. Every work looks like every other work in a list. Oversight therefore defaults to whatever surfaces through a complaint, the press, or an audit that arrives years later. The data was always there. The attention was not.

**Nearly all of it is reported by the parties executing the work.** Progress percentages, completion dates, expenditure figures — the record is largely self-reported by the side being overseen. That is not an accusation; it is how the scheme is administered. But it means a compliance check reading only e-SAKSHI columns is checking a party's account of itself against its own other statements. It can catch inconsistency. It cannot catch a consistent misstatement.

Those two properties are the whole opportunity.

### The scale of what goes unread

Between 1 April 2023 and 22 January 2026, MPLADS sanctioned **₹6,680.29 Cr** across **1,11,600 works**. Completed: **₹3,387.38 Cr** and **69,061 works** — **50.71% by value**, **61.88% by count**. *(Standing Committee on Rural Development.)*

The eleven-point gap between those two figures is the most useful number in the dataset: works that finish are systematically **cheaper** than works that stall. Money concentrates in the works that do not get done, which means any oversight that counts works rather than rupees reports a rosier picture than the money supports.

A second pool gets almost no attention at all: roughly **₹6,654.76 Cr of recommendations never reach sanction** — about twice the value stalled *after* sanction. Works that die in the approval queue leave no completion record to audit, because they never became works.

---

## 2. What we add

```
   e-SAKSHI  ──►  the record: what was sanctioned, released, reported
       │          (unchanged, unwritten-to, still the authority)
       │
       ▼
  ┌─────────────┐
  │   INGEST    │  read the corpus; record what was read AND what was missing
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ 21 RULES    │  compliance checks over the record itself
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │   ALERTS    │  each carries the two values it compared
  │  (budgeted) │  capped per district so the queue stays readable
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │   OFFICER   │  accept / dismiss, with a reason
  └──────┬──────┘
         ├──────► rule probation — rules that cry wolf get suspended
         ▼
  ┌─────────────┐
  │AUDIT LEDGER │  SHA-256 chain; tampering is detectable
  └─────────────┘

  ── and, on a parallel track, the part e-SAKSHI has no equivalent for ──

  DOCUMENTS (8 checks) · PHOTOGRAPHS (4) · INSPECTIONS (4)
  independent evidence, compared against the record.
  Produces FINDINGS attached to the evidence — never alerts, never budgeted.
```

**37 checks in total:** 21 compliance rules over the record, plus 16 evidence checks that compare *outside* evidence against it.

| The question | e-SAKSHI answers | DRISHTI adds |
|---|---|---|
| What was sanctioned and released? | **Yes — authoritatively.** | Nothing. We read it and do not write back. |
| Which works should I look at today? | — | A ranked, explained, per-district budgeted worklist. |
| Why this work? | — | The two values that disagreed, in a sentence, in English. |
| Does the paperwork match the money? | — | 8 checks read the utilisation certificate and compare it to the record. |
| Was the photograph taken at the site? | — | Distance between its EXIF geotag and the recorded location. |
| Does the inspector agree with the record? | — | 4 checks compare the inspection against the claim, and against the photographs. |
| Is this the same work funded twice? | — | 2-of-3 corroboration, plus semantic title matching. |
| Was this work actually checked? | — | Coverage recorded per check, so "clean" and "unchecked" cannot be confused. |
| Who decided what, and when? | Partially | A tamper-evident hash chain over every officer decision. |
| How accurate is the oversight itself? | — | Measured precision and recall, published with its own limits. |

---

## 3. Four reasons this is better, not merely more

### 3.1 It introduces independent measurement — the only thing that can catch a consistent story

This is the strongest structural argument, and it is the one that cannot be replicated by adding rules to e-SAKSHI.

A rule reading only e-SAKSHI columns compares the record against itself. `R-002` catches releases running more than 40 points ahead of reported progress — genuinely useful, and completely blind to a progress figure that was simply inflated. The rule reads what was reported.

DRISHTI adds three sources of evidence produced by a **different party or a different instrument**:

- **The photograph's EXIF geotag** — written by a camera, not typed by a person. `V-001` measures the distance to the recorded location. No model involved; trigonometry on two coordinates that anyone can recompute.
- **The utilisation certificate** — a document authored outside the portal. `D-001`–`D-008` compare the certified amount against expenditure, sanction, and funds released; the certificate date against completion and sanction dates; the agency named on the page against the agency on the record.
- **The field inspector** — a different human, standing at the site, with their own GPS. `I-001`–`I-004` compare their verdict and their position against the record and against the site's own photographs.

The sharpest of these is the last: **the inspector's photograph against the agency's.** Two parties, two cameras, two independently recorded positions for one site. Neither is a platform default. There is no equivalent signal anywhere in a self-reported ledger.

### 3.2 Attention is ranked, budgeted, and explained

An alert is not a score. Every one names the two values it compared and by how much they differ, so an officer can verify it on paper and disagree with it on the spot. Alerts are **capped per district**, because an oversight queue that returns four hundred items per district is the same as returning none.

And DRISHTI will never blend a cost outlier, a missing certificate, and a delay into a single risk number. Those are different kinds of wrong requiring different responses, and averaging them destroys the only information the officer actually needs.

### 3.3 It is precise about what it did *not* check

This is the difference between an oversight tool and a dashboard, and it is worth a worked example.

`R-010` detects the same photograph reused across different works — a CRITICAL check against a real fraud pattern. It is fully implemented. It reads a database column that nothing currently writes, so it can never fire.

It is displayed as **`DORMANT`, with the reason written out**, rather than sitting quietly in the catalogue as an active check. Because a CRITICAL anti-fraud rule that never fires reads as *"there is no photo reuse here"* — a finding the platform has not made.

The same discipline runs everywhere: which checks ran is recorded per comparison, so *"checked eight things, found nothing"* and *"could not check anything"* are different sentences. Both produce zero findings. They mean opposite things, and a system that cannot tell them apart is worse than no system, because it manufactures false confidence.

Missing data never becomes a finding, and never becomes a zero. It renders as an em-dash and a reason. Zero is a measurement; nothing is not.

### 3.4 The oversight is itself auditable

Four screens exist purely so you can check the platform's claims against the platform: `/evaluation` (measured precision and recall over the eleven rules that have a ground-truth answer key — it names those eleven, and counts the alerts it could not judge, rather than quietly scoring only what it can), `/calibration` (the corpus against published national figures), `/readiness` (a field-by-field confession of what the ingest reads, ignores, and defaults), and `/rules` (the full catalogue with thresholds and dormancy reasons on screen).

Rules are also held to account by their users: a rule officers keep dismissing gets **suspended**. Every dismissal requires a reason, because dismissals are the only evidence a check produces noise.

---

## 4. The loopholes closed

| Behaviour | Checks | What it still cannot catch |
|---|---|---|
| Money leaving before the work arrives | `R-002` (releases >40 pts ahead of progress, excluding the mobilisation advance, which is *designed* to precede work), `R-004`, `R-013` | Progress inflated on the portal — which is why §3.1 matters |
| Works that quietly stall | `R-007` (180 days silent), `R-006`, `R-018`, `R-015`, `R-019` (a missed 10-day check-in — the earliest signal, because a work stops reporting before it stops existing) | A work kept nominally alive with token updates |
| Paperwork that does not match the money | `D-001`–`D-008`, `R-003` | A document that is internally consistent and entirely fabricated |
| The same work funded twice | `R-009` (**2 of 3**: similar title, within 500 m, similar amount) + semantic matching that catches *"CC road"* against *"cement concrete road"* | Duplicates deliberately described in dissimilar language and sited apart |
| Evidence that does not match the site | `V-001` (>1 km a note, >50 km serious), `V-002`–`V-004`, `I-001`–`I-004` | An unphotographed work — recorded as *not checked*, never as *checked and clean* |
| Statutory allocation dodges | `R-016` (15% SC / 7.5% ST minimum share), aggregated by constituency and financial year | — |
| Administrative delay as a hiding place | `R-020`/`R-021` put a clock on the sanctioning decision itself (breach 45 days, warn 35), so the pool that never becomes a work stays visible | — |
| Inspection theatre | `R-017` measures inspection coverage against works *in progress*, where an inspection can still change the outcome — not a sign-off sweep of finished assets | A physically present inspector filing a dishonest report. Nothing in software can. |

Two of these deserve a note, because they were **bugs in DRISHTI itself**, now fixed. The inspection checklist used to default to *checked* — an inspector who opened the form and submitted it filed a clean bill of health for a work they never looked at. And the inspector's GPS field used to default to the coordinates of Delhi when the browser could not get a location, planting real-looking false data in a column that cannot be empty.

They are worth stating out loud in a pitch, because they are precisely the failure mode this product exists to detect, and the product had them. That is also why the duplicate check and the inspection geo-check now **refuse to run** against a defaulted coordinate rather than measuring a distance to a placeholder and reporting it as a finding.

---

## 5. What it deliberately refuses to do

For a politically charged scheme, the refusals are as much of the proposal as the features.

- **It does not score Members of Parliament.** Accountability attaches to the **implementing agency** and the **district authority** — the parties that actually execute and disburse. This is a design constraint enforced through the codebase, not a disclaimer. A system that produces a per-MP risk ranking becomes a political instrument within a week, and then stops being used for oversight at all.
- **It does not produce a single risk score.** Different wrongs need different responses.
- **It does not accuse.** Every output is a worklist item; a human accepts or dismisses. The system's job ends at *this is worth your time*.
- **It does not guess.** Missing data produces no finding and no zero.
- **It does not write to e-SAKSHI.** Accepting a finding records the officer's judgement and changes no work record. The correction belongs on the register of authority.
- **It does not publish suspicion.** The citizen portal is structurally prevented from leaking internal triage state — an open alert is an unproven suspicion, and publishing it would be an accusation the platform has not made.

---

## 6. Why adoption is low-risk

The integration surface is deliberately almost nothing:

- **Read-only.** DRISHTI consumes an e-SAKSHI export. It writes back nothing, so it cannot corrupt the register of authority and needs no write credentials.
- **No migration, no schema change, no downtime** on the existing system. e-SAKSHI does not need to know DRISHTI exists.
- **Stateless service.** The backend keeps nothing on disk — no volume, no local database. It talks to hosted Postgres over HTTPS, so an instance can be replaced or spun down without losing anything.
- **Reversible.** Turning DRISHTI off returns everyone to exactly the status quo. Nothing downstream depends on it.
- **The ingest confesses its own gaps.** `/readiness` lists every field in the export, whether it is read, and what happens when it is absent — so the cost of a partial or messy export is visible before deployment rather than discovered after.

---

## 7. Honest status

Presented in full in `docs/DRISHTI_EXPLAINED.md` Part A. In brief:

**Working today:** ingest, the 21 rules with explanations, the officer triage queue with accept/dismiss and reason codes, the tamper-evident audit ledger, rule probation, the four honesty screens, the citizen portal with leak prevention, the field inspection form, and Ask the Corpus.

**Written and tested, but not switched on:** document AI (`D-001`–`D-008`), photo verification (`V-001`–`V-004`), the semantic duplicate check, and inspector-vs-record evidence (`I-001`–`I-004`). All four are committed. **Their database migrations (013–017) have not been applied**, so those endpoints fault until someone runs them.

**Not built:** free-text eligibility screening (blocked on obtaining the guidelines annexure as text), offline inspection sync, perceptual image hashing — which is what `R-010` needs to come alive — and **authentication**.

**The one caveat that bounds everything else:** there is no authentication. The acting officer's name comes from an unverified header, and the database connection bypasses every access-control policy in the schema. This is acceptable for a demo over synthetic data and is not acceptable over real data. It also bounds precisely what the audit ledger proves: the chain is genuinely tamper-evident, but the *actor* named in an entry is only as trustworthy as the header it came from. **Integrity, not authenticity.**

---

## The argument in three sentences

e-SAKSHI already knows everything that happened; nobody has the hours to read it, and almost all of it is the executing side's account of itself.

DRISHTI reads the whole corpus mechanically, ranks the small number of works whose own numbers disagree, and — the part with no equivalent in the ledger — checks that record against evidence produced by someone else: a camera's geotag, a certificate, an inspector standing at the site.

It accuses nobody, scores nobody, decides nothing, and is precise about what it did not check — which is the only reason a clean result from it means anything at all.
