/**
 * seed_mock_data.mjs — mock data for the features that are built but starved.
 *
 * Run it dry first. It prints the plan and writes nothing:
 *
 *   node --experimental-strip-types --env-file=.env seed_mock_data.mjs
 *   node --experimental-strip-types --env-file=.env seed_mock_data.mjs --apply
 *   node --experimental-strip-types --env-file=.env seed_mock_data.mjs --apply --only=payments,health
 *
 * ─── Why this exists, and why it is urgent ──────────────────────────────────
 *
 * Two rules are armed today and have simply not been re-run. Both read a table
 * that is empty, and both treat empty as a finding rather than as unknown:
 *
 *   R-014  `services/alerts.ts` passes `paymentsByWork.get(w.id) ?? []`, so
 *          `history` in `rule_engine.ts` is never null and `history.count === 0`
 *          is true for every work. `payments` has zero rows. Measured against the
 *          live corpus: 607 works (NOT_STARTED + IN_PROGRESS, sanctioned more
 *          than 90 days ago) would raise a NO_PAYMENT_SINCE_SANCTION alert.
 *   R-019  `lastReportDateByWork()` returns an empty Map, and an empty Map is
 *          truthy, so the `if (lastReportDate && ...)` guard in `detectors/delay.ts`
 *          passes. All 484 IN_PROGRESS works would raise MISSING_HEALTH_REPORT.
 *
 * `runAnalyze` upserts and never deletes, so pressing "Run Analysis" once on the
 * unseeded corpus adds ~1,090 alerts that no later run removes. Seeding the two
 * source tables is therefore a prerequisite for re-running the analysis, not a
 * cosmetic nicety.
 *
 * ─── Honesty ────────────────────────────────────────────────────────────────
 *
 * Everything written here is synthetic and internally consistent with the works
 * rows it hangs off — payment totals reconcile to `works.released_amount`,
 * health-report progress tracks `works.physical_progress_pct`, inspection
 * coordinates sit within ~40m of the work. It is plausible data, not real data,
 * and nothing in the database distinguishes it from an actual feed. That is the
 * cost of demoing a data path with no upstream, and it is stated here rather
 * than discovered later.
 *
 * `works.evidence_image_key` is the sharpest case: the values are valid 64-bit
 * hex perceptual hashes with three deliberately planted near-duplicate pairs, so
 * R-010 fires — but no image exists behind any of them. The hash is the whole of
 * the evidence.
 *
 * NOT SEEDED: `answer_key` / `evaluation_runs`. See the note at the bottom.
 *
 * Determinism: `makeRng(SEED)` from the project's own util, per the Math.random
 * ban. Every id is derived from its content, so re-running overwrites rather
 * than duplicates.
 */

import { createClient } from '@supabase/supabase-js';
import { makeRng, sha256, addDays, daysBetween, clamp } from './src/util.ts';

// ─── CLI ─────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const PROJECT = argv.includes('--project');
const SEED = Number(argv.find((a) => a.startsWith('--seed='))?.slice(7) ?? 12345);
const ONLY = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',').map((s) => s.trim());

const ALL_MODULES = ['payments', 'health', 'photos', 'inspections', 'review'];
const MODULES = ONLY ?? ALL_MODULES;
for (const m of MODULES) {
  if (!ALL_MODULES.includes(m)) {
    console.error(`unknown module "${m}". known: ${ALL_MODULES.join(', ')}`);
    process.exit(1);
  }
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * The date every generated date is measured back from.
 *
 * Overridable because the wall clock is a second seed, and an undeclared one.
 * `new Date().toISOString()` is UTC, so in IST the value flips at 05:30 local —
 * two runs on what a reader would call the same day can disagree. Every
 * `report_date` and `payment_date` then shifts, which moves where the
 * `date < sanction_date` break falls, which changes how many draws each work
 * takes from the shared generator and desynchronises every work after it. So a
 * one-day drift does not shift the seed's output by a day; it produces an
 * entirely different corpus, down to which inspector filed which report.
 *
 * That is what layered two full generations of `health_reports` on top of each
 * other. `pruneTo` now removes the surplus either way, but the run is worth
 * being able to reproduce exactly, and `--today=` is what makes that possible.
 * It defaults to the current UTC date because the rules evaluate against the
 * real one — pinning it to a constant would make the seed go stale instead.
 */
const TODAY = argv.find((a) => a.startsWith('--today='))?.slice(8)
  ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) {
  console.error(`--today must be YYYY-MM-DD, got "${TODAY}"`);
  process.exit(1);
}
const CHUNK = 500;

// ─── Helpers ─────────────────────────────────────────────────

/** Content-derived id in `newId()`'s shape (32 hex), so re-runs overwrite. */
const detId = (...parts) => sha256(parts.join('|')).slice(0, 32);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pickOne = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Pull a whole table past PostgREST's 1000-row default page size. */
async function fetchAll(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const stats = [];
/** What each module planned, so `--project` can replay the real rules over it. */
const PLAN = { payments: [], health: [], hashes: new Map() };

/**
 * Retry a Supabase call through transient transport failures.
 *
 * Every write this script makes is idempotent — ids are derived from content
 * and updates set the same value — so a retry can only repeat work, never
 * double it. Worth having because the photo pass is 420 sequential round trips
 * to a hosted database and one `TypeError: fetch failed` two thirds of the way
 * through otherwise abandons the run with the table half written.
 *
 * Only transport errors are retried. A constraint violation is a fact about the
 * data and will fail identically every time, so it is raised immediately.
 */
async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const { error } = await fn();
      if (!error) return;
      if (error.code || i >= attempts) throw new Error(`${label}: ${error.code ?? ''} ${error.message}`);
      await sleep(400 * i);
    } catch (e) {
      if (i >= attempts) throw e instanceof Error ? e : new Error(`${label}: ${e}`);
      await sleep(400 * i);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function writeRows(table, rows, onConflict) {
  stats.push({ table, rows: rows.length, mode: onConflict ? `upsert on (${onConflict})` : 'insert' });

  // Two rows sharing a conflict key make Postgres raise 21000, "ON CONFLICT DO
  // UPDATE command cannot affect row a second time" — which names neither the
  // table's key nor the rows that collided. Since every id here is derived from
  // content, a collision also means two planned rows silently became one, so
  // the count printed above would be larger than the count written. Check it in
  // the dry run, where it costs nothing and can be fixed before any write.
  if (onConflict) {
    const cols = onConflict.split(',').map((c) => c.trim());
    const seen = new Map();
    for (const r of rows) {
      const key = cols.map((c) => String(r[c])).join('|');
      if (seen.has(key)) {
        throw new Error(
          `${table}: two rows share (${onConflict}) = ${key}\n` +
            `    ${JSON.stringify(seen.get(key))}\n    ${JSON.stringify(r)}`,
        );
      }
      seen.set(key, r);
    }
  }

  if (!APPLY || rows.length === 0) return;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await withRetry(`${table} write [${i}..${i + slice.length})`, () =>
      onConflict
        ? db.from(table).upsert(slice, { onConflict, ignoreDuplicates: false })
        : db.from(table).insert(slice));
    process.stdout.write(`\r  ${table}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}   `);
  }
  process.stdout.write('\n');
}

/**
 * Delete rows the current plan does not contain, for a table this script owns
 * outright.
 *
 * Upsert alone does not make a re-run idempotent, and the difference cost real
 * accuracy here. `health_reports` conflicts on `(work_id, report_date)`, and the
 * report dates are themselves generated — so when a fix changed the dates, every
 * row landed on a *new* conflict key rather than replacing the old one. The
 * table became the union of both runs: 4,357 rows where the plan had 2,375, and
 * 484 works with a report where 9 were meant to have none at all. Those 9 are
 * the entire evidence for R-019's never-reported branch, so the rule quietly
 * stopped being demonstrable, and the blast radius the run printed no longer
 * described the database it had just written.
 *
 * `payments` carries the same flaw for the same reason — it conflicts on
 * `(work_id, sequence_number)`, so a plan that gives a work fewer payments than
 * last time leaves the tail behind. It happens to reconcile today only because
 * the plan has not changed since it was written.
 *
 * Only for tables whose entire contents this script declares. `review_actions`
 * is excluded: it holds one row from before this script existed, and a seeder
 * that eats real data to tidy up is worse than a seeder that leaves a surplus.
 */
async function pruneTo(table, rows) {
  // A plan of nothing is far more likely to be a bug upstream than an
  // instruction to empty the table, so it is never acted on.
  if (rows.length === 0) return;

  const planned = new Set(rows.map((r) => r.id));
  const existing = await fetchAll(table, 'id');
  const surplus = existing.map((r) => r.id).filter((id) => !planned.has(id));
  if (surplus.length === 0) return;

  console.log(`  ${table}: ${surplus.length} row(s) from an earlier run are not in this plan` +
    `${APPLY ? ' — deleting' : ' (dry run)'}`);
  stats.push({ table, rows: -surplus.length, mode: 'prune' });
  if (!APPLY) return;

  for (let i = 0; i < surplus.length; i += CHUNK) {
    const slice = surplus.slice(i, i + CHUNK);
    await withRetry(`${table} prune [${i}..${i + slice.length})`, () =>
      db.from(table).delete().in('id', slice));
    process.stdout.write(`\r  ${table} prune: ${Math.min(i + CHUNK, surplus.length)}/${surplus.length}   `);
  }
  process.stdout.write('\n');
}

// ═══════════════════════════════════════════════════════════════
// 1. payments — defuses the R-014 flood, and makes R-002/R-007/R-012 real
// ═══════════════════════════════════════════════════════════════
//
// Totals reconcile to `works.released_amount`. That matters beyond tidiness:
// R-013 compares released against sanctioned off the works row while R-002 reads
// the payment history, so a history that does not sum to the ledger figure makes
// the two rules contradict each other on the same work.
//
// Three exemplar carve-outs, chosen deliberately rather than left to the tail of
// a distribution, because each is the only thing that makes a rule demonstrable:
//
//   NO_PAYMENT    (15 works)  zero rows, so R-014 has something to find
//   ADVANCE_ONLY  (12 works)  advance, no measured bill -> R-012 fires
//   everything else gets a full stage history and stays quiet
//
// The exemplars are not the whole residual, and the module prints the real
// figure rather than the planted one. A work whose ledger released no money
// gets no payment rows either, and R-014 fires on it correctly — never paid is
// what the record says. Seeding removes the ~532 findings that were artefacts
// of an empty table; it does not remove the ones that were always true.

const STAGE_ADVANCE = 'MOBILISATION_ADVANCE';
const STAGE_RUNNING = 'RUNNING_BILL';
const STAGE_FINAL = 'FINAL_BILL';
const STAGE_RETENTION = 'RETENTION_RELEASE';

function planPaymentsFor(work, rng, exemplar) {
  if (exemplar === 'NO_PAYMENT') return [];
  if (!work.sanction_date) return [];

  const sanctioned = num(work.sanctioned_amount);
  const released = num(work.released_amount);
  if (released <= 0 || sanctioned <= 0) return [];

  const progress = clamp(num(work.physical_progress_pct), 0, 100);
  const endCap =
    work.actual_completion_date && work.actual_completion_date < TODAY
      ? work.actual_completion_date
      : TODAY;
  const span = Math.max(daysBetween(work.sanction_date, endCap), 30);

  // The advance is paid against a bank guarantee before anything is measured,
  // which is why every rule that reads money movement deducts it first.
  const advance = r2(Math.min(released, sanctioned * 0.10));
  const rows = [];
  let seq = 1;
  const at = (frac) => addDays(work.sanction_date, clamp(Math.round(span * frac), 7, span));

  if (advance > 0) {
    rows.push({ seq: seq++, stage: STAGE_ADVANCE, amount: advance, date: at(0.05),
      purpose: 'Mobilisation advance against bank guarantee' });
  }
  if (exemplar === 'ADVANCE_ONLY') return finalise(work, rows, rng);

  let remaining = r2(released - advance);
  if (remaining <= 1) return finalise(work, rows, rng);

  const completed = work.status === 'COMPLETED';
  const billCount = completed ? 3 : clamp(Math.floor(progress / 25) + 1, 1, 3);
  // Retention is only released once the work is signed off with a UC.
  const retention = completed && work.has_uc ? r2(remaining * 0.05) : 0;
  let payable = r2(remaining - retention);

  // Last payment sits further along the timeline the further along the work is.
  const lastFrac = clamp(0.30 + 0.60 * (progress / 100), 0.30, 0.92);
  const firstFrac = 0.22;

  for (let i = 0; i < billCount; i++) {
    const isLastBill = i === billCount - 1;
    // Jitter the split so the history does not read as n equal instalments, then
    // let the final bill absorb the rounding so the total lands exactly on the
    // ledger figure.
    const share = isLastBill ? payable : r2((payable / (billCount - i)) * (0.80 + rng() * 0.40));
    const amount = r2(Math.min(share, payable));
    if (amount <= 0) break;
    payable = r2(payable - amount);
    const frac = billCount === 1 ? lastFrac : firstFrac + ((lastFrac - firstFrac) * i) / (billCount - 1);
    rows.push({
      seq: seq++,
      stage: isLastBill && completed ? STAGE_FINAL : STAGE_RUNNING,
      amount,
      date: at(frac),
      purpose: isLastBill && completed
        ? 'Final bill on completion measurement'
        : `Running bill ${i + 1} against measurement book entry`,
    });
  }

  if (retention > 0) {
    rows.push({ seq: seq++, stage: STAGE_RETENTION, amount: retention, date: at(0.97),
      purpose: 'Retention released after defect liability period' });
  }

  return finalise(work, rows, rng);
}

/** Force dates strictly increasing and inside [sanction_date, today], then shape rows. */
function finalise(work, planned, rng) {
  let prev = work.sanction_date;
  return planned
    .filter((p) => p.amount > 0)
    .map((p) => {
      let date = p.date < prev ? addDays(prev, 1) : p.date;
      if (date > TODAY) date = TODAY;
      prev = date;
      return {
        id: detId('payment', work.id, p.seq),
        work_id: work.id,
        amount: p.amount,
        payment_date: date,
        stage: p.stage,
        sequence_number: p.seq,
        // PFMS references are only present once a payment has been reconciled;
        // leaving a quarter of them null is what an unreconciled tail looks like.
        pfms_reference: rng() < 0.75
          ? `PFMS/${date.slice(0, 4)}/${detId('pfms', work.id, p.seq).slice(0, 10).toUpperCase()}`
          : null,
        purpose: p.purpose,
      };
    });
}

async function seedPayments(works) {
  const rng = makeRng(SEED);

  // Exemplars are picked from works that satisfy each rule's *other* conditions,
  // so the carve-out is the only reason the rule fires.
  const r014Pool = works.filter(
    (w) => ['NOT_STARTED', 'IN_PROGRESS'].includes(w.status) &&
      w.sanction_date && daysBetween(w.sanction_date, TODAY) > 120,
  );
  const r012Pool = works.filter(
    (w) => w.status === 'IN_PROGRESS' && num(w.sanctioned_amount) >= 2_500_000 &&
      num(w.physical_progress_pct) >= 50 && num(w.released_amount) > 0,
  );

  const exemplar = new Map();
  for (const w of pickSpread(r014Pool, 15, makeRng(SEED + 1))) exemplar.set(w.id, 'NO_PAYMENT');
  for (const w of pickSpread(r012Pool, 12, makeRng(SEED + 2))) {
    if (!exemplar.has(w.id)) exemplar.set(w.id, 'ADVANCE_ONLY');
  }

  const rows = [];
  for (const w of works) rows.push(...planPaymentsFor(w, rng, exemplar.get(w.id)));

  PLAN.payments = rows;
  const worksPaid = new Set(rows.map((r) => r.work_id)).size;

  // What actually survives, computed from the plan rather than asserted.
  //
  // The exemplars are not the whole residual. `planPaymentsFor` also writes
  // nothing for a work whose ledger says no money was released, and R-014 fires
  // on those too — correctly. A work sanctioned two years ago with
  // released_amount = 0 has genuinely never been paid; that is a true finding,
  // not an artefact of the empty table. Reporting only the 15 exemplars would
  // claim a number the rows do not support.
  const measuredByWork = new Map();
  const paidWorks = new Set();
  for (const r of rows) {
    paidWorks.add(r.work_id);
    if (r.stage !== STAGE_ADVANCE) measuredByWork.set(r.work_id, (measuredByWork.get(r.work_id) ?? 0) + 1);
  }
  const r014After = works.filter(
    (w) => ['NOT_STARTED', 'IN_PROGRESS'].includes(w.status) && w.sanction_date &&
      daysBetween(w.sanction_date, TODAY) > 90 && !paidWorks.has(w.id),
  );
  const r014Exemplars = r014After.filter((w) => exemplar.get(w.id) === 'NO_PAYMENT').length;
  const r012After = works.filter(
    (w) => w.status === 'IN_PROGRESS' && num(w.sanctioned_amount) >= 2_500_000 &&
      num(w.physical_progress_pct) >= 50 && !measuredByWork.has(w.id),
  );
  const r012Exemplars = r012After.filter((w) => exemplar.get(w.id) === 'ADVANCE_ONLY').length;

  console.log(`  ${rows.length} payments across ${worksPaid} works`);
  console.log(`  exemplars: 15 with no payment (R-014), 12 advance-only (R-012)`);
  console.log(`  R-014 blast radius: 607 -> ${r014After.length}` +
    ` (${r014Exemplars} planted, ${r014After.length - r014Exemplars} with released_amount = 0)`);
  console.log(`  R-012 blast radius: 127 -> ${r012After.length}` +
    ` (${r012Exemplars} planted, ${r012After.length - r012Exemplars} with no money released)`);

  await writeRows('payments', rows, 'work_id,sequence_number');
  await pruneTo('payments', rows);

  // works.last_payment_date is denormalised and R-007 reads it. The RPC from
  // migration 019 refreshes it in one statement rather than 2,200 updates.
  if (APPLY) {
    const ids = [...new Set(rows.map((r) => r.work_id))];
    for (let i = 0; i < ids.length; i += 400) {
      await withRetry('refresh last_payment_date', () =>
        db.rpc('drishti_refresh_last_payment_dates', { work_ids: ids.slice(i, i + 400) }));
    }
    console.log(`  refreshed works.last_payment_date for ${ids.length} works`);
  }
}

/**
 * Evenly spaced deterministic sample — avoids clustering every exemplar in one
 * district, and guarantees DISTINCT items.
 *
 * The distinctness is not incidental. Every id downstream is content-derived, so
 * a repeated pick collapses two rows into one on upsert: the exemplar count, the
 * R-017 coverage percentage and the probation row's review count would each
 * claim a number the written rows do not support.
 */
function pickSpread(pool, n, rng) {
  if (n <= 0) return [];
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length <= n) return sorted;

  const step = sorted.length / n;
  const taken = new Set();
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * step + rng() * step * 0.5);
    for (let probe = 0; probe < sorted.length; probe++) {
      const idx = (start + probe) % sorted.length;
      if (taken.has(idx)) continue;
      taken.add(idx);
      out.push(sorted[idx]);
      break;
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// 2. health_reports — defuses the R-019 flood, and makes R-019 real
// ═══════════════════════════════════════════════════════════════
//
// The mandate is a check-in every 10 days with a 5-day grace period, so a work
// whose newest report is more than 15 days old is in breach. Seeding a chain of
// reports at roughly that cadence is what a compliant corpus looks like; the
// interesting rows are the ones deliberately left out of compliance.
//
//   CURRENT (~450)  newest report 1-12 days old  -> silent
//   STALE   (~24)   newest report 40-140 days old -> R-019, "last filed on X"
//   NEVER   (~10)   no report at all              -> R-019, the other evidence
//                                                    branch, measured from sanction
//
// Both evidence branches are exercised on purpose: `detectors/delay.ts` writes a
// different sentence for a work reported on late than for a work never reported
// on, and a demo that only ever shows one of them cannot show that distinction.

const INSPECTORS = [
  ['ENG-1041', 'R. Meena'], ['ENG-1122', 'S. Krishnan'], ['ENG-1208', 'A. Bhattacharya'],
  ['ENG-1317', 'P. Deshmukh'], ['ENG-1455', 'N. Iyer'], ['ENG-1502', 'T. Gogoi'],
];
const REMARKS = [
  'Routine check-in. Work proceeding as per schedule.',
  'Material delivery delayed by two days; no impact on the milestone.',
  'Site visited, measurement book updated.',
  'Labour strength below plan this fortnight.',
  'Progress steady. Contractor reports no obstruction.',
  'Monsoon slowed earthwork; catch-up planned next cycle.',
];

async function seedHealthReports(works) {
  const rng = makeRng(SEED + 10);
  const inProgress = works.filter((w) => w.status === 'IN_PROGRESS' && w.sanction_date);
  const rows = [];
  const buckets = { CURRENT: 0, STALE: 0, NEVER: 0 };

  for (const w of inProgress) {
    const roll = rng();
    const bucket = roll < 0.930 ? 'CURRENT' : roll < 0.979 ? 'STALE' : 'NEVER';
    buckets[bucket]++;
    if (bucket === 'NEVER') continue;

    const lastAge = bucket === 'CURRENT' ? randInt(rng, 1, 12) : randInt(rng, 40, 140);
    const [inspId, inspName] = pickOne(rng, INSPECTORS);
    const progress = clamp(num(w.physical_progress_pct), 0, 100);

    // Five check-ins going backwards at roughly the mandated cadence, each
    // reporting slightly less progress than the one after it. Kept per report
    // rather than only on the work, so a revision downward stays visible.
    //
    // Both the age and the progress are running totals. Multiplying a fresh
    // draw by the loop index instead — `back * randInt(9, 12)` — makes the
    // steps 9-12, 18-24, 27-36, 36-48, which overlap at 36: a work could file
    // two reports on the same day, and since the id is derived from
    // (work, date) the two rows collapsed into one on upsert.
    let age = lastAge;
    let reported = progress;
    for (let back = 0; back < 5; back++) {
      if (back > 0) {
        age += randInt(rng, 9, 12);
        reported = Math.max(0, reported - randInt(rng, 2, 6));
      }
      const date = addDays(TODAY, -age);
      if (date < w.sanction_date) break;
      rows.push({
        id: detId('hreport', w.id, date),
        work_id: w.id,
        reported_by: `${inspName} (${inspId})`,
        report_date: date,
        progress_pct: r2(reported),
        // Null throughout: there are no images in this corpus, and a fabricated
        // key here would buy nothing — no rule reads this column.
        evidence_image_key: null,
        remarks: pickOne(rng, REMARKS),
      });
    }
  }

  PLAN.health = rows;
  console.log(`  ${rows.length} reports across ${buckets.CURRENT + buckets.STALE} works`);
  console.log(`  R-019 blast radius: ${inProgress.length} -> ${buckets.STALE + buckets.NEVER}` +
    ` (${buckets.STALE} stale, ${buckets.NEVER} never reported)`);
  await writeRows('health_reports', rows, 'work_id,report_date');
  await pruneTo('health_reports', rows);
}

// ═══════════════════════════════════════════════════════════════
// 3. works.evidence_image_key — wakes R-010
// ═══════════════════════════════════════════════════════════════
//
// `detectors/photo_reuse.ts` names two constraints in its header and both are
// load-bearing, so they are honoured here rather than rediscovered:
//
//   1. a perceptual hash, NOT a storage key. A path compared by Hamming distance
//      matches on shared prefixes, so every work in a district would "reuse"
//      every other's photo. The detector's `isPerceptualHash` guard rejects
//      non-hex, and these are hex.
//   2. fixed width. `hexHamming` throws on a length mismatch, and inside the
//      pairwise loop that would abort the whole analysis run. All 16 chars.
//
// Coverage is deliberately partial (~40%). Setting a hash on all 2,200 works
// would claim every work has an uploaded evidence photo, and would also make the
// detector do 2.4M pairwise comparisons per run instead of ~190k.

const HASH_HEX = 16; // 64-bit pHash, exactly MIN_HASH_LENGTH

function randomHash(rng) {
  let s = '';
  for (let i = 0; i < HASH_HEX; i++) s += '0123456789abcdef'[Math.floor(rng() * 16)];
  return s;
}

/** Flip `bits` bits of a hex hash — a resized or re-encoded copy of the same image. */
function perturb(hash, bits, rng) {
  const nibbles = hash.split('').map((c) => parseInt(c, 16));
  const flipped = new Set();
  while (flipped.size < bits) {
    const pos = Math.floor(rng() * HASH_HEX * 4);
    if (flipped.has(pos)) continue;
    flipped.add(pos);
    nibbles[Math.floor(pos / 4)] ^= 1 << (pos % 4);
  }
  return nibbles.map((n) => n.toString(16)).join('');
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

async function seedPhotoHashes(works) {
  const rng = makeRng(SEED + 20);
  const pool = works
    .filter((w) => ['IN_PROGRESS', 'COMPLETED'].includes(w.status))
    .sort((a, b) => a.id.localeCompare(b.id));
  const chosen = pickSpread(pool, 420, makeRng(SEED + 21));
  const unique = [...new Map(chosen.map((w) => [w.id, w])).values()];

  const assigned = new Map();
  for (const w of unique) assigned.set(w.id, randomHash(rng));

  // Three planted pairs at distances 3, 5 and 7 — all under the threshold of 8,
  // spread so the reported distance differs between them and the confidence
  // scaling in the detector is visible.
  const pairSource = unique.filter((w) => w.district_id);
  const planted = [];
  for (const [i, dist] of [3, 5, 7].entries()) {
    const a = pairSource[40 + i * 90];
    const b = pairSource[41 + i * 90];
    if (!a || !b) continue;
    const h = assigned.get(a.id);
    assigned.set(b.id, perturb(h, dist, makeRng(SEED + 30 + i)));
    planted.push({ a, b, dist: hamming(h, assigned.get(b.id)) });
  }

  // Guard: confirm nothing else collides. With 64-bit hashes over 420 works the
  // odds of an accidental pair within distance 8 are ~1e-5, but "astronomically
  // unlikely" is not the same as "checked", and an unexplained CRITICAL fraud
  // alert in a live demo is not a thing to leave to probability.
  const entries = [...assigned.entries()];
  const accidental = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (hamming(entries[i][1], entries[j][1]) <= 8) {
        const isPlanted = planted.some(
          (p) => (p.a.id === entries[i][0] && p.b.id === entries[j][0]) ||
                 (p.b.id === entries[i][0] && p.a.id === entries[j][0]));
        if (!isPlanted) accidental.push([entries[i][0], entries[j][0]]);
      }
    }
  }
  if (accidental.length) {
    console.error(`  ABORT: ${accidental.length} accidental collision(s) within distance 8.`);
    console.error(`  Re-run with a different --seed. ${JSON.stringify(accidental.slice(0, 3))}`);
    process.exit(1);
  }

  PLAN.hashes = assigned;
  console.log(`  ${assigned.size} works given a 64-bit hex perceptual hash`);
  console.log(`  ${(assigned.size * (assigned.size - 1)) / 2} pairwise comparisons per analyze run`);
  for (const p of planted) {
    console.log(`  planted pair @ distance ${p.dist}: ${p.a.esakshi_work_id} <-> ${p.b.esakshi_work_id}`);
  }
  console.log(`  accidental collisions under threshold: 0 (verified exhaustively)`);

  stats.push({ table: 'works.evidence_image_key', rows: assigned.size, mode: 'update' });
  if (!APPLY) return;

  let done = 0;
  for (const [id, hash] of assigned) {
    await withRetry(`works ${id}`, () =>
      db.from('works').update({ evidence_image_key: hash }).eq('id', id));
    if (++done % 50 === 0) process.stdout.write(`\r  works: ${done}/${assigned.size}   `);
  }
  process.stdout.write(`\r  works: ${done}/${assigned.size}\n`);
}

// ═══════════════════════════════════════════════════════════════
// 4. inspections + inspection_items — makes R-017 coverage real
// ═══════════════════════════════════════════════════════════════
//
// R-017's population is works UNDER IMPLEMENTATION, not completed ones, and the
// target is 10% over a trailing 365 days (`services/compliance.ts`). The seed is
// shaped so the headline number passes and one district fails, because a
// coverage statistic that is uniformly green says nothing an officer can act on.
//
// A handful of inspections are recorded against COMPLETED works as well. Those
// do not count toward the mandate but they are real effort, and
// `inspections_outside_population` exists precisely so they are not invisible —
// a field that is always zero is a field nobody can tell is working.

const CHECKLIST = [
  'SITE_VISITED', 'WORK_IN_PROGRESS', 'MATERIALS_PRESENT', 'SIGNBOARD_PRESENT',
  'MATCHES_DESCRIPTION', 'QUALITY_ACCEPTABLE', 'COMMUNITY_AWARE', 'UC_AVAILABLE',
  'PHOTOS_TAKEN', 'GPS_RECORDED',
];
const ITEM_NOTES = {
  SIGNBOARD_PRESENT: 'No MPLADS signboard at the site on the date of visit.',
  QUALITY_ACCEPTABLE: 'Surface finish below specification on the eastern stretch.',
  MATERIALS_PRESENT: 'No material stacked; contractor says delivery is due next week.',
  UC_AVAILABLE: 'UC not yet prepared by the implementing agency.',
  COMMUNITY_AWARE: 'Ward members unaware of the sanction.',
};

/** Per-district target counts: one district deliberately below the 10% mandate. */
function coveragePlan(inProgressByDistrict) {
  const districts = [...inProgressByDistrict.entries()].sort((a, b) => b[1].length - a[1].length);
  return districts.map(([id, list], i) => ({
    district_id: id,
    population: list.length,
    // The largest district is the one left short — the realistic failure mode is
    // a big district that cannot keep up, not a small one that forgot.
    target: i === 0 ? Math.floor(list.length * 0.052) : Math.round(list.length * (0.13 + i * 0.015)),
    works: list,
  }));
}

async function seedInspections(works) {
  const rng = makeRng(SEED + 40);
  const byDistrict = new Map();
  for (const w of works) {
    if (w.status !== 'IN_PROGRESS' || !w.district_id) continue;
    const list = byDistrict.get(w.district_id) ?? [];
    list.push(w);
    byDistrict.set(w.district_id, list);
  }

  const inspections = [];
  const items = [];
  const plan = coveragePlan(byDistrict);

  const record = (w, daysAgo, status) => {
    const date = addDays(TODAY, -daysAgo);
    const id = detId('inspection', w.id, date);
    const [inspId, inspName] = pickOne(rng, INSPECTORS);
    inspections.push({
      id,
      work_id: w.id,
      inspector_id: inspId,
      inspector_name: inspName,
      inspection_date: date,
      // Within ~40m of the recorded work location — an inspector standing at the
      // site, not a coordinate invented independently of the work.
      latitude: r2ll(num(w.latitude) + (rng() - 0.5) * 0.0008),
      longitude: r2ll(num(w.longitude) + (rng() - 0.5) * 0.0008),
      overall_status: status,
      notes: status === 'DEFECTS_FOUND'
        ? 'Defects recorded against the checklist items below.'
        : 'Site inspected against the sanctioned scope. No major deviation.',
      photo_keys: [],
      synced: true,
    });
    for (const cid of CHECKLIST) {
      // A satisfactory inspection still misses the odd item; a defective one
      // fails the specific items the notes then explain.
      const failRate = status === 'DEFECTS_FOUND' ? 0.35 : 0.08;
      const checked = cid === 'SITE_VISITED' ? true : rng() > failRate;
      items.push({
        id: detId('inspitem', id, cid),
        inspection_id: id,
        checklist_id: cid,
        checked,
        note: checked ? null : (ITEM_NOTES[cid] ?? 'Not verified during this visit.'),
      });
    }
  };

  for (const d of plan) {
    for (const w of pickSpread(d.works, d.target, makeRng(SEED + 41))) {
      record(w, randInt(rng, 20, 340), rng() < 0.28 ? 'DEFECTS_FOUND' : 'SATISFACTORY');
    }
  }

  // Effort outside the mandate's population.
  const completed = works.filter((w) => w.status === 'COMPLETED' && w.district_id);
  for (const w of pickSpread(completed, 9, makeRng(SEED + 42))) {
    record(w, randInt(rng, 30, 300), rng() < 0.2 ? 'DEFECTS_FOUND' : 'SATISFACTORY');
  }

  const inPop = plan.reduce((s, d) => s + d.target, 0);
  const population = plan.reduce((s, d) => s + d.population, 0);
  console.log(`  ${inspections.length} inspections, ${items.length} checklist items`);
  console.log(`  R-017 coverage: ${inPop}/${population} = ${((inPop / population) * 100).toFixed(1)}% (target 10%)`);
  for (const d of plan) {
    const pct = (d.target / d.population) * 100;
    console.log(`    ${d.district_id.slice(0, 8)}  ${d.target}/${d.population} = ${pct.toFixed(1)}%` +
      `  ${pct >= 10 ? 'meets' : 'BELOW TARGET'}`);
  }
  console.log(`  inspections_outside_population: 9 (against COMPLETED works)`);

  await writeRows('inspections', inspections, 'id');
  await writeRows('inspection_items', items, 'id');
  // Children before parents: `inspection_items.inspection_id` references
  // `inspections`, so dropping a stale inspection first would hit the foreign
  // key from its own surviving items.
  await pruneTo('inspection_items', items);
  await pruneTo('inspections', inspections);
}

const r2ll = (v) => Math.round(v * 1e6) / 1e6;

// ═══════════════════════════════════════════════════════════════
// 5. review_actions + rule_probation — makes the probation board real
// ═══════════════════════════════════════════════════════════════
//
// `services/probation.ts` suspends a rule below a 40% actionable rate over 25
// reviews. Nothing has ever been reviewed, so the board is blank and the claim
// is unverifiable.
//
// Deliberately, NOTHING is seeded into a suspended state. Two reasons:
//
//   1. `runAnalyze` upserts and never deletes, so a suspended rule leaves its
//      existing alerts sitting in the queue while quietly producing no new ones.
//      A demo where the Rules page says SUSPENDED and the triage queue still
//      shows that rule's alerts is worse than no demo.
//   2. Until the fix in `services/alerts.ts` lands, suspension is only honoured
//      by `evaluateWorkRules` — the corpus-wide detectors (R-001, R-006, R-007,
//      R-009, R-010, R-015, R-018, R-019) never consult `getSuspendedRuleIds()`.
//      Seeding one of those as suspended would show a rule that is benched on
//      the Rules page and still firing in the queue.
//
// What is seeded is the state just short of the line: real officer decisions,
// real arithmetic, and the noisiest rule sitting a couple of dismissals above
// the threshold. The mechanism is demonstrable without detonating the corpus.

const ACTIONABLE_RATE_BY_RULE = {
  'R-009': 0.42, // duplicate detection — the noisiest rule, and closest to the line
  'R-007': 0.55,
  'R-006': 0.72,
  'R-002': 0.80,
  'R-001': 0.64,
  'R-018': 0.58,
};
const DISMISS_CODES = ['FALSE_POSITIVE', 'DATA_QUALITY_ISSUE', 'EXPECTED_PATTERN', 'DUPLICATE_ALERT'];
const OFFICERS = ['officer.meena', 'officer.rao', 'officer.krishnan', 'officer.dsouza'];

async function seedReviews() {
  const rng = makeRng(SEED + 50);
  const alerts = await fetchAll('alerts', 'id, work_id, rule_id, status, severity');
  const reviewable = alerts.filter(
    (a) => ['OPEN', 'BACKLOG'].includes(a.status) && ACTIONABLE_RATE_BY_RULE[a.rule_id] !== undefined,
  );

  const byRule = new Map();
  for (const a of reviewable) {
    const list = byRule.get(a.rule_id) ?? [];
    list.push(a);
    byRule.set(a.rule_id, list);
  }
  const openIds = new Set(alerts.filter((a) => a.status === 'OPEN').map((a) => a.id));

  const actions = [];
  const alertUpdates = [];
  const probation = [];

  for (const [ruleId, rate] of Object.entries(ACTIONABLE_RATE_BY_RULE)) {
    // Reviews are drawn from BACKLOG before OPEN. An officer does work through
    // the open queue, but seeding 111 decisions straight off a 95-alert OPEN
    // queue would empty the triage screen — and until someone re-runs the
    // analysis, nothing refills it. BACKLOG alerts are equally real reviews and
    // cost the demo nothing.
    const all = (byRule.get(ruleId) ?? []);
    const pool = [
      ...all.filter((a) => a.status === 'BACKLOG'),
      ...all.filter((a) => a.status === 'OPEN'),
    ];
    // Enough reviews to be past the 25-review minimum where the pool allows it,
    // so the threshold is actually in play rather than merely displayed.
    const n = Math.min(pool.length, ruleId === 'R-009' ? 31 : randInt(rng, 12, 27));
    if (n === 0) continue;
    const sample = pickSpread(pool.slice(0, Math.max(n * 3, n)), n, makeRng(SEED + 51));

    let dismissals = 0;
    sample.forEach((alert, i) => {
      // Deterministic split rather than a coin flip, so the actionable rate the
      // probation row claims is exactly the rate the review log shows.
      const isDismissal = i >= Math.round(n * rate);
      if (isDismissal) dismissals++;
      const action = isDismissal ? 'DISMISSED' : (rng() < 0.3 ? 'ESCALATED' : 'ACKNOWLEDGED');
      const actor = pickOne(rng, OFFICERS);
      const at = new Date(Date.parse(TODAY + 'T00:00:00Z') - randInt(rng, 1, 45) * 86_400_000).toISOString();
      const reason = isDismissal ? pickOne(rng, DISMISS_CODES) : null;

      actions.push({
        id: detId('review', alert.id, actor),
        alert_id: alert.id,
        action,
        actor,
        reason_code: reason,
        note: isDismissal
          ? 'Checked against the source record; the condition does not hold.'
          : 'Referred to the implementing agency for a written explanation.',
        created_at: at,
      });

      // The alert's own status has to move with the log, or the triage queue and
      // the review history contradict each other on the same alert. runAnalyze
      // preserves any status that is not OPEN or BACKLOG, so these survive re-runs.
      alertUpdates.push({
        id: alert.id, status: action, reviewed_by: actor, reviewed_at: at,
        dismiss_reason: reason,
        dismiss_note: isDismissal ? 'Checked against the source record.' : null,
      });
    });

    const actionableRate = (n - dismissals) / n;
    const suspended = n >= 25 && actionableRate < 0.40;
    probation.push({
      rule_id: ruleId,
      total_reviews: n,
      dismissals,
      actionable_rate: r2(actionableRate),
      suspended,
      suspended_at: suspended ? new Date().toISOString() : null,
      reinstated_at: null,
    });
  }

  console.log(`  ${actions.length} review actions across ${probation.length} rules`);
  const fromOpen = alertUpdates.filter((u) => openIds.has(u.id)).length;
  console.log(`  drawn from ${alertUpdates.length - fromOpen} BACKLOG + ${fromOpen} OPEN` +
    ` (OPEN queue ${openIds.size} -> ${openIds.size - fromOpen} until the next analyze run)`);
  for (const p of probation) {
    const pct = (p.actionable_rate * 100).toFixed(0);
    const margin = p.total_reviews >= 25 ? `${pct}% vs 40% threshold` : `${pct}%, under 25 reviews`;
    console.log(`    ${p.rule_id}  ${p.total_reviews} reviews, ${p.dismissals} dismissed` +
      `  -> ${margin}${p.suspended ? '  SUSPENDED' : ''}`);
  }
  if (probation.some((p) => p.suspended)) {
    console.error('  ABORT: a rule landed suspended. See the note above — fix the rates first.');
    process.exit(1);
  }

  await writeRows('review_actions', actions, 'id');
  await writeRows('rule_probation', probation, 'rule_id');

  stats.push({ table: 'alerts (status/reviewed_by)', rows: alertUpdates.length, mode: 'update' });
  if (!APPLY) return;
  let done = 0;
  for (const u of alertUpdates) {
    const { id, ...patch } = u;
    await withRetry(`alerts ${id}`, () => db.from('alerts').update(patch).eq('id', id));
    if (++done % 25 === 0) process.stdout.write(`\r  alerts: ${done}/${alertUpdates.length}   `);
  }
  process.stdout.write(`\r  alerts: ${done}/${alertUpdates.length}\n`);
}

// ═══════════════════════════════════════════════════════════════
// --project : what would the next analyze run actually produce?
// ═══════════════════════════════════════════════════════════════
//
// This is the part that makes the seed a claim rather than a hope. It replays
// the REAL `evaluateWorkRules` and the REAL corpus-wide detectors — imported,
// not reimplemented — against the works rows with the planned payments, health
// reports and photo hashes grafted on, and prints the candidate count per rule.
//
// Nothing is written. It is the same arithmetic `runAnalyze` performs at step 2
// and 3; only the budgeting, the review-preservation and the upsert are skipped,
// none of which change which rules fire.

async function projectAlerts(works) {
  const { evaluateWorkRules } = await import('./src/services/rule_engine.ts');
  const { loadRulesConfig } = await import('./src/services/catalogue.ts');
  const { computeBenchmarks } = await import('./src/services/benchmarks.ts');
  const { groupPaymentsByWork } = await import('./src/services/fund_flow.ts');
  const { detectCostOutliers } = await import('./src/detectors/cost_outlier.ts');
  const { delayParamsFromRules, detectDelays } = await import('./src/detectors/delay.ts');
  const { detectDuplicates } = await import('./src/detectors/duplicate.ts');
  const { analyzePhotoReuse } = await import('./src/detectors/photo_reuse.ts');

  // Graft the plan onto in-memory copies. The database is untouched.
  const seeded = works.map((w) => ({
    ...w,
    evidence_image_key: PLAN.hashes.get(w.id) ?? w.evidence_image_key ?? null,
  }));

  const paymentsByWork = groupPaymentsByWork(PLAN.payments);

  // R-007 reads `works.last_payment_date`, a denormalised column, not the
  // payments table. After --apply the RPC from migration 019 recomputes it as
  // MAX(payment_date) for exactly the works the seeder touched; everything else
  // keeps whatever it had. Mirror that here or the projection silently reports
  // R-007 unchanged, because the in-memory rows still carry the old value.
  const lastPaid = new Map();
  for (const p of PLAN.payments) {
    const cur = lastPaid.get(p.work_id);
    if (!cur || p.payment_date > cur) lastPaid.set(p.work_id, p.payment_date);
  }
  for (const w of seeded) {
    if (lastPaid.has(w.id)) w.last_payment_date = lastPaid.get(w.id);
  }
  const lastReportDate = new Map();
  for (const r of PLAN.health) {
    const cur = lastReportDate.get(r.work_id);
    if (!cur || r.report_date > cur) lastReportDate.set(r.work_id, r.report_date);
  }

  const candidates = [];
  for (const w of seeded) {
    candidates.push(...(await evaluateWorkRules(w, new Set(), paymentsByWork.get(w.id) ?? [])));
  }

  const benchmarks = await computeBenchmarks();
  const delayParams = delayParamsFromRules(loadRulesConfig().rules);
  candidates.push(...detectCostOutliers(seeded, benchmarks));
  candidates.push(...detectDelays(seeded, delayParams, lastReportDate));
  candidates.push(...detectDuplicates(seeded));

  const photo = analyzePhotoReuse(seeded);
  candidates.push(...photo.candidates);

  const byRule = new Map();
  for (const c of candidates) byRule.set(c.rule_id, (byRule.get(c.rule_id) ?? 0) + 1);

  // The same pass with no seed data, so the two columns are directly comparable.
  const bare = [];
  for (const w of works) bare.push(...(await evaluateWorkRules(w, new Set(), [])));
  bare.push(...detectCostOutliers(works, benchmarks));
  bare.push(...detectDelays(works, delayParams, new Map()));
  bare.push(...detectDuplicates(works));
  const bareByRule = new Map();
  for (const c of bare) bareByRule.set(c.rule_id, (bareByRule.get(c.rule_id) ?? 0) + 1);

  console.log('  rule    unseeded -> seeded');
  const ids = [...new Set([...byRule.keys(), ...bareByRule.keys()])].sort();
  for (const id of ids) {
    const before = bareByRule.get(id) ?? 0;
    const after = byRule.get(id) ?? 0;
    const mark = before === after ? '' : after > before ? '   +' + (after - before) : '   ' + (after - before);
    console.log(`  ${id}   ${String(before).padStart(6)} -> ${String(after).padStart(5)}${mark}`);
  }
  console.log(`  ${'TOTAL'.padEnd(6)} ${String(bare.length).padStart(6)} -> ${String(candidates.length).padStart(5)}`);
  console.log(`\n  R-010 had ${photo.comparable_works} comparable works` +
    ` and ${photo.unusable_keys} unusable keys`);
}

// ─── Main ────────────────────────────────────────────────────

console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN — nothing is written'}  seed=${SEED}  today=${TODAY}`);
console.log(`modules: ${MODULES.join(', ')}\n`);

// `--project` replays the real detectors, which read far more columns than the
// seeder itself does (title, category, agency_id, completion_target_date...).
const works = await fetchAll(
  'works',
  PROJECT
    ? '*'
    : 'id, esakshi_work_id, district_id, status, sanctioned_amount, released_amount, expenditure, ' +
      'physical_progress_pct, sanction_date, actual_completion_date, has_uc, latitude, longitude',
);
console.log(`loaded ${works.length} works\n`);

const RUN = {
  payments: () => seedPayments(works),
  health: () => seedHealthReports(works),
  photos: () => seedPhotoHashes(works),
  inspections: () => seedInspections(works),
  review: () => seedReviews(),
};

for (const m of MODULES) {
  console.log(`── ${m} ${'─'.repeat(58 - m.length)}`);
  await RUN[m]();
  console.log('');
}

console.log('── plan ' + '─'.repeat(54));
for (const s of stats) console.log(`  ${String(s.rows).padStart(6)}  ${s.table.padEnd(30)} ${s.mode}`);

if (PROJECT) {
  console.log('\n── projection: what the next analyze run would raise ' + '─'.repeat(9));
  await projectAlerts(works);
}

console.log(`\n${APPLY ? 'Written.' : 'Nothing written. Re-run with --apply.'}`);

if (!APPLY) {
  console.log(`
NOT SEEDED — answer_key / evaluation_runs.

  The Empirical Evaluation page needs ground truth: which works were *planted*
  with which anomaly, recorded independently of what the rules then found. This
  corpus came in through ingest, so no such record exists, and there is no honest
  way to manufacture one.

  Labelling only the 14 demo CSV rows would be worse than leaving it blank.
  \`services/evaluation.ts\` counts a false positive for every alert whose rule_id
  appears anywhere in the answer key but whose (work, rule) pair is not planted —
  so a 14-work key covering R-002..R-008 would score the 84 R-007 and 57 R-006
  alerts on the other 2,186 works as false positives. Precision would read in the
  single digits and would be measuring the answer key's coverage, not the
  engine's accuracy. The page is blank because the measurement is not available,
  which is the correct thing for it to show.

  The honest path is the one the answer key was designed for: run \`data-gen\`
  against a separate evaluation corpus where the planting is recorded as it
  happens, and report precision/recall on that, clearly labelled as synthetic.`);
}
