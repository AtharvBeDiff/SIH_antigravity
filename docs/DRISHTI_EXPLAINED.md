# DRISHTI — What it is, what works today, and what it could be

**Audience:** anyone who needs to understand this project without reading the code — an evaluator, a teammate joining late, a judge at a demo, or a stakeholder deciding whether to trust it.

This document has two parts, and the split matters more than anything else in it:

- **Part A — Where DRISHTI actually stands today.** What is working, what is written but not yet switched on, and what does not exist. No aspiration. If something is half-built, this section says so.
- **Part B — The pitch, assuming it is finished and deployed.** What DRISHTI is *for*, argued the way you would argue it in a room. Everything here is conditional on Part A's gaps being closed.

Read Part A before you repeat anything from Part B in public. Mixing the two is the single easiest way to make a false claim about this project.

---

## Table of contents

- [Part A — Where DRISHTI stands today](#part-a--where-drishti-stands-today)
  - [A.1 The one-paragraph version](#a1-the-one-paragraph-version)
  - [A.2 Vocabulary you need (5 terms)](#a2-vocabulary-you-need-5-terms)
  - [A.3 What works right now](#a3-what-works-right-now)
  - [A.4 Built, but not yet switched on](#a4-built-but-not-yet-switched-on)
  - [A.5 A design decision worth recording](#a5-a-design-decision-worth-recording)
  - [A.6 Not built at all](#a6-not-built-at-all)
  - [A.7 Known broken or misleading things](#a7-known-broken-or-misleading-things)
  - [A.8 Honest scorecard](#a8-honest-scorecard)
- [Part B — The pitch](#part-b--the-pitch)
  - [B.1 The problem, in numbers](#b1-the-problem-in-numbers)
  - [B.2 Why the problem survives](#b2-why-the-problem-survives)
  - [B.3 What DRISHTI is](#b3-what-drishti-is)
  - [B.4 The loopholes it closes](#b4-the-loopholes-it-closes)
  - [B.5 Who it serves](#b5-who-it-serves)
  - [B.6 Why it is believable](#b6-why-it-is-believable)
  - [B.7 What it deliberately refuses to do](#b7-what-it-deliberately-refuses-to-do)
- [Where to look in the code](#where-to-look-in-the-code)

---

# Part A — Where DRISHTI stands today

## A.1 The one-paragraph version

MPLADS is the scheme under which each Member of Parliament recommends local development works — roads, community halls, school buildings — funded from a fixed annual entitlement. Those works are recorded on a government portal called **e-SAKSHI**. The records exist. What does not exist is anyone with the time to read them: there are over a lakh works, and an oversight officer has a working week. DRISHTI reads the whole corpus mechanically, applies a fixed set of compliance checks, and produces a **short ranked worklist** of the works that look wrong, each one accompanied by a plain-English explanation of *which two numbers disagreed and by how much*. It accuses nobody. It decides nothing. It moves human attention to where it is most likely to be worth spending.

The project's own one-line summary: **e-SAKSHI is the ledger. DRISHTI is the auditor's worklist.**

## A.2 Vocabulary you need (5 terms)

You cannot read anything else in this project without these five. They are used strictly.

| Term | What it means here |
|---|---|
| **Work** | One funded project. A road, a hall, a borewell. The atomic unit of everything. |
| **Alert** | Something a *rule* (`R-001` … `R-021`) raised about a work by reading the portal record. Alerts are counted, budgeted per district, shown in the officer's queue, and scored for accuracy. |
| **Finding** | Something raised about a *specific uploaded file* — a document (`D-001` … `D-008`) or a photograph (`V-001` … `V-004`). **A finding is not an alert.** It creates no alert row, uses no district budget, and is never scored. It is a note attached to that file. |
| **Check that was run** | The system records not just what it found, but what it *looked at*. This is load-bearing: "we checked eight things and found nothing" and "we could not check anything" look identical if you only report findings. DRISHTI reports both. |
| **Null** | "Not known / not measurable." Never zero, never a placeholder. A missing coordinate is null, not `(0,0)`. A missing number renders on screen as an em-dash with a sentence explaining why — never as `0`. |

The alert/finding distinction is not pedantry. It is the reason the system can add powerful new detectors without inflating the alert count and drowning the officer.

## A.3 What works right now

Everything in this section runs today against the loaded corpus.

### The rule engine — 21 compliance rules

The core. Each rule reads the portal record for a work and asks one narrow question. All 21 live in a single catalogue file, `backend/src/rules/mplads_rules.yaml`, which is the only place a rule may be defined.

**Money rules**

| ID | Name | What it compares | Severity |
|---|---|---|---|
| `R-001` | Cost Outlier | Sanctioned amount vs the district median for that category (robust MAD z-score, threshold 3.0) | HIGH |
| `R-002` | Payment Released Ahead of Verified Progress | Money paid out vs physical progress recorded (gap > 40 points, mobilisation advance excluded) | HIGH |
| `R-004` | Expenditure Exceeds Sanctioned Amount | Expenditure vs sanction (> 10% over) | CRITICAL |
| `R-005` | Zero Expenditure on In-Progress Work | Progress ≥ 10% but ₹0 spent | MEDIUM |
| `R-012` | Stage-Payment Pipeline Stalled | High-value work past the point a stage payment is due, but payment history stops at the advance | LOW |
| `R-013` | Released Amount Exceeds Sanctioned | Released vs sanction (> 5% over) | HIGH |
| `R-014` | Sanctioned But Never Paid | Sanctioned > 90 days ago, no payment of any stage recorded | MEDIUM |

**Timeline rules**

| ID | Name | What it compares | Severity |
|---|---|---|---|
| `R-006` | Delayed Beyond Scheme Timeline | Months since sanction vs the 12-month scheme limit (honours a recorded extension) | HIGH |
| `R-007` | Stalled — No Progress | Days since any payment or progress update (> 180) | HIGH |
| `R-008` | Completed But Low Progress Recorded | Marked COMPLETED but progress < 80% | MEDIUM |
| `R-015` | Work On Hold Too Long | Days on hold (> 120) | MEDIUM |
| `R-018` | Behind Schedule Pace | Reported progress vs a straight-line 12-month schedule (< half of expected) | HIGH |
| `R-019` | Missing 10-Day Health Report | Days since last health check-in vs the 10-day cadence plus 5-day grace | MEDIUM |

**Compliance and integrity rules**

| ID | Name | What it compares | Severity |
|---|---|---|---|
| `R-003` | Missing Utilisation Certificate | Completed work with no UC, past a 90-day grace | MEDIUM |
| `R-009` | Duplicate Work | Two works matching on **2 of 3** signals: title similarity ≥ 0.75, within 500 m, amounts within 15% | CRITICAL |
| `R-011` | Ineligible Category | Work's category against the ineligible list | HIGH |
| `R-016` | SC/ST Allocation Compliance | Recommended work value vs the 15% SC / 7.5% ST minimum share | LOW |
| `R-017` | Inspection Coverage | Works under implementation inspected in the trailing year vs a 10% target | LOW |
| `R-020` | Sanction SLA Breached | Days awaiting a sanction decision vs a 45-day limit | CRITICAL |
| `R-021` | Sanction SLA At Risk | Days awaiting a decision vs a 35-day warning mark | HIGH |
| `R-010` | Photo Reuse Across Works | *(dormant — see A.7)* | CRITICAL |

Two design rules govern every one of them:

- **A rule never fires on missing data.** If the field it needs is null, the rule does not run. Missing data is a data-quality problem, not evidence of wrongdoing. This is enforced in the engine, not left to each rule's good manners.
- **Every alert carries its arithmetic.** The officer reads a sentence like *"Expenditure ₹12,40,000 exceeds sanctioned ₹10,00,000 by 24% (threshold: 10%)"* — both numbers, the threshold, and the verdict. Anyone can recompute it by hand.

### Every rule is labelled with how much to trust it

This is unusual and worth calling out. Each rule carries a **verification status**:

- **`VERIFIED`** — the arithmetic or the scheme design is known correct (e.g. the SC/ST percentages are scheme design and not in doubt).
- **`NEEDS_VERIFICATION`** — the threshold is believed right but nobody has opened the official guidelines PDF to pin the clause and page. `R-006`'s 12-month limit sits here.
- **`PLATFORM_POLICY`** — an operational threshold the team chose, with no claim it comes from the guidelines. `R-007`'s 180-day stall window sits here.

A rule does not get promoted to `VERIFIED` because it feels right. The project treats "believed correct" and "checked against the source" as different things and says which is which on screen.

### The officer's triage loop

An alert appears in the queue. The officer opens it, reads the evidence sentence, and either **ACCEPTS** it (the discrepancy is real) or **DISMISSES** it with a reason code. That decision feeds two mechanisms:

- **Rule probation** — a rule that officers keep dismissing gets flagged and can be suspended. The system tracks its own false-positive rate from real human verdicts, rather than assuming its thresholds are right forever.
- **The audit ledger** — every state change is appended to a SHA-256 hash chain where each entry includes the hash of the one before it. Alter or delete any entry and `/audit/verify` reports exactly where the break is.

### A per-district alert budget

Alerts are capped per district. Without a cap, the loudest district produces a thousand alerts and the officer stops reading. A worklist that nobody works is worse than no worklist.

### Evidence checks on uploaded documents (8 checks)

Upload a utilisation certificate or a bill and a model reads the fields off the page. A **separate** stage then compares those fields against the portal record using plain arithmetic:

| ID | What it catches |
|---|---|
| `D-001` | Certified amount differs from the expenditure on the portal |
| `D-002` | Certified amount exceeds the sanctioned amount |
| `D-003` | Certificate dated before the work was completed |
| `D-004` | Certificate dated before the work was sanctioned |
| `D-005` | Agency named on the document is not the agency on the record |
| `D-006` | Certified amount exceeds the funds released |
| `D-007` | A UC is on file for a work the portal says has none |
| `D-008` | Certificate period ends before it begins |

The two-stage split is deliberate. The model only *reads*; it is never asked "do these disagree?" The disagreement is arithmetic anyone can redo. Amounts agree within 1%; dates agree within 7 days.

### Evidence checks on uploaded photographs (4 checks)

| ID | What it catches | Uses a model? |
|---|---|---|
| `V-001` | Photo's GPS location is far from the work's recorded coordinates (> 1 km; > 50 km is treated as serious) | **No** — pure trigonometry on two coordinates |
| `V-002` | Photo appears to show a different kind of asset than the record claims | Yes |
| `V-003` | Photo shows the work unfinished while the record marks it complete | Yes |
| `V-004` | Photo shows signs warranting a human authenticity review | Yes |

`V-003` is deliberately one-directional: it fires when a work marked *complete* looks unfinished — the direction that precedes a released payment. The reverse is a benign reporting lag and is not a finding.

Byte-identical photo reuse — the same file uploaded against two different works — is caught deterministically at upload time by content hash.

### Ask the Corpus

A plain-English question is turned into a database query, which is then put through a **guard** that rejects anything that is not a read, and executed inside a read-only transaction. Two independent locks, because one is not enough when a model writes the query.

### The citizen portal

A public view of works with strict leak prevention — internal triage state (alerts, officer decisions, dismissal reasons) can never reach it. This is enforced structurally and has its own test.

### The field inspection form

An inspector on site records an 8-point checklist, notes, and GPS coordinates. Two things about it are worth noting because they were recently *fixed*, and the bugs are instructive:

- The eight checklist boxes used to default to **checked**. An inspector who opened the form and submitted it filed a complete clean bill of health for a work they had never looked at. They now start unchecked.
- The GPS field used to default to the coordinates of Delhi when the browser could not get a location. That planted a real-looking but false coordinate in a database column that cannot be empty. Submission is now **blocked** until a real fix is acquired.

### The honesty instruments

Four screens exist purely to let you check the platform's own claims:

- **`/evaluation`** — measures the rule engine's precision and recall against a known answer key, over the eleven rules that have ground truth. It names those rules, counts the alerts it could not judge, and renders any metric with a zero denominator as an em-dash.
- **`/calibration`** — compares the generated corpus against the published national figures, so you can see how representative the test data is.
- **`/readiness`** — a field-by-field checklist of what the ingest actually reads, what it ignores, and what it defaults. This is where the system confesses its data gaps.
- **`/rules`** — the full catalogue with verification statuses and dormancy reasons.

### Tests

Eight suites pass, covering the hash chain (including tamper detection and restoration), the public-view leak prevention, the null-safety guarantee, the cost-overrun rule, the duplicate detector's 2-of-3 logic, and an end-to-end pipeline run.

## A.4 Built, but not yet switched on

**This is the most important section in Part A.** A large amount of recent work is written and tested, but its **database migrations have not been applied**. Until someone applies migrations `013` through `017` in the Supabase console and redeploys, these features return server errors on a live deployment.

| Feature | State | What is blocking it |
|---|---|---|
| **Document AI** (`D-001`…`D-008`) | Code complete, tests written | Migration `013_document_extraction.sql` not applied; redeploy pending |
| **Photo verification** (`V-001`…`V-004`) | Code complete, tests written | Migration `014_photo_analysis.sql` not applied |
| **Semantic duplicate check** | Code complete, tests written | Migration `015_work_embeddings.sql` not applied |
| **"Checks run" tracking** | Code complete | Migration `016_checks_run.sql` not applied |
| **Inspector evidence vs agency claims** (`I-001`…`I-004`) | Code complete, tests written | Migration `017_inspection_evidence.sql` not applied |

These are committed to the repository on a working branch, so they are no longer at risk of being lost with a single working tree. What remains outstanding is the database: none of the five migrations has been run against the live instance, and the code will fault against the current schema until they are.

The semantic duplicate check is a genuine upgrade over `R-009`: the existing rule compares titles by shared words, which misses *"CC road"* against *"cement concrete road"* and *"Anganwadi Kendra"* against *"Anganwadi Centre"*. The new one compares meaning, and reads the description field that the old one throws away entirely.

## A.5 A design decision worth recording

The inspector-evidence feature in the table above went through an adversarial design review before any code was written, and that review changed the design. It is worth recording, because the obvious version of the feature is quietly unsafe.

The obvious version compares the inspector's GPS against the work's recorded coordinates. That comparison is corrupted by the ingest bug described in A.7: every work whose spreadsheet row carried no coordinate was written to a single point in central Delhi. Compared naively, every honest inspection of such a work reads as a location mismatch — the platform would manufacture a stream of confident findings out of nothing but its own data gap.

Two things came out of that. The primary geographic check (`I-001`) compares the inspector's GPS against the **photograph's own EXIF geotag**: two positions actually measured by two different parties, neither of them a platform default. The comparison against the work's recorded coordinates survives as a separate check (`I-004`), but fenced — it refuses to run when either coordinate sits on the ingest's default, so a work whose location was never captured yields no finding rather than a false one. A check that cannot tell a real location from a placeholder does not run at all.

## A.6 Not built at all

- **Free-text eligibility screening.** The highest-value idea in the plan and the one that is furthest away. An MP's recommendation arrives as prose — *"construction of community hall cum marriage hall near the Hanuman temple, Ward 7"* — and the guidelines carry a long annexure of eligible and ineligible items. This is a reading-comprehension problem, not a lookup. It is **blocked on a document nobody has obtained**: the guidelines annexure as text.
- **Offline inspection queue.** The field form is described as working offline. It does not. There is no offline queue and no service worker — the PWA plugin is a dependency that is never registered. A failed submission today loses the inspection, and the form now says so honestly instead of navigating away as though it had saved.
- **Authentication and authorisation.** See A.7.
- **Perceptual image hashing**, which is what `R-010` needs to come alive.

## A.7 Known broken or misleading things

**1. There is no authentication, at all.** The acting officer's name comes from a header the browser sets, unverified. The database connection uses a key that bypasses every access-control policy in the schema. There are no roles and no per-district scoping, so every endpoint is reachable by any caller acting as any officer.

This bounds exactly what the audit ledger proves. The chain is genuinely tamper-evident — an entry cannot be altered without the break being detectable. But the *actor* named in an entry is only as trustworthy as the header it came from. **Integrity, not authenticity.** The ledger proves a record has not changed since it was written; it does not prove it was true when written.

**2. `R-010` (Photo Reuse) is dormant, and this is handled well.** The rule is implemented and correct. It reads a database column that **nothing writes** — not the CSV import, not the data generator, not the inspection upload. So it can never fire.

The instructive part is what the project did about it. The rule was left *enabled* rather than switched off, and explicitly labelled `DORMANT` on the rules page and `NOT_INGESTED` on the readiness page. The reasoning is written down in the catalogue: a CRITICAL anti-fraud check that silently never fires reads as *"there is no photo reuse in this corpus"* — which is a finding the platform has not made and has no basis for. Better to show a rule as visibly unable to run than to let its silence be mistaken for a clean result.

**3. Missing coordinates are silently replaced with the coordinates of Delhi.** In `backend/src/routers/ingest.ts:240`, a work with no latitude in the source file gets `28.6139, 77.2090` written into the database. This is the same class of bug that was just fixed in the inspection form, one layer down.

It is partly known — the photo geotag check already documents it and lowers its own severity because of it. But it is worse than a cosmetic default: it makes the "never fire on missing data" guarantee **unreachable** for any check reading those columns, because the value is never actually missing. It is present, plausible, and wrong. Every unlocated work in the corpus is also clustered on one point in central Delhi, which will read as suspicious geographic coincidence to anyone who looks at a map.

**4. `R-011` (Ineligible Category) fires, but checks the wrong thing.** It tests a 15-value dropdown, while the eligibility signal lives in the free-text description that the dropdown discards. It is not broken; it is shallow.

**5. The corpus is generated, not real.** 2,000 works, roughly 6,300 stage payments, roughly 31,950 health reports, and 797 answer-key rows — all produced by a seeded generator. This is why `/calibration` exists.

**6. Accuracy numbers mean less than they appear to.** The evaluation harness measures the pipeline against an answer key that the same project wrote. That measures **pipeline fidelity** — does the code detect what it was designed to detect — not real-world detection accuracy. The page says this. So should anyone quoting it.

**7. There are 46 backend type errors** outstanding, and five orphan pages in the frontend that nothing routes to.

## A.8 Honest scorecard

| Area | Status |
|---|---|
| 21 compliance rules with explanations | Working |
| Officer triage queue, accept/dismiss, reason codes | Working |
| Tamper-evident audit ledger | Working (proves integrity, not authenticity) |
| Rule probation from real officer verdicts | Working |
| Self-assessment screens (evaluation, calibration, readiness, rules) | Working |
| Public citizen portal with leak prevention | Working |
| Field inspection form | Working; **not** offline-capable |
| Ask the Corpus | Working |
| Document AI — 8 checks | **Written, migration not applied** |
| Photo verification — 4 checks | **Written, migration not applied** |
| Semantic duplicate detection | **Written, migration not applied** |
| Inspector vs agency evidence — 4 checks | **Written, migration not applied** |
| Free-text eligibility screening | Not built, blocked on a document |
| Offline inspection sync | Not built |
| Authentication / authorisation | Not built |
| Photo reuse detection (`R-010`) | Dormant by design, needs image hashing |

---

# Part B — The pitch

> **Everything below assumes Part A's gaps are closed** — migrations applied, features committed and deployed, authentication built, and the system connected to real e-SAKSHI data rather than a generated corpus. It is the argument for the finished product, not a description of the current one.

## B.1 The problem, in numbers

Between 1 April 2023 and 22 January 2026, MPLADS sanctioned **₹6,680.29 Cr** across **1,11,600 works**. Completed: **₹3,387.38 Cr** and **69,061 works**.

That is **50.71% by value** and **61.88% by count**. *(Standing Committee on Rural Development.)*

The eleven-point gap between those two figures is the most interesting thing in the dataset. Works that finish are systematically **cheaper** than works that stall. Money concentrates in the works that do not get done. Any oversight system that counts works rather than rupees will report a rosier picture than the money supports.

And there is a second pool that gets almost no attention: roughly **₹6,654.76 Cr of recommendations never reach sanction at all** — about twice the value stalled *after* sanction. Works that die in the approval queue leave no completion record to audit, because they never became works.

## B.2 Why the problem survives

Not for lack of data. e-SAKSHI records all of it — every sanction, release, progress update, and completion date.

The problem is **attention**. Over a lakh works, a few hundred district officers, and no mechanism that says *look at this one first*. Every work looks like every other work in a table. Oversight defaults to whatever surfaces through complaints, media, or an audit that arrives years late.

Three failure modes follow from that:

1. **Nobody reads the boring cases.** Fraud does not announce itself. It looks like a slightly expensive community hall in a district nobody is watching.
2. **The paperwork is never cross-checked against the money.** A utilisation certificate is a scan in a folder. Nobody compares the figure on it against the expenditure in the system.
3. **Nobody stands where the photograph was taken.** Geotagged evidence is collected and then never checked against the location it claims.

## B.3 What DRISHTI is

**A triage layer that reads the whole corpus and hands a human a short, ranked, explained worklist.**

It does not replace e-SAKSHI, does not write to it, and does not make decisions. e-SAKSHI is the ledger; DRISHTI is the auditor's worklist.

```
  e-SAKSHI records
        │
        ▼
  ┌─────────────┐
  │   INGEST    │  read the corpus; record what was read and what was missing
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │ RULE ENGINE │  21 checks; never fires on missing data
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │   ALERTS    │  each one carries the two values it compared
  │  (budgeted) │  capped per district so the queue stays readable
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │   OFFICER   │  accept / dismiss with a reason
  └──────┬──────┘
         ├──────────► rule probation (rules that cry wolf get suspended)
         ▼
  ┌─────────────┐
  │AUDIT LEDGER │  SHA-256 chain; tampering is detectable
  └─────────────┘

  Uploaded evidence (documents, photographs) runs a parallel track
  producing FINDINGS attached to the file — never alerts, never budgeted.
```

Four commitments make it different from a dashboard:

**No single risk score.** DRISHTI will never blend a cost outlier, a missing certificate, and a delay into one number. Those are different kinds of wrong, requiring different responses, and averaging them destroys the only information the officer needs. Every signal is reported as itself.

**Never fires on missing data.** Absence of information is not evidence of wrongdoing. A work with no completion date is a data gap, reported as a data gap.

**Everything is explainable.** Every output names the two values it compared, in a sentence, in English. No output is ever "the model flagged this."

**Unmeasured quantities are never rendered as numbers.** A missing value shows as an em-dash and a sentence explaining why — never as zero. Zero is a measurement. Nothing is not.

## B.4 The loopholes it closes

Organised by the behaviour, not by rule number.

### Money leaving before the work arrives

Stage payments are meant to follow measured progress. The gap between money out and progress recorded is where the leak lives. `R-002` catches releases running more than 40 points ahead of progress — while deliberately excluding the mobilisation advance, which is *designed* to precede work. `R-004` and `R-013` catch spending and releases exceeding the sanction.

*Cannot catch:* progress figures that are inflated on the portal. The rule reads what was reported. That is exactly why photograph and inspection evidence matter — they are the only independent measurement in the system.

### Works that quietly stall

Nobody files a report saying "this has stopped." It simply stops appearing. `R-007` catches 180 days of silence. `R-006` catches works past the one-year scheme timeline. `R-018` catches works reporting less than half the progress a straight-line schedule expects. `R-015` catches indefinite holds. `R-019` catches a missed 10-day check-in — the earliest possible signal, because a work stops reporting before it stops existing.

*Cannot catch:* a work kept nominally alive with token progress updates.

### Paperwork that does not match the money

A utilisation certificate is the document that says the money was properly spent. `D-001` through `D-008` read it and compare it against the record: certified amount against expenditure, against sanction, against funds released; certificate date against completion date and sanction date; the agency named on the page against the agency on the record. `R-003` catches the simpler case — completed, and no certificate at all.

The design point: the model only *reads the page*. It is never asked whether the numbers disagree. That comparison is arithmetic, and a human can redo it.

*Cannot catch:* a document that is internally consistent and entirely fabricated.

### The same work funded twice

`R-009` requires **2 of 3** corroborating signals — similar title, within 500 m, similar amount — because any one alone is a coincidence. Two roads in one district can share a name; two works at one address can be genuinely different. Two of three is deliberate.

Semantic matching extends this past shared words, catching *"CC road"* against *"cement concrete road"* and equivalents across transliteration and paraphrase.

*Cannot catch:* duplicates deliberately described in dissimilar language and sited apart.

### Evidence that does not match the site

`V-001` measures the distance between the photograph's GPS geotag and the work's recorded location. No model involved — trigonometry on two coordinates, recomputable by anyone. Beyond 1 km it is a note; beyond 50 km a single work does not span that distance.

`V-002`, `V-003` and `V-004` compare a blind reading of the image against the record: is this the kind of asset claimed, does a work marked complete look complete, are there signs warranting an authenticity review. `V-003` is one-directional by design — the direction that precedes a payment.

And the strongest signal available: the **inspector's** photograph against the **agency's**. Two parties, two cameras, two recorded positions for the same site. Neither is a platform default.

*Cannot catch:* an unphotographed work, or a photograph with no geotag. Both are recorded as *not checked*, never as *checked and clean*.

### Statutory allocation dodges

`R-016` tracks the mandated 15% SC and 7.5% ST minimum share. It is reported as **compliance statistics, aggregated by constituency and financial year — never attributed to a named Member of Parliament.**

That constraint runs through the entire product, and it is a design decision, not squeamishness. MPLADS is politically charged. A system that produces a per-MP risk ranking becomes a political instrument in a week, and then it stops being used for oversight at all. Accountability here attaches to the **implementing agency** and the **district authority** — the parties who actually execute and disburse.

### Administrative delay as a hiding place

A work sitting undecided in the approval queue is invisible to any system that audits works. `R-020` and `R-021` put a clock on the sanctioning decision itself — breached at 45 days, warned at 35 — so the pool that never becomes a work is still visible.

### Inspection theatre

An inspection that happens on paper is worse than no inspection: it produces a clean record. `R-017` tracks what fraction of works under implementation were actually inspected, measured against works in progress — where an inspection can still change the outcome — rather than a sign-off sweep of finished assets.

The two bugs described in A.3 are the sharp end of this. A checklist that defaults to *verified* manufactures clean bills of health for works nobody visited. A GPS field that defaults to a city centroid plants false location data in a column that cannot be empty. Both are now fixed. Both are worth stating out loud, because they are exactly the failure mode this feature exists to detect — and the system had them itself.

*Cannot catch:* a physically present inspector filing a dishonest report. Nothing in software can.

### The worked example: a rule that admits it cannot run

`R-010` detects the same photograph reused across different works — a CRITICAL check against a real fraud pattern. It is fully implemented. It reads a database column that nothing writes, so it can never fire.

It is displayed as `DORMANT`, with the reason written out, rather than sitting quietly in the catalogue as an active check. Because a CRITICAL anti-fraud rule that never fires reads as *"there is no photo reuse here"* — a finding the platform has not made.

**That is the whole product in one example.** The value is not that DRISHTI finds everything. It is that DRISHTI is precise about what it did and did not check, so a clean result means something.

## B.5 Who it serves

**The district oversight officer** — the primary user. Arrives to a ranked queue instead of a table of a hundred thousand rows. Reads an alert, sees the two numbers, decides. The dismissal is not a dead end: it trains the system's view of its own accuracy.

**The field inspector** — a phone form with a real checklist and a real geotag, feeding the coverage statistics that make inspection measurable rather than assumed.

**The implementing agency** — performance visible across works: what it delivers, where it stalls, how its alerts resolve. Agencies are where accountability attaches, so this is the surface that matters most for consequences.

**The citizen** — a public view of works in their area, structurally prevented from leaking internal triage state. An open alert is an unproven suspicion; publishing it would be an accusation the platform has not made.

**The auditor or evaluator** — the honesty instruments. Measured accuracy with named limits, corpus calibration against national figures, a field-level ingest checklist, and a verifiable ledger. Enough to audit the auditor.

## B.6 Why it is believable

Most oversight tools ask you to trust a score. DRISHTI is built so you do not have to:

- **Every rule is in one readable catalogue** with its thresholds visible on screen.
- **Every rule states how much to trust it** — checked against the source, believed correct, or our own operational choice. These are not conflated.
- **Every alert shows its arithmetic.** Recompute it on paper.
- **Rules are held to account by the humans using them.** A rule officers keep dismissing gets suspended.
- **Accuracy is measured and published, with its own limits stated** — including that it measures pipeline fidelity, not real-world detection.
- **The ledger is verifiable**, and precise about proving integrity rather than authenticity.
- **Data gaps are a screen, not a footnote.** `/readiness` lists every field, whether it is read, and what happens when it is absent.

## B.7 What it deliberately refuses to do

- **It does not score Members of Parliament.** Accountability attaches to the implementing agency and the district authority.
- **It does not produce a single risk number.** Different wrongs need different responses.
- **It does not accuse.** Every output is a worklist item. A human accepts or dismisses. The system's job ends at *this is worth your time*.
- **It does not guess.** Missing data produces no finding and no zero — it produces an em-dash and a reason.
- **It does not claim a clean result it did not verify.** "Checked eight things, found nothing" and "could not check anything" are different sentences, and the system knows which one it is saying.

---

## Where to look in the code

| Capability | File |
|---|---|
| The 21 rules, thresholds, verification statuses | `backend/src/rules/mplads_rules.yaml` |
| Rule evaluation and null-safety | `backend/src/services/rule_engine.ts` |
| Document field extraction (model) | `backend/src/services/document_ai.ts` |
| Document comparison (arithmetic) | `backend/src/services/document_reconcile.ts` |
| Photo reading (model) | `backend/src/services/photo_ai.ts` |
| Photo comparison, geotag distance | `backend/src/services/photo_reconcile.ts` |
| EXIF geotag parsing | `backend/src/services/exif.ts` |
| Semantic duplicate matching | `backend/src/services/work_embeddings.ts` |
| Natural-language query, read-only guard | `backend/src/services/nl_query.ts`, `backend/src/services/sql_guard.ts` |
| Tamper-evident ledger | `backend/src/services/audit_chain.ts` |
| Accuracy measurement | `backend/src/services/evaluation.ts` |
| Rule probation | `backend/src/services/probation.ts` |
| Ingest field checklist | `backend/src/services/readiness.ts` |
| Public view leak prevention | `backend/src/services/public_view.ts` |
| CSV ingest *(contains the Delhi-centroid default, A.7)* | `backend/src/routers/ingest.ts` |
| Field inspection form | `frontend/src/pages/InspectionFormPage.tsx` |
| Work detail with evidence panels | `frontend/src/pages/WorkDetailPage.tsx` |
| Pending migrations | `supabase/migrations/013`–`016` |
