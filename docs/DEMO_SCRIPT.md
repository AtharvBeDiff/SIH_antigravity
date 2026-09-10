# DRISHTI — Judge Demo Script

**Format:** ~10 minutes live + Q&A. Every number below was read off the live
deployment on 10 Sep 2026. Re-check them the morning of the demo — if the corpus
is re-seeded they will move.

**One-line thesis, say it early and say it again at the end:**
> e-SAKSHI is the ledger. DRISHTI is the auditor's worklist.

---

## 0. Pre-flight — 10 minutes before you present

- [ ] **Wake the backend.** Open `https://drishti-backend-i43n.onrender.com/api/health`
      and wait for `{"status":"ok"}`. The free tier sleeps; a cold first request took
      **21 seconds**. If you skip this, your opening slide is a spinner.
- [ ] Open `https://drishti-mplads.vercel.app` and click through Dashboard →
      Triage Queue → Rules → Audit → Ask. This warms every route.
- [ ] On the Audit page, click **Re-Verify Ledger** once. It must say valid.
      If a previous rehearsal left the chain tampered, click **Restore Chain Integrity** now.
- [ ] Have a second tab open on the Rules Matrix, scrolled to **R-010**. You will
      jump to it and you do not want to scroll while talking.
- [ ] Phone hotspot ready. Venue wifi fails.

**Know your live numbers:**

| | |
|---|---|
| Works in corpus | 1,000 |
| Sanctioned | ₹291.09 Cr |
| Released / spent | ₹141.33 Cr / ₹83.32 Cr |
| Completed | 178 works (17.8%) |
| Findings raised | 2,057 |
| **In today's queue** | **117 open**, 883 held in backlog |
| Severity split | 726 critical, 224 high, 18 medium, 32 low |
| Audit chain | 135 blocks, verifying clean |
| Rules | 21 |

---

## 1. The problem (0:00–1:00) — no screen, just talk

Do not open with the product. Open with the gap.

> "Between April 2023 and January 2026, MPLADS sanctioned ₹6,680 crore across
> 1.11 lakh works. e-SAKSHI recorded every one of them correctly. It is a good
> system of record.
>
> But it has two properties that follow from what it *is*, not from any flaw.
>
> First — **it is a table, not a queue.** A lakh of works, a few hundred district
> officers, and nothing anywhere that says *look at this one first*. Every work
> looks like every other work in a list. So oversight happens when a complaint
> arrives, or the press, or an audit three years later. The data was always there.
> The attention was not.
>
> Second — **almost all of it is reported by the party being overseen.** Progress
> percentages, completion dates, expenditure. That is not an accusation, it is how
> the scheme is administered. But it means any check reading only e-SAKSHI is
> checking someone's account of themselves against their own other statements.
> It catches inconsistency. It cannot catch a consistent misstatement.
>
> DRISHTI is built on exactly those two gaps."

**Why this lands:** you have told the judges you understand the incumbent system
and are not trash-talking it. Teams that open with "government systems are broken"
lose the room. You just showed you can read a Standing Committee report.

---

## 2. Dashboard (1:00–2:00)

**Do:** Open the Dashboard.

> "This is a live corpus of 1,000 works, ₹291 crore sanctioned. Seventeen point
> eight percent complete by count.
>
> DRISHTI reads all thousand mechanically and raised **2,057 findings**.
>
> Now — that number is useless to an officer. Two thousand items is the same as
> zero items. So look at what's actually in the queue: **117.**"

**Do:** Point at the open vs backlog figures.

> "The rest are held in a backlog on purpose. Findings are **capped per district**,
> because an oversight queue that returns four hundred items per district doesn't
> get worked, it gets ignored. We are budgeting attention, not maximising alerts."

**Why this lands:** every other team will brag about how many alerts they generate.
You just explained why that's the wrong metric. This is your first real
differentiator and it takes fifteen seconds.

---

## 3. Triage Queue → open one alert (2:00–4:00) — **the core**

**Do:** Click Triage Queue. Let them see the ranked list. Open one alert.

> "Every item names the two values that disagreed."

**Do:** Read the actual evidence line off the screen. For example:

> "*'Work has been waiting for sanction for 49 days, exceeding the 45-day SLA.'*
>
> Forty-nine against forty-five. That is the whole finding. An officer can verify
> that on paper in ten seconds, and — this matters more — **they can disagree with
> it on the spot.**
>
> There is no risk score here. We will never blend a cost outlier, a missing
> certificate and a delay into one number between 0 and 100. Those are different
> kinds of wrong, they need different responses, and averaging them destroys the
> only information the officer actually needs."

**Do:** Show the accept / dismiss controls.

> "The officer accepts or dismisses, with a reason. The reason is mandatory,
> and it is not bureaucratic friction — dismissals are the **only evidence a rule
> produces noise.** A rule officers keep dismissing gets automatically suspended.
> The system is held to account by the people using it."

**Why this lands:** "explainable AI" is a phrase every team says. You are showing
two integers and a subtraction. That is more convincing than any SHAP plot.

---

## 4. Rules Matrix — the honesty move (4:00–5:30)

**Do:** Switch to your pre-scrolled second tab. Show the 21 rules with thresholds visible.

> "Twenty-one rules, every threshold on screen. Nothing hidden in a config file."

**Do:** Now point at **R-010, marked DORMANT.**

> "This one is the most important thing on the screen.
>
> R-010 detects the same photograph reused across different works — a real fraud
> pattern, and it's marked CRITICAL. It is fully implemented and tested.
>
> It reads a database column that nothing currently writes. **So it can never fire.**
>
> We display it as DORMANT, with that reason written out — because a critical
> anti-fraud check that silently never fires reads to an officer as *'there is no
> photo reuse here.'* That is a finding we have not made. A clean result only means
> something if you know what was actually checked."

**Do:** Say the general principle.

> "That discipline runs through the whole system. We record which checks ran on
> every comparison, so *'we checked eight things and found nothing'* and *'we could
> not check anything'* are different sentences. Both produce zero findings. They
> mean opposite things — and a system that can't tell them apart is worse than no
> system, because it manufactures false confidence.
>
> Missing data never becomes a finding, and never becomes a zero. It renders as a
> dash and a reason. **Zero is a measurement. Nothing is not.**"

**Why this lands:** this is your single strongest differentiator. Every other team
will hide their broken feature. You are putting yours on screen with a label and
turning it into the argument for your design philosophy. Judges remember this.

---

## 5. Audit Hash Ledger — the showstopper (5:30–7:00)

**Do:** Open Audit Hash Ledger. Show the green banner: **135 blocks validated.**

> "Every officer decision goes into a SHA-256 hash chain. Each block commits to
> the one before it. Right now: 135 blocks, all valid.
>
> Don't take my word for it. Let me attack it."

**Do:** Click **Simulate Malicious Tampering.**

The page re-verifies automatically. The banner turns red and names the block.

> "I just reached into the database and altered one historical record — the way a
> bad actor with database access would. The chain caught it immediately and told
> you **exactly which block** broke and why. You cannot quietly rewrite history here."

**Do:** Click **Restore Chain Integrity.** Green again.

**Say this next — do not skip it:**

> "One honest limit. The chain proves **integrity, not authenticity.** It proves
> the record wasn't altered after the fact. It does not prove who wrote it, because
> this build has no authentication — the acting officer's name comes from an
> unverified header. That is fine for synthetic demo data and it is not fine for
> real data. Authentication is the first thing we'd build for deployment."

**Why this lands:** you performed an attack against your own system, live, and it
held. Then you volunteered its weakness before a judge could find it. That
combination reads as engineering maturity and it buys you enormous credibility
for everything you say afterwards.

**Rehearse this twice.** Tamper → wait for red → Restore → wait for green. Do not
click Restore early.

---

## 6. Ask the Corpus (7:00–8:30)

**Do:** Open Ask the Corpus. Use a prepared question:

> *"Which agencies have the most overdue works?"*

Let it run. It converts English to SQL with Gemini and shows you the SQL.

> "Plain English in, SQL out — and we show you the query, so the answer is
> checkable rather than trusted."

**Do:** Now the important part.

> "Obvious danger: you've let a language model write SQL against a government
> database. So it doesn't get to. The generated query runs as a **read-only
> role, inside a read-only transaction**, against eleven whitelisted tables,
> capped at 500 rows and a five-second timeout.
>
> We tested it adversarially — asked it to run an UPDATE. The database refused
> at the transaction layer. It isn't a prompt asking the model to behave. The
> permission to write does not exist."

**Why this lands:** every team is bolting an LLM on. You are the team that fenced
it. Naming the specific failure mode and showing the specific mitigation is what
separates you.

---

## 7. The refusals (8:30–9:30)

**Do:** Open Integration Schema (`/readiness`) and scroll it slowly while you talk.

> "This screen is a field-by-field confession: every column in the export, whether
> we read it, and what happens when it's missing. It exists so the cost of a messy
> real-world export is visible *before* deployment, not discovered after."

**Then — say the refusals. These matter as much as the features:**

> "Four things this system deliberately will not do.
>
> **It does not score Members of Parliament.** Accountability attaches to the
> implementing agency and the district authority — the parties that execute and
> disburse. That's enforced in the codebase, not a disclaimer. A per-MP risk
> ranking becomes a political instrument within a week and then stops being used
> for oversight at all.
>
> **It does not accuse.** Every output is a worklist item. A human decides. The
> system's job ends at *this is worth your time.*
>
> **It does not write back to e-SAKSHI.** Read-only. It cannot corrupt the register
> of authority, and it needs no write credentials. Turn DRISHTI off and everyone is
> exactly where they started.
>
> **It does not publish suspicion.** The citizen portal is structurally prevented
> from leaking internal triage state. An open finding is an unproven suspicion.
> Publishing it would be an accusation we have not made."

---

## 8. Close (9:30–10:00)

> "e-SAKSHI already knows everything that happened. Nobody has the hours to read
> it, and almost all of it is the executing side's account of itself.
>
> DRISHTI reads the whole corpus mechanically, ranks the small number of works
> whose own numbers disagree, explains each one in a sentence an officer can
> check — and is precise about what it did not look at.
>
> It accuses nobody, scores nobody, decides nothing. Which is the only reason a
> clean result from it means anything at all."

Stop talking. Let the silence sit.

---

## If they cut you to 3 minutes

Dashboard (2,057 found → 117 queued, budgeted attention) →
one alert (49 vs 45, two values, no risk score) →
Audit tamper demo (attack it live, restore it) →
the R-010 DORMANT line.

That's the whole pitch. Everything else is supporting detail.

---

## Q&A — prepared answers

**"How is this different from a dashboard / Power BI?"**
> A dashboard shows you the data you asked for. This ranks what you should look at
> without being asked, explains why in a checkable sentence, records your decision
> in a tamper-evident chain, and suspends its own rules when you keep dismissing
> them. And it tells you what it failed to check — no dashboard does that.

**"Is the data real?"**
> No — it's synthetic, generated from a fixed seed so it's reproducible, and I'll
> say plainly it is not calibrated to national completion rates. What's real is the
> rule engine, the audit chain, the query guard, and the ingest, all of which run
> unchanged against a real e-SAKSHI export. The ingest reads the documented
> 22-column format.

**"What's your accuracy / precision and recall?"**
> We built a screen for exactly that question, and I'll be straight with you: it
> currently reports blank, because the ground-truth answer key isn't loaded in this
> deployment. It reports blank rather than a plausible-looking number — which is
> the same discipline as the dormant rule. The measurement harness exists; the
> labelled data isn't in there yet.

*(Do not bluff a number. If you invent one, and they ask how you validated it, you
have just destroyed the credibility of the honesty argument that is your whole pitch.)*

**"What if the agency just inflates progress on the portal?"**
> That's the right question and it's the limit of any rule reading only e-SAKSHI —
> those compare the record against itself. It's why we added three sources produced
> by a *different party or instrument*: a photograph's EXIF geotag, written by a
> camera not typed by a person; the utilisation certificate, authored outside the
> portal; and a field inspector with their own GPS. The sharpest signal is the
> inspector's photo against the agency's photo — two parties, two cameras, two
> independently recorded positions for one site. Those are built and tested; they're
> not switched on in this deployment.

**"Why no risk score? Every other system has one."**
> Because a cost outlier, a missing certificate and a six-month delay are different
> kinds of wrong needing different responses. Averaging them into a 73 destroys the
> only information the officer needs — which is *what* is wrong. A score is easy to
> display and impossible to act on.

**"Can it scale to 1.11 lakh works?"**
> The rule pass is linear over works with the payment history pre-fetched in one
> query rather than per work. The per-district budgeting means the officer-facing
> queue does not grow with the corpus — which is the number that actually has to
> stay bounded.

**"What's not built?"**
> Authentication — that's the big one, and it bounds what the audit chain proves.
> Free-text eligibility screening, offline inspection sync, and perceptual image
> hashing, which is what R-010 needs to come alive. Document, photo and inspection
> evidence are written and tested but not switched on here.

---

## Do not do these

- **Do not open Corpus Calibration.** It is permanently blank — nothing in the
  codebase ever populates it. If a judge clicks it, say: "that screen needs a
  computation step we haven't wired up."
- **Do not open Empirical Evaluation** unless asked about accuracy. Then use it
  deliberately, with the answer above.
- **Do not open Field Inspection** expecting a list. It's empty.
- **Do not quote national completion rates as if they describe this corpus.**
  This corpus is 17.8% complete; the national figure is 61.88%. If you conflate
  them and a judge does the arithmetic, you lose the room.
- **Do not read out the "14" on the Triage Queue badge.** It's a hardcoded
  placeholder and it contradicts the 117 you'll be quoting.
- **Do not say "AI-powered" as a general claim.** Say precisely where a model is
  used: English-to-SQL, document reading, photo reading, semantic title matching.
  The 21 rules are arithmetic and thresholds — that's a strength, say so.
