# MPLADS Insight & Integrity Platform — Data Contract

## 1. e-SAKSHI Ingest Specification (22 columns)

Read by `backend/src/routers/ingest.ts`, which is the only import path. Columns 1–4
are required headers; a row missing `work_id` or `work_title` is skipped.

Every column below is one the ingest reads. Where a column is absent the ingest
substitutes a **fallback**, named in the last column — the fallback is what the work
will carry, so an absent column is not a neutral omission.

| # | Column Name | Database Field | Type | Null Allowed | Description / fallback when absent |
|---|---|---|---|---|---|
| 1 | `work_id` | `works.esakshi_work_id` | TEXT | NO | Unique work identifier. Upsert conflict key; a row without it is skipped. |
| 2 | `district_lgd` | `districts.lgd_code` | TEXT | NO | District LGD Code. Unmatched → **first district in the table**. |
| 3 | `constituency_code` | `constituencies.lgd_code` | TEXT | NO | Constituency identifier. Unmatched → **first constituency**. |
| 4 | `work_title` | `works.title` | TEXT | NO | Project title. Required. |
| 5 | `work_description` | `works.description` | TEXT | YES | Detailed scope of work → placeholder string. |
| 6 | `category` | `works.category` | TEXT | NO | Sector (ROADS, WATER, etc.) → `OTHER`. |
| 7 | `sanctioned_amount` | `works.sanctioned_amount` | NUMBER | NO | Sanctioned rupees → `0`. |
| 8 | `released_amount` | `works.released_amount` | NUMBER | YES | Disbursed funds → `0`. |
| 9 | `expenditure` | `works.expenditure` | NUMBER | YES | Documented expenditure → `0`. |
| 10 | `recommended_date` | `works.recommended_date` | DATE | YES | Date the work was recommended. Absent → **`null`**, and the work is excluded from the sanction-decision SLA. See §1.3. |
| 11 | `sanction_date` | `works.sanction_date` | DATE | NO | Sanction date (YYYY-MM-DD). Anchor for the delay clock. |
| 12 | `completion_date` | `works.actual_completion_date` | DATE | YES | Actual completion date. Starts R-003's 90-day UC grace timer. |
| 13 | `status` | `works.status` | TEXT | NO | One of NOT_STARTED, IN_PROGRESS, COMPLETED, ON_HOLD, CANCELLED. **Validated against the enum**; absent or unrecognised → `NOT_STARTED`, and unrecognised values are listed in `unrecognised_statuses` on the response. |
| 14 | `physical_progress_pct` | `works.physical_progress_pct` | NUMBER | YES | 0–100 percentage → `0`. Self-reported by the agency. |
| 15 | `has_uc` | `works.has_uc` | BOOLEAN | YES | Utilisation Certificate filed. Parsed as the literal `"true"`; anything else is false. |
| 16 | `agency_name` | `agencies.name` | TEXT | YES | Implementing Agency name. Unmatched → **first agency**. |
| 17 | `location_name` | `works.location_name` | TEXT | YES | Site or locality → `Main Site`. |
| 18 | `latitude` | `works.latitude` | NUMBER | YES | Asset GPS latitude → **Delhi centroid**, which clusters unlocated works together. |
| 19 | `longitude` | `works.longitude` | NUMBER | YES | Asset GPS longitude → same centroid fallback. |
| 20 | `is_scsp` | `works.is_scsp` | BOOLEAN | YES | SC Sub-Plan (15% mandate). |
| 21 | `is_tsp` | `works.is_tsp` | BOOLEAN | YES | Tribal Sub-Plan (7.5% mandate). |
| 22 | `payment_history` | `payments.*` (N rows) | TEXT | YES | Stage-wise release history — see §1.1. Absent means *unknown*, not *unpaid*. |

`works.mp_name` is deliberately not an ingest column and is never written: Doctrine 3
bars MP-level attribution, and the CSV carries no such value to write.

### 1.1 `payment_history` encoding

MPLADS payment is stage-wise: the implementing agency raises a bill against
measured work, the district authority sanctions a release, money moves, and that
repeats for as many stages as the work has. One cell therefore expands to N rows
in `payments`, not to a field on `works`.

```
STAGE:YYYY-MM-DD:AMOUNT|STAGE:YYYY-MM-DD:AMOUNT|...
```

Entries are pipe-separated (an unquoted cell survives the CSV split) and in
payment order — position in the cell becomes `payments.sequence_number`. Example:

```
MOBILISATION_ADVANCE:2025-01-15:500000|RUNNING_BILL:2025-04-02:750000
```

`STAGE` must be one of four values, enforced both by `isPaymentStage` on the way
in and by a CHECK constraint on `payments.stage`:

| Stage | Meaning |
|---|---|
| `MOBILISATION_ADVANCE` | Paid against a bank guarantee **before** any work is measured. Excluded from R-002's money-ahead-of-progress test, because counting it flags every work that received one — the normal case, not a finding. |
| `RUNNING_BILL` | Interim release against a measured quantity of completed work. |
| `FINAL_BILL` | Closing release on completion. |
| `RETENTION_RELEASE` | Retention money released after the defect-liability period. |

A malformed entry is **reported**, never skipped: the ingest response carries
`payments_rejected` with a reason per entry. A payment that vanished silently on
the way in would leave a work looking unfunded, and R-014 would then report that
as a finding — a fabricated one.

An **empty or absent** `payment_history` means no payment history is on record.
The rules treat that as *unknown*, not as *unpaid* — R-012 and R-014 stay silent
rather than firing on a null field (Doctrine 6).

`works.last_payment_date` is derived from these rows and maintained in exactly one
place, `backend/src/services/payments.ts`. It is not an ingest column; supplying
one would let it disagree with the payments it is supposed to summarise.

### 1.2 Retired columns

| Column | Status |
|---|---|
| `first_installment` | **RETIRED.** No longer written. |
| `second_installment` | **RETIRED.** No longer written. |

Two amount columns cannot hold an N-stage history, carry no date (so they cannot
express "no payment for an extended period" — the question R-007 asks), and cannot
be reconciled against PFMS, which settles per payment rather than per work.

A file that still carries them ingests successfully: the values are **counted and
reported** as `legacy_installment_rows_ignored` in the response and in the audit
event, so nothing is silently dropped. They are deliberately *not* converted into
payment rows — neither column carries a date, so a converted row would need one
invented, which would corrupt exactly the stall arithmetic this change exists to
fix.

The `works.first_installment` / `works.second_installment` database columns still
exist and are annotated `RETIRED` via `COMMENT ON COLUMN` (see
`supabase/migrations/008_payment_stages.sql`). They were not dropped: dropping is
irreversible, and the annotation is what stops the next reader wiring a new rule
to them.

### 1.3 The sanction-decision SLA and `recommended_date`

The 45-day clause measures the interval between a work being **recommended** and a
**decision** being taken on it. It needs both ends, and the ingest is the only place
the first end can come from.

`recommended_date` used to fall back to `sanction_date`, and then to today. Both
fallbacks produced a work that *looked* measured: a sanctioned work carried a
recommendation-to-sanction lag of exactly zero, so no ingested row could ever breach
the limit, and R-020/R-021 were silent for a reason that had nothing to do with the
works being timely. An empty breach count read as "nothing is late" when it meant
"nothing was measured."

An absent column now leaves the field null, and the work is reported under
`works_without_recommendation_date` on both the ingest response and the audit event.
Doctrine 6 keeps the rules quiet on it, and `GET /sla/stats` counts it under
`notTrackable` rather than under `safe`.

`GET /sla/stats` partitions the works with no sanction date into five outcomes.
Three are pending — `breached`, `atRisk`, `safe`. Two are not, and must not be read
as compliant or as findings:

| Outcome | Meaning |
|---|---|
| `rejected` | The work was cancelled, so a decision *was* taken. A rejection satisfies the clause as much as a sanction does. There is no `rejection_date` column, so whether it landed inside the limit is unknown — not assumed. |
| `notTrackable` | No usable recommendation date, or one in the future, so the clock has no start. |

`avgDays` is `null`, never `0`, when nothing measurable is pending, and
`measuredCount` names the population it was averaged over. Both thresholds are read
from R-020/R-021 in the rule catalogue by `services/sla_engine.ts`, which is the
single implementation. The statistics endpoint used to carry its own copies of 45
and 35 and to select on `status = 'PROPOSED'`, a value absent from `WORK_STATUSES`,
so it reported zeros on canonical data while the queue filled with breach alerts.

---

## 2. National Calibration Benchmarks

- **Published Delivery Rate**: **50.71% by value** (₹3,387.38 Cr completed of ₹6,680.29 Cr
  sanctioned) and **61.88% by count** (69,061 of 1,11,600 works), per the Standing Committee
  on Rural Development for 1 Apr 2023 – 22 Jan 2026. Two distinct benchmarks — the works that
  complete are cheaper than the works that stall, so the bases are not interchangeable and
  neither may be quoted against the other's denominator. Derived, not hardcoded, in
  `backend/src/services/calibration.ts`.
- **Statutory SC Reservation Mandate**: Minimum 15.0% of the annual entitlement, in
  recommended works value. The denominator is the MP's entitlement — ₹5 Cr per
  constituency per financial year — not the portfolio's own sanctioned total. Computed
  in `backend/src/services/compliance.ts`.
- **Statutory ST Reservation Mandate**: Minimum 7.5%, on the same base.
- **Physical Inspection Target**: Minimum 10.0% of works **under implementation**,
  annually. Not completed assets: an inspection can only change an outcome while the
  work is still being built, which is also why the target is a sampling rate rather
  than a sign-off rate.

## 3. The synthetic corpus

`data-gen` builds one in-memory corpus and writes three views of it, so they cannot
disagree:

| Output | Contents |
| --- | --- |
| `supabase/seed.sql` | `works`, `payments`, `health_reports`, `answer_key` |
| `drishti_works_dataset.csv` | the same works in the 22-column e-SAKSHI ingest format above |
| console summary | what was planted, so a shortfall cannot pass as a sample size |

Load it **after** the migrations — it is current-state data, not history:

```bash
npm run generate -w data-gen
psql "$DATABASE_URL" -f supabase/seed.sql
```

The generator previously wrote `supabase/migrations/004_seed_data.sql`, which made a
version-controlled migration a build artifact: the applied schema history was rewritten
whenever the corpus changed. That file is now a tracked no-op, kept so a database that
already applied 004 keeps a contiguous history.

The corpus is **2,000 works** across 2023–2026, seeded (`SEED = 12345`, Mulberry32), so a
given seed always produces the same corpus. Alongside them it writes ~6,300 stage payments
across 1,662 works, ~31,950 health reports across the 411 in-progress works (26 of which have
never been reported on), and 797 answer-key rows. The health reports are most of the file's
12 MB: a 10-day cadence over a construction period two or three years long is a lot of rows
per work, and that is what the cadence means rather than a generation artifact.

Status is drawn from a mix weighted to the
61.88% by-count benchmark, and completed works get a lower amount ceiling derived
algebraically from the 50.71% by-value figure. **This means `/calibration` agreement is
arithmetic, not evidence** — the corpus is calibrated to those figures by construction, and
the residual gap was deliberately left rather than tuned away.

### 3.1 `answer_key` — what it is ground truth for

One row per `(work, condition)` pair, carrying the `expected_rule_id` of the rule that
should catch it. **Ground truth is derived from the finished corpus, not recorded when an
anomaly is planted.** Several conditions arise organically — roughly 12% of sanctioned works
are never paid, roughly 30% of completed works file no UC — so labelling only the deliberate
plants would leave organically-anomalous works unlabelled, and every correct alert on one
would be scored as a false positive.

Eleven types are covered, each a restatement of the rule's own test written out independently
of the engine, so a drift between the YAML thresholds and the code surfaces as a recall miss
instead of cancelling out:

| Type | Rule | Condition |
| --- | --- | --- |
| `MISSING_UC` | R-003 | Completed >90 days ago, no UC filed |
| `COST_OVERRUN` | R-004 | Expenditure over sanction by >10% |
| `ZERO_EXPENDITURE_IN_PROGRESS` | R-005 | ≥10% built, nothing spent |
| `COMPLETED_LOW_PROGRESS` | R-008 | COMPLETED with progress <80% |
| `INELIGIBLE_CATEGORY` | R-011 | Categorised `RELIGIOUS_HERITAGE` |
| `STAGE_PAYMENT_STALLED` | R-012 | ≥₹25L, ≥50% built, no measured bill |
| `RELEASE_OVERRUN` | R-013 | Released over sanction by >5% |
| `NO_PAYMENT_SINCE_SANCTION` | R-014 | Sanctioned >90 days ago, no payment |
| `ON_HOLD_TOO_LONG` | R-015 | Held ≥120 days, measured from `updated_at` |
| `MISSING_HEALTH_REPORT` | R-019 | IN_PROGRESS, no report in 10+5 days, from `health_reports` |
| `SANCTION_SLA_BREACHED` | R-020 | No decision, past the 45-day limit |

Ten rules are outside the key, and the reasons are not all the same:

- **Emergent** — R-001 and R-009. A cost outlier is defined against its category's
  distribution and a duplicate against other works, so neither is a property of a single row.
  Restating them would mean reimplementing the detector, which tests nothing.
- **No ground-truth intent** — R-002, R-006, R-007, R-018. These read progress-versus-payment
  curves the generator draws without deciding in advance whether a work is anomalous.
- **Missing artifacts** — R-010 needs images, which are not generated.
- **Not alerts** — R-016 and R-017 are compliance statistics (doctrine #3).
- **Simply unwritten** — R-021. Its condition is the same recommended-but-unsanctioned window
  R-020 uses, read at 35 days instead of 45; the corpus expresses it and nobody has written
  the label. This is the one entry here that is a gap in the key rather than a limit of the
  corpus, and it is named as such because `unscored_alerts` looks identical either way.

`MISSING_HEALTH_REPORT` was in the "missing artifacts" group until the generator began
emitting a reporting history; R-019's recall is now measured rather than assumed. The
generator asserts at generation time that every catalogued rule is either covered or listed
as uncovered, and warns otherwise — R-021 was in neither list, so the key covered ten rules,
the uncovered list named nine, and the twenty-first was unaccounted for.

`services/evaluation.ts` treats the distinct `expected_rule_id` values as the covered set and
reports alerts from any other rule as `unscored_alerts`, neither credited nor penalised.
Scoring them as false positives would make precision *fall as the uncovered rules did more
work*, which measures the key's coverage and reports it as the engine's accuracy.

Four conditions are organically impossible and **must** be planted or their recall is
permanently unmeasurable: a coherent generator never produces a cost overrun, a completed
work under 80% progress, progress with zero expenditure, or an ineligible category — the
generator's category list holds no ineligible value, so a work can only carry one by being
put there.

**What recall measures.** The key restates each rule's physical condition, so a miss means
the condition did not survive the trip through the catalogue, the status filters, probation
and the alert store — a rule disabled, gated on the wrong status, or reading a column nothing
writes. That is pipeline fidelity. It is not a claim that a rule would catch genuine
procurement fraud; no synthetic corpus can measure that.
