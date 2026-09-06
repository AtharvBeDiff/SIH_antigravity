# DRISHTI — Implementation Plan

Single authoritative work list: every fix from the audit plus every feature not yet built.
Derived from `RESEARCH_AUDIT.md` after the Part F verification pass. Every file:line
citation below was checked against the working tree.

**How to use this with Claude:** work one item at a time, in the order given. Each item
states the file, the current behaviour, and the required behaviour. Do not batch tiers —
Tier 0 items change what the product *claims*, and a later fix built on an unfixed claim
compounds the problem.

---

## Guardrails — read before writing any code

These are the project's own doctrines (`HANDOFF.md`). They constrain every item below.

1. **Read-only.** DRISHTI never writes to e-SAKSHI or mutates source records.
2. **Severity tiers, not composite risk scores.** Never collapse rules into one number.
3. **No MP-level risk aggregation.** Agency-level and district-level are fine; MP-level is not.
4. **The public view is a whitelist**, never a blacklist.
5. **`verification_status` is an honesty contract.** A rule marked `VERIFIED` must be
   sourced *and* reachable by a code path.
6. **No rule fires on a null field.** Missing data is a data-quality finding, never
   evidence of wrongdoing.
7. **Explainable detectors only** — MAD z-score over IsolationForest, and every alert
   must show its arithmetic.
8. **Officer-trust machinery** (alert budget, rule probation, dismissal reason codes) is
   a feature, not overhead.
9. **Tamper-evident ledger.** Every state mutation calls `appendAudit()`.
10. **Synthetic data is always labelled as synthetic.**

**AI honesty tiering** — apply this label to every feature you build and never inflate it:

- **Tier 1** — genuine AI. The input is unstructured: free text, images, scans, speech.
  No rule-based substitute exists.
- **Tier 2** — a rule exists; AI raises its ceiling.
- **Tier 3** — deterministic arithmetic. Build it, ship it, **do not call it AI.**

---

# PART 1 — FIXES

## Tier 0 · Integrity — claims the screen makes that the code does not earn (~1 day)

Nothing else on this list matters if these ship.

**F-01 · Delete the fake copilot.** Remove the `setTimeout` and the "Live" badge on `/`.
It is the most falsifiable thing in the build. Replaced properly by P-15.

**F-02 · `/evaluation` reports fabricated precision/recall.** `answer_key` has zero writers
repo-wide, so on live data the hero cards compute to precision 0.0, recall 0.92, F1 0.0.
- Remove the `0.88 / 0.92 / 0.90` fallbacks at `frontend/src/pages/EvaluationPage.tsx:27-29`
- **And server-side** at `backend/src/routers/evaluation.ts:97,98,101` — removing them
  from the UI alone is not the fix
- Remove the hardcoded per-type table at `EvaluationPage.tsx:88-93`
- Remove the `docs/DEMO_SCRIPT.md:43` instruction to call these "real measured". The pair
  it names (91.6 / 94.4) cross-mixes two different anomaly classes (`:88` and `:89`) and
  can never render together as the headline pair
- Either populate `answer_key` for real, or relabel the screen honestly

**F-03 · `/readiness` asserts capabilities that do not exist.**
`backend/src/services/readiness.ts:16-39` is a static array in which all 21 rows say
`mapped: true, status: 'READY'` — including `:37` (photo hash key, a field with zero
writers) and `:38` (audit signature, presented as an *e-SAKSHI* column, which it is not).
Compute it from real state, or relabel the page "target mapping".

**F-04 · Six phantom rule IDs in live circulation** that do not exist in the 19-rule YAML.
They render in `/alerts` but cannot be resolved on `/rules`, cannot be probated, and carry
no `verification_status` badge — Doctrine 5 broken at the UI layer.
- `backend/src/services/sla_engine.ts:41` — `RULE_MPLADS_006_SLA_BREACH`
- `sla_engine.ts:55` — `RULE_MPLADS_005_SLA_RISK`
- four more seeded at `data-gen/generate.ts:65-70`

**F-05 · Strip every named-MP claim** (Doctrine 3).

**F-06 · Scrub the live Supabase project URL** from `README.md:25` **and `:29`**.
No key rotation needed: `README.md:26`'s `eyJhbGci...` is 8 characters of universal JWT
header carrying no secret material, and `backend/.env` is correctly gitignored and was
never committed (verified via `git log --all`).

---

## Tier 1 · Constants Part F has settled (~half a day)

No longer research — a find-and-replace with a known answer. Highest leverage in the plan.

**F-07 · Replace 19.24% with the official pair: 50.71% by value, 61.88% by count.**
(Standing Committee, 1 Apr 2023 – 22 Jan 2026: ₹3,387.38 Cr completed of ₹6,680.29 Cr
sanctioned; 69,061 of 1,11,600 works.) Nineteen literal sites, twenty occurrences, ten
files. The three easy misses first:
- `supabase/full_schema.sql:304` — `target_completion_rate ... DEFAULT 0.1924`
- `supabase/migrations/001_initial_schema.sql:303` — same default; a fresh database
  reintroduces the wrong number after the code is clean
- `frontend/src/components/ui.tsx:130` — `target = 19.24` is a **default prop** on a
  reusable gauge; any future caller that omits the prop inherits the error silently

Then: `ui.tsx:126,129,338`; `backend/src/services/calibration.ts:5,13` (its `:23,24,44`
consume the constant by name and follow automatically — but also fix `:23`'s fallback,
which reports 0% deviation on an empty database); `CalibrationPage.tsx:27,34,69`;
`OverviewPage.tsx:185,332,336`; `README.md:10,69`; `docs/API_CONTRACT.md:50`;
`docs/DATA_CONTRACT.md:35`; `docs/DEMO_SCRIPT.md:3,9` (twice on line 9).

While in `CalibrationPage.tsx:69`, delete the sentence claiming the generator is
"hard-calibrated to preserve the true 19.24% delivery ratio" — it sits in the same
paragraph as a warning that 70–80% completion corpora break the detectors, and the
official figure is 61.88%, so the file currently argues against itself.

**F-08 · Completion limit 24 → 12 months. Note carefully *where*.**
The guideline is "generally not more than one year from the date of sanction."
`max_months` in the YAML is **dead configuration** — `rule_engine.ts` has no R-006 case
and never reads the key; its only consumer is the `{{max_months}}` string interpolation.
Editing the YAML alone changes only what the alert *says*.
- `backend/src/detectors/delay.ts:17` — `if (months > 24)`, drives R-006 **(live)**
- `backend/src/detectors/delay.ts:74` — `const maxMonths = 24`, drives R-018's
  `expectedProgress` **(live, and independent of the above)**
- `backend/src/services/readiness.ts:26` — "24-month limit"
- `frontend/src/pages/WorkDetailPage.tsx:140` — `'Standard 24 Months'` fallback string
- `backend/src/rules/mplads_rules.yaml:111` and `:167` — text only, but fix for consistency

Fixing R-006 does **not** fix R-018; they are separate literals, and R-018 has been holding
every work to half the required pace. Also add the guidelines' exceptional-extension
provision so a sanctioned extension does not read as a breach, clear R-006's
`NEEDS_VERIFICATION` with the clause cited, and **make the detectors actually read their
YAML params** — a rule catalogue whose numbers are ignored is worse than none.

**F-09 · R-017 inspection — wrong number, wrong population, computed nowhere.**
The mandate is ≥10% of works **under implementation**, annually.
- `mplads_rules.yaml:344` — `target_coverage_pct: 50` → `10`
- `mplads_rules.yaml:346` — evidence template reads
  `"{{inspected}} of {{completed}} completed works"`; wrong denominator in the string a
  judge will actually read
- Change the population from `COMPLETED` to `IN_PROGRESS`
- Actually compute it — `grep -rn "coverage\|inspected" backend/src --include=*.ts`
  returns nothing
- `CompliancePage.tsx:76-86` hardcodes "65 assets", "38 assets (58.5%)", "TARGET MET"
- `CompliancePage.tsx:70` — first clause is a correct guideline, second is invented
- R-017 can then drop `PLATFORM_POLICY` and become sourced

**F-10 · `quota.ts` computes the wrong compliance test entirely.**
`backend/src/routers/quota.ts:34-46` divides SC/ST **sanctioned** value by the **district's
total sanctioned** value (in fact by all non-`CANCELLED` works, `:24`). The guideline is
SC/ST **recommended** value ÷ **the MP's annual entitlement**. It can report 20% SC
compliance on a portfolio the guidelines score at 8%.
- Fix numerator (recommended, not sanctioned) and denominator (MP entitlement, ₹5 Cr/yr)
- Wire `CompliancePage.tsx` to `/api/quota` — it never calls it and renders hardcoded
  16.4% / 8.1%
- Fix R-016's description at `mplads_rules.yaml:320-322`, which names "the constituency"
  where the guideline names the MP. The params (`sc_min_pct: 15`, `st_min_pct: 7.5`) are
  confirmed correct — R-016 keeps its `VERIFIED` status.

**F-11 · Fund flow — populate the `payments` table that already exists.**
`supabase/full_schema.sql:127-137` (and `001_initial_schema.sql:126`) already define it;
it is read at `works.ts:61` and `heatmap.ts:29`; it has **zero writers**. This is a
population job, not a design job.
- Reshape `installment_number` into a **stage key** (payment is stage-wise vendor requests,
  not two tranches)
- Populate from ingest and the generator
- Retire `first_installment` / `second_installment` from the ingest contract — two columns
  cannot hold an N-stage history, cannot support "no payment for extended periods," and
  cannot reconcile against PFMS
- `works.last_payment_date` has one reader (`delay.ts:33`) and zero writers, so
  payment-cadence logic silently falls back to `sanction_date`
- Reinterpret rather than delete R-002 (verification-integrity signal), R-012 (stage-payment
  pipeline signal) and R-014 (table stakes)
- **Record the regime boundary** somewhere the rules can see it: revised guidelines start
  1 April 2023, TSA Hybrid / Model 1A starts 1 April 2025. The dataset spans three fund-flow
  regimes with no field distinguishing them, and any rule reasoning about fund movement
  needs to know which side of those lines a work sits on.

---

## Tier 2 · Data and ingest (~1 day — do this before demoing anything)

**F-12 · The 45-day SLA rule cannot fire on any ingested row.**
`backend/src/routers/ingest.ts:418-419` assigns `work.sanctionDate` to **both**
`recommended_date` and `sanction_date`. Since `sanction_date` is a **required** CSV field
(`ingest.ts:186`, `REQUIRED_FIELDS` at `:39-48`, `parseDate` at `:138-145` throws when a
required field is empty), no ingested row can have a null sanction date — so
`sla_engine.ts:18`'s `.is('sanction_date', null)` filter discards **every** row and the
`continue` at `:31` is never reached. The flagship detector is structurally dead on the
ingest path while appearing to work on seeded data.
- Add a real `recommendation_date` to the ingest contract; stop the aliasing
- None of the three CSVs currently has a `recommendation_date` column

**F-13 · Rejections are counted as SLA breaches, and there are two implementations.**
The guidelines require sanction **or rejection** within 45 days, so a timely rejection is
compliant. `sla_engine.ts` filters only on `sanction_date IS NULL` with no status filter;
`backend/src/routers/sla.ts:22` *does* filter `.eq('status','PROPOSED')`.
- Add a status filter to `sla_engine`
- Reconcile the two implementations into one — two implementations of one clause is how
  definitions drift apart
- Report "rejected within SLA" as its own outcome, not a breach

**F-14 · Regenerate the corpus across a realistic 2023–2026 span.**
- Seeded `recommended_date` spans only **nine weeks**, 2026-06-26 → 2026-08-24, so under
  the 12-month rule nothing in it can be overdue and the vintage-adjusted denominator is
  zero rows
- **39 of 200 seeded works carry a future `sanction_date`** (max 2026-10-09 in
  `drishti_works_dataset.csv`)
- 30 works are `COMPLETED` inside nine weeks — demonstrating *fast* delivery, the opposite
  of the pitch
- The other two CSVs begin **2023-02-11**, before the 1 April 2023 guidelines existed

**F-15 · Rebuild the generator.** `data-gen/generate.ts`:
- `:115` emits **200 works** where `HANDOFF.md:172-173` claims ~2,000
- `:151` emits **50 random alerts** where the docs claim ~120 planted anomalies
- writes **no answer key** — which is why `/evaluation` is fabricated
- `STATUSES` at `:63` emits `PROPOSED` / `APPROVED`, which are **not valid**
  `WORK_STATUSES` — so R-014 and the `NOT_STARTED` branches of R-006/R-007 can never fire
  on generated data
- `CATEGORIES` at `:62` emits ingest **aliases** (`ROADS`, `WATER`), not canonical values
- sets 16 of the 34 `works` columns
- it does correctly honour the seeded-PRNG requirement — keep that

**F-16 · Stop the generator overwriting version-controlled schema history.**
`generate.ts:167-168` overwrites `supabase/migrations/004_seed_data.sql`, a git-tracked
migration. Note the command is `npm run generate -w data-gen` — there is no `generate`
script in the root `package.json` (it lives at `data-gen/package.json:7`).

---

## Tier 3 · Correctness and housekeeping (~1–2 days)

**F-17 · R-011 eligibility cannot fire via any code path, yet is marked `VERIFIED`.**
The 7-value ineligible list at `backend/src/services/rule_engine.ts:30-33` shares no value
with the 15 categories ingest accepts (`types.ts:41-57`; `RELIGIOUS_HERITAGE` ≠
`RELIGIOUS`), and `types.ts:68` declares a *third* list with zero importers. Either make it
fire, or mark it specified-not-implemented and **remove `verification_status: VERIFIED` at
`mplads_rules.yaml:239`**. A judge forgives a documented gap, not a verified rule that
cannot fire. Superseded properly by P-01.

**F-18 · `health_reports` table is dropped and never created.**
`full_schema.sql:16` `DROP`s it; there are 19 DROPs and 18 CREATEs. The cadence detector
reads `works.updated_at` (`delay.ts:97-115`) and never queries the table at all, and
`backend/src/routers/health_reports.ts:39-41` swallows the missing-table error and returns
`[]` — so the GET pretends the feature works while the POST 500s. Create the table, query
it, stop swallowing the error.

**F-19 · Two state mutations bypass `appendAudit()`**, violating `audit_chain.ts:4`:
- `sla_engine.ts:70-72` upserts alerts unaudited
- `health_reports.ts:73` inserts a report **and `:77-80` overwrites
  `works.physical_progress_pct`** — the field every progress rule reads — unaudited

**F-20 · Photo-reuse detection is structurally dead.** No image is ever read; no hashing
library in any `package.json`; `evidence_image_key` absent from the 21-column ingest spec
and from all three CSVs; `works.evidence_image_key` — the field the detector reads — has
**zero writers**. The only writer anywhere (`HealthReportForm.tsx:31` constructs, `:36`
sends) writes a *filename*, not a hash, into `health_reports.evidence_image_key` — a
different table, which does not exist. Fix the pipeline before claiming the capability.

**F-21 · Fix the counts everywhere: 19 rules, 18 tables, 17 routers, 20 routed pages.**
- Rules stated as 17 at `frontend/src/components/layout/MainLayout.tsx:55`,
  `RulesPage.tsx:36`, `RulesPage.tsx:43`, `backend/src/services/rule_engine.ts:4`, and the
  `mplads_rules.yaml` header comment
- `docs/ARCHITECTURE.md:9` says "**13 Routers** · 17 Rules" — two wrong counts in one string
- Tables stated as 19 at `README.md:83` and `docs/ARCHITECTURE.md:12`; the schema defines 18
- 25 files in `pages/`, 20 routed — 5 orphans, none of which fetch anything

**F-22 · Stop calling deterministic arithmetic "predictive".**
- `SLAPage.tsx:44` describes `diffDays > 45` as a "predictive engine ... forecasting
  potential breaches"
- R-018 at `delay.ts:78-82` is `expectedProgress = min((months/24)×100, 100)` firing when
  `actual/expected < 0.5` — honest arithmetic, mislabelled

Either rename both, or build the forecast (P-13).

**F-23 · Remove the `SECURITY DEFINER raw_sql(query TEXT)` function** at
`supabase/migrations/001_initial_schema.sql:342-354`, which `EXECUTE format()`s arbitrary
SQL. Currently **dormant** — its only wrapper, `db.ts:232-243 exec()`, has zero callers —
but it is an unexercised injection sink inside a project whose central claim is integrity,
and its unused `params` argument means nothing is parameterised despite the comment at
`db.ts:41` saying otherwise.

**F-24 · Ship the vintage-adjusted completion rate.** Restrict the denominator to works
whose one-year deadline has passed. Derive the deadline from `sanction_date + 12 months`
rather than filtering on the empty `completion_target_date` column, and **display the value
basis only** — the count basis saturates at 100% and must not be shown. Under uniform
accrual this yields roughly 78.7% by value and about ₹919 Cr genuinely overdue; state the
uniform-accrual assumption out loud, since a judge will ask.

**F-25 · Make `AgenciesPage` compute from real data.** It makes zero API calls and renders
hardcoded numbers ("14.2 Mo", "DRDA 88.4% timely"). See P-12 for the proper version.

**F-26 · Disclose the auth gap as a known limitation.** `http.ts:74-78` reads a `Bearer`
token and discards it (`// In production, decode JWT`), falling back to `x-user-id` from
`localStorage` (`frontend/src/lib/api.ts:35`), which is client-forgeable. The backend uses
the service-role key and bypasses all RLS (`db.ts:9`). Do not claim role-based access.

**F-27 · Dead references in `package.json` and docs.** `docs/SERVICE_CONTRACTS.md` — called
"the keystone ... your build spec" at `HANDOFF.md:148-150` — does not exist, and
`backend/scripts/` does not exist as a directory, yet `package.json` wires `npm run seed`
and `npm run reset` to `scripts/seed.ts` and `scripts/reset.ts`. Both fail with
MODULE_NOT_FOUND.

**F-28 · Relabel the 21-column spec.** No official basis was located for it. It is your own
integration schema, which is fine — but `docs/` and `/readiness` present it as an external
MoSPI requirement. Call it "DRISHTI proposed integration schema".

---

# PART 2 — FEATURES NOT YET BUILT

Seventeen pain points across the four authority roles. Build order is given at the end.
The **tier label is a commitment** — ship it in the UI next to the feature.

## Build these five first

**P-01 · Free-text eligibility screening · District Authority · Tier 1 · Gap**
An MP's recommendation arrives as prose: *"construction of community hall cum marriage hall
near the Hanuman temple, Ward 7."* The officer must decide whether that is eligible, and the
guidelines carry a long annexure of eligible/ineligible items — religious structures, assets
for individual benefit, commercial premises, land acquisition, memorials. This is a
**text-understanding problem, not a lookup**, which is exactly why R-011 is dead: it checks
a 15-value dropdown while the eligibility signal lives in the description the dropdown
throws away. The official guidance itself says eligibility is determined "by the principles
and conditions of the scheme rather than by a single keyword-based classification."
- **Build:** retrieval-augmented classifier over the guidelines annexure returning
  *eligible / ineligible / needs human review*, **with the specific clause quoted back**.
  The citation is what makes it usable by an officer and satisfies Doctrine 7.
- **Data you have:** `title`, `description`
- **Data you need:** the guidelines annexure as text — *the single highest-value document
  to obtain*
- **Why first:** ₹6,654.76 Cr of recommendations never reach sanction, roughly twice the
  value stalled after sanction. This is the only feature in the list that acts on that pool.

**P-15 · Natural-language questions over the corpus · MoSPI · Tier 1 · Faked today**
What the copilot pretends to do. *"Which works in Nashik have money released past 60% with
progress under 20%?"*
- **Build:** text-to-SQL against a **read-only view**, with the **generated query displayed**
  to the officer — auditable (Doctrine 7), cannot mutate (Doctrine 1)
- **Why second:** converts your worst integrity liability into your best demo, reusing an
  interface that already exists. Shares a screen with P-01 naturally.

**P-04 · Document AI on UCs, certificates and bills · DA · Tier 1 · Total gap**
Utilisation certificates, completion certificates, measurement books, bills and sanction
letters arrive as scans and phone photographs. Someone opens each one and eyeballs whether
the UC amount matches the sanction, whether dates are consistent, whether the signatory is
authorised, whether the work described is the work sanctioned. **The largest volume of pure
drudgery in the workflow and the most AI-native task in the scheme.** Your data model
currently reduces it to `has_uc BOOLEAN` and a `uc_date` that nothing reads.
- **Build:** OCR → key-value extraction → cross-field consistency against the portal record,
  surfacing only mismatches
- **Why:** nobody else in a hackathon will build this, it is unambiguously AI, it needs no
  privileged access to demo, and every officer who has done the job recognises it instantly

**P-06 · Evidence photo verification · DA · Tier 1 · Gap (existing piece dead)**
Five distinct checks hide inside "verify the photo" — do not conflate them:
- *Geotag present and inside the project area* — **Tier 3**, pure EXIF parsing. Build it,
  do not call it AI.
- *Same photo reused across works* — perceptual hashing. Honest label: **computer vision,
  not machine learning.** Fix F-20 first.
- *Does the image show the asset type claimed* — **Tier 1.** Image classification over asset
  categories. A "community hall" that is a photograph of a shopfront.
- *Completed asset or a foundation* — **Tier 1, harder.** Progress-stage estimation, and
  where the real money leaks, because payment is gated on completion.
- *Manipulated, re-photographed from a screen, or synthetically generated* — **Tier 1, and
  the most contemporary angle available.** In 2026 an agency can generate a convincing
  photograph of a completed road. No guideline anticipates this and geotag rules do not
  catch it.

**Critical design constraint:** e-SAKSHI now permits uploading *corrected* photographs where
an incorrect image was previously uploaded. So **photo replacement is a sanctioned, routine
operation** — a naive reuse-or-change detector will flag legitimate corrections as
anomalies. Treat "image changed" as normal and reason about the *sequence*.

**And this is the ledger's best argument.** If a correction overwrites the original, the
evidence of record for a payment decision is mutable. Pitch: *"the portal permits an uploaded
photograph to be corrected. We hash every image at submission and chain it, so the image
that justified a payment can be produced later even if it has since been replaced. We are
not alleging misuse; we are removing the need to trust that it did not happen."*
**Confirm the retention behaviour before asserting it** — if e-SAKSHI does version images,
present your hashing as independent corroboration instead, which is still a good argument.

**P-03 · Pre-sanction duplicate and overlap detection · DA · Tier 2 · Partial, cheap upgrade**
`duplicate.ts` does 2-of-3 corroboration on text + geo (500 m) + amount (15%). The
architecture is right and the corroboration requirement is good design — keep both. Three
improvements:
- Signal one (`tokenSetRatio`, `util.ts:181-192`) is a **Dice coefficient over token sets**,
  purely lexical. It misses *"CC road"* vs *"cement concrete road"*, *"Anganwadi Kendra"* vs
  *"Anganwadi Centre"*, Hindi/English transliteration, and any paraphrase — which is most
  real duplicates. Swap in **multilingual sentence embeddings**, keeping the 2-of-3 gate and
  geo/amount as corroborators.
- It compares **titles only**; `description` is never used, discarding the richest text you
  have.
- **Run it at recommendation time, not only post-hoc.** Catching a duplicate before sanction
  is worth far more than flagging one after payment. Free change, large value.

## Remaining gaps — District Authority

**P-02 · Cost reasonableness against Schedule of Rates · Tier 1 (matching) + Tier 3
(comparison) · Partial**
The hard part is not the comparison — it is matching *"repair of village approach road,
1.2 km"* to SoR line items written in engineering nomenclature. That is **semantic matching
over a large catalogue**. Once matched, the comparison is arithmetic.
Your MAD z-score against district-and-category peers is a legitimate proxy and needs no
external data — keep it, but be precise: **you detect works expensive *relative to peers*,
not works that breach the SoR.** An engineer in the room will know the difference.

**P-05 · Queue triage under a real workload cap · Tier 2 · Partial, design already good**
The alert budget (10 per district, overflow to a visible `BACKLOG`) and rule probation
(auto-suspend below 40% actionable over 25 reviews) are a genuinely good answer to alert
fatigue — present them as a feature. The honest extension is **not** a composite risk score
(Doctrine 2 forbids it): it is calibrating each rule's **empirical precision from accumulated
officer decisions**, so ranking reflects measured reliability per rule and per district.
Needs `review_actions` volume you do not have — present as designed-and-instrumented, not
running.

**P-07 · Multilingual free text · Tier 1 · Gap**
Recommendations, agency remarks, inspector notes and citizen complaints arrive in regional
languages and Roman transliteration. Every text feature above degrades or fails on this.
**Multilingual normalisation must be stage one of any text pipeline.** Worth stating
explicitly — it is the most common unexamined assumption in Indian govtech prototypes.

## Remaining gaps — Field inspector / Junior Engineer

**P-08 · Risk-informed inspection sampling · Tier 2 · Gap**
Inspection is a mandated percentage, so the binding question is *which* works, and today the
answer is convenience and proximity. Formulate as **maximise expected detection per
travel-kilometre** — risk-informed selection plus geographic clustering so one trip covers
several suspicious works. You have `latitude`/`longitude` and an `inspections` table, so this
is feasible now. **Deliberately include a small random sample** alongside the risk-selected
ones, or the model only ever validates its own priors — say this aloud, it shows statistical
care.

**P-09 · On-site capture · Tier 1 · Gap** (`idb` is a dependency; no offline queue exists)
Two wins: **speech-to-structured-form in the local language**, so observations are dictated
rather than typed; and **on-device photo QC before the inspector leaves** — blurry, no
geotag, doesn't resemble the claimed asset. The second matters more than it sounds, because
the alternative to catching a bad photo on site is a repeat visit that will not happen.

**P-10 · Inspector evidence vs agency claims · Tier 1 · Gap**
You store agency photos and `inspections.photo_keys` separately and never compare them.
Cross-source comparison of the same asset is **the strongest integrity signal available
anywhere in this scheme**, because it is two parties with different incentives photographing
one object.

## Remaining gaps — State Nodal Department

**P-11 · District intervention modelling · Tier 2 · Gap**
The state officer's real question is not "which works are late" but **"is this district slow,
or does it simply have harder works?"** Needs time-to-event modelling of sanction →
completion with district and agency effects, controlling for work type and size. Without
that control you punish districts for their portfolio mix, which destroys officer trust
faster than any false positive. Your heatmap shows raw day counts, which cannot separate
these.

**P-12 · Agency performance profiling · Tier 2 · Gap — the cheapest real win available**
`AgenciesPage.tsx` makes zero API calls and renders hardcoded numbers. You already have
`agency_id`, dates and amounts. **Doctrine-safe:** Doctrine 3 bars *MP*-level aggregation and
says nothing about agencies — fortunate, because the agency is where execution accountability
actually sits. Model expected completion time from work type and size, then rank agencies by
deviation from their own expectation. A real screen replacing a fake one.

## Remaining gaps — MoSPI central monitoring

**P-13 · Pre-emptive SLA escalation · Tier 2 · Mislabelled today**
e-SAKSHI **already generates** the "recommendations pending beyond 45 days" report, so the
retrospective half has no competitive value — building it is building their feature.
**The forecast is the entire product here:** predict *which files will breach* from district
processing history, so escalation lands while the deadline can still be met. The Standing
Committee records significant delays in project sanction persisting **despite** the
end-to-end digital system — a count has not fixed it. Two things make this yours rather than
theirs: **separate rejections from expiries** (F-13 — a timely rejection is compliance, and
nobody publishes the split), and **forecast at district level** so the intervention is
staffing rather than nagging. `SLAPage.tsx:44` already claims to do this. Build it or rename
it.

**P-14 · Entity resolution and data quality · Tier 1 · Gap — the only pain point MoSPI has
documented itself**
Free-text location names, inconsistent agency spellings, duplicate agency records, mis-keyed
amounts, transliteration variants. Everything downstream inherits this, and Doctrine 6
already commits you to treating missing data as a data-quality finding — so building this
layer **completes an existing doctrine** rather than adding a new claim.
**It has an official citation, which makes it uniquely safe to pitch:** the Standing
Committee notes discrepancies in constituency maps and names in the digital portal as a live
problem MPs still face. Every other item requires you to assert a problem exists; for this
one you can cite the Committee. It is also a **prerequisite** for your own district and
constituency joins — their documented problem and your build dependency at once.

**P-16 · Citizen input triage and the field-truth loop · Tier 1 · Gap**
Classify each submission, route it to the right district, deduplicate campaign-driven bursts,
and — most valuably — **match a citizen's geotagged photo of a non-existent asset against a
work already marked complete nearby.** That closes the loop between the ledger and the
ground. Handle with care: this is exactly the surface where Doctrine 4's whitelist and an
appeals mechanism both matter.

**P-17 · IA registration across PFMS and e-SAKSHI · MoSPI + DA · Tier 2 · Gap**
IA registration and approval run through **PFMS** before the information is transmitted into
e-SAKSHI — two systems reconciled by transmission rather than shared identity. Three
consequences no work-level report can show: a sanctioned work can sit unstartable because its
agency is not yet live in PFMS, and that delay is recorded against the *work* and the DA with
no field explaining the real cause; the same agency can exist under variant names on either
side (P-14 with money attached); and an agency deregistered or blacklisted in PFMS may still
hold live works in e-SAKSHI. AI content is entity resolution across two registries plus
anomaly detection on the transmission lag. **Worth raising in Q&A even if you do not build
it** — it shows you read the fund-flow architecture, not just the workflow diagram.

---

## Four capabilities that are table stakes, not innovations

e-SAKSHI already generates reports for matters *"such as"* these. "Such as" is a **floor,
not a ceiling** — its real surface may be wider. Build these, but never pitch them as novel:
the 45-day pending-recommendation report; R-006 and R-018 (incomplete beyond the applicable
period); and R-014 (no payment for extended periods).

**Before any pitch that opens with "we do what they don't," walk the live portal's report
menu and screenshot everything in it.**

---

# PART 3 — NON-CODE BLOCKERS

These gate features above and cannot be written in code.

1. **MPLADS guidelines annexure as text** — hard blocker for P-01, the highest-value feature.
2. **State PWD Schedule of Rates** — needed for P-02's real form; the peer proxy ships
   without it.
3. **Screenshots of the live e-SAKSHI report menu** — settles how much of the incumbent
   overlap is real before you make any "they don't have this" claim.
4. **Clause and page numbers for every Part F answer** — the sources are named but not
   pinpointed; a judge asking "where does it say that?" needs an exact citation.
5. **Confirmation of e-SAKSHI photo retention behaviour** — determines whether P-06's ledger
   argument is "we preserve what they overwrite" or "we independently corroborate."
6. **Current district count** — the ~780 figure is domain knowledge, not sourced.

---

# EXECUTION ORDER

1. **F-01 … F-06** — integrity. One day. Nothing else counts until these are done.
2. **F-07 … F-11** — settled constants. Half a day, highest leverage in the plan.
3. **F-12 … F-16** — data and ingest. One day. Before any demo.
4. **F-17 … F-28** — correctness and housekeeping. One to two days.
5. **P-01**, then **P-15**, **P-04**, **P-06**, **P-03** — the five to actually build.
6. Everything else in Part 2 — present as designed, with the tier label attached, and be
   honest about what is running versus specified.

**The closing frame, and it is true of the architecture you would then have:**
*"Explainable statistics where statistics suffice; AI only where the input is unstructured —
free text, scanned documents, photographs, speech — because that is where rules genuinely
cannot reach."* It explains every design choice including the MAD z-score, and it is a much
better answer than a glowing orb.
