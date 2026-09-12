/**
 * Ingest Router — POST /ingest, GET /ingest/history
 * Validates, parses, and upserts e-SAKSHI CSV datasets,
 * then triggers compliance rule re-execution.
 *
 * Fund flow arrives as a `payment_history` column carrying the work's stage
 * payments, not as `first_installment` / `second_installment`. Those two are
 * retired from the contract: they cannot hold an N-stage history, carry no
 * dates — so "no payment for an extended period" is unaskable — and cannot be
 * reconciled against PFMS, which settles per payment. A file that still carries
 * them is accepted; the values are reported back as ignored rather than
 * converted, because converting them would require inventing the payment dates
 * they do not have.
 */

import { Router } from 'express';
import { getDb, upsertMany } from '../db.ts';
import { appendAudit } from '../services/audit_chain.ts';
import { actorOf, requireBody } from '../http.ts';
import { nowIso, newId } from '../util.ts';
import { runAnalyze } from '../services/alerts.ts';
import { writePayments, type PaymentInput } from '../services/payments.ts';
import { isPaymentStage } from '../services/fund_flow.ts';
import { WORK_STATUSES } from '../types.ts';
import type { WorkStatus } from '../types.ts';

const router = Router();

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse the `payment_history` cell into stage payments.
 *
 * Format: `STAGE:YYYY-MM-DD:AMOUNT` entries separated by `|`, in payment order.
 * Pipe-separated rather than comma-separated so an unquoted cell survives the
 * CSV split, and one cell rather than a second file so a work and its payments
 * arrive together and cannot be half-imported.
 *
 *   MOBILISATION_ADVANCE:2025-01-15:500000|RUNNING_BILL:2025-04-02:750000
 *
 * Malformed entries are returned as errors, not skipped. A payment that vanishes
 * on the way in leaves a work looking unfunded, and R-014 would then report that
 * as a finding — a fabricated one.
 */
export function parsePaymentHistory(
  cell: string,
  workId: string,
): { payments: PaymentInput[]; errors: string[] } {
  const payments: PaymentInput[] = [];
  const errors: string[] = [];
  const trimmed = cell.replace(/^"|"$/g, '').trim();
  if (!trimmed) return { payments, errors };

  const entries = trimmed.split('|').map((e) => e.trim()).filter((e) => e.length > 0);
  entries.forEach((entry, idx) => {
    const parts = entry.split(':').map((p) => p.trim());
    if (parts.length !== 3) {
      errors.push(`entry ${idx + 1} ("${entry}"): expected STAGE:DATE:AMOUNT`);
      return;
    }
    const [stage, date, amountRaw] = parts as [string, string, string];
    if (!isPaymentStage(stage)) {
      errors.push(`entry ${idx + 1}: unknown stage '${stage}'`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`entry ${idx + 1}: date '${date}' is not YYYY-MM-DD`);
      return;
    }
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`entry ${idx + 1}: amount '${amountRaw}' is not a positive number`);
      return;
    }
    payments.push({
      work_id: workId,
      amount,
      payment_date: date,
      stage,
      sequence_number: idx + 1,
    });
  });

  return { payments, errors };
}

/** POST /ingest — Parse and import CSV data */
router.post('/', async (req, res) => {
  const actor = actorOf(req);
  const { csv } = requireBody(req);

  if (!csv || typeof csv !== 'string') {
    res.status(400).json({ error: { code: 'INVALID_CSV', message: 'csv string is required' } });
    return;
  }

  try {
    const lines = csv.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      res.status(400).json({ error: { code: 'EMPTY_CSV', message: 'CSV must contain headers and data' } });
      return;
    }

    const headers = parseCsvLine(lines[0]!);
    const expectedHeaders = ['work_id', 'district_lgd', 'constituency_code', 'work_title'];
    for (const eh of expectedHeaders) {
      if (!headers.includes(eh)) {
        res.status(400).json({ error: { code: 'INVALID_HEADERS', message: `Missing required header column: ${eh}` } });
        return;
      }
    }

    const db = getDb();

    // Pre-fetch districts, constituencies, agencies to map them dynamically.
    //
    // The error is checked rather than destructured away. These three selects
    // used to discard it, and a failure is silent but not harmless: `districts`
    // comes back undefined, every lookup below misses, the fallback chain runs
    // out at `newId()`, and each row is written with a district_id that exists
    // in no table. The insert then fails on a foreign key, several hundred rows
    // later, naming a constraint rather than the select that actually broke.
    const [districtsRes, constituenciesRes, agenciesRes] = await Promise.all([
      db.from('districts').select('id, lgd_code, name'),
      db.from('constituencies').select('id, lgd_code, name'),
      db.from('agencies').select('id, name'),
    ]);
    for (const [label, r] of [
      ['districts', districtsRes], ['constituencies', constituenciesRes], ['agencies', agenciesRes],
    ] as const) {
      if (r.error) throw new Error(`ingest reference fetch (${label}): ${r.error.message}`);
    }
    const districts = districtsRes.data;
    const constituencies = constituenciesRes.data;
    const agencies = agenciesRes.data;

    const districtMap = new Map(districts?.map(d => [d.lgd_code || d.name, d.id]) || []);
    const constituencyMap = new Map(constituencies?.map(c => [c.lgd_code || c.name, c.id]) || []);
    const agencyMap = new Map(agencies?.map(a => [a.name, a.id]) || []);

    const worksToUpsert: any[] = [];
    const paymentsToWrite: PaymentInput[] = [];
    const paymentErrors: string[] = [];
    /** Rows carrying a value in the retired installment columns. Reported, not converted. */
    let legacyInstallmentRows = 0;
    /**
     * Rows with no `recommended_date`.
     *
     * Counted and reported because the consequence is invisible otherwise: these
     * works are excluded from the sanction-decision SLA entirely, so a file that
     * omits the column produces a screen reading "0 breached" that means "not
     * measured", not "on time".
     */
    let worksWithoutRecommendationDate = 0;
    /** Rows whose `status` was not one of `WORK_STATUSES`. */
    const unrecognisedStatuses: string[] = [];

    // Rows are parsed in one pass first, then their existing IDs are resolved in
    // a few batched queries.
    //
    // This loop used to ask the database "does this work already exist?" once per
    // row, sequentially, in the middle of building each record. On a 2,000-row
    // export against hosted Postgres that is 2,000 serial round trips before the
    // first write — minutes of latency, and long enough that the request is cut
    // off by the proxy in front of it. The work a row needs is the same either
    // way; only the number of round trips changes.
    const records: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]!);
      if (values.length < headers.length) continue;

      const record: Record<string, string> = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] || '';
      });
      if (!record['work_id']) continue;
      records.push(record);
    }

    // Existing works, keyed by the e-SAKSHI ID, so an ingest of a work already on
    // record keeps its UUID and updates in place instead of being written twice.
    // Chunked because the filter travels in the URL, and a single `in` list of a
    // few thousand IDs exceeds what the server will accept.
    const existingIdByEsakshi = new Map<string, string>();
    const LOOKUP_CHUNK = 200;
    for (let i = 0; i < records.length; i += LOOKUP_CHUNK) {
      const chunk = records.slice(i, i + LOOKUP_CHUNK).map((r) => r['work_id']!);
      const { data, error } = await db
        .from('works')
        .select('id, esakshi_work_id')
        .in('esakshi_work_id', chunk);
      if (error) throw new Error(`existing works lookup: ${error.message}`);
      for (const row of data ?? []) {
        if (row.esakshi_work_id) existingIdByEsakshi.set(row.esakshi_work_id, row.id);
      }
    }

    for (const record of records) {
      // Map references
      const esakshi_work_id = record['work_id'] || '';
      if (!esakshi_work_id) continue;

      // Extract existing or generate fallback district
      const dLgd = record['district_lgd'] || 'DIST_101';
      let district_id = districtMap.get(dLgd);
      if (!district_id) {
        // Fallback to first district
        district_id = districts?.[0]?.id || newId();
      }

      const cCode = record['constituency_code'] || '201';
      let constituency_id = constituencyMap.get(cCode);
      if (!constituency_id) {
        constituency_id = constituencies?.[0]?.id || newId();
      }

      const aName = record['agency_name']?.replace(/^"|"$/g, '') || 'Public Works Department (PWD)';
      let agency_id = agencyMap.get(aName);
      if (!agency_id) {
        agency_id = agencies?.[0]?.id || newId();
      }

      // Format work row matching DB schema
      //
      // Status is validated against the enum rather than taken verbatim. The
      // default used to be the literal 'PROPOSED', which is not one of
      // `WORK_STATUSES` — so every row of an export without a status column got a
      // status no query could match, and the SLA's rejected-work test
      // (`status === 'CANCELLED'`) could never fire on it. An unrecognised value
      // is counted and reported, not silently written.
      const rawStatus = record['status']?.trim().toUpperCase();
      let status: WorkStatus;
      if (!rawStatus) {
        status = 'NOT_STARTED';
      } else if ((WORK_STATUSES as readonly string[]).includes(rawStatus)) {
        status = rawStatus as WorkStatus;
      } else {
        status = 'NOT_STARTED';
        unrecognisedStatuses.push(`${esakshi_work_id}: status '${rawStatus}' is not a recognised value, recorded as NOT_STARTED`);
      }

      const sanctioned_amount = parseFloat(record['sanctioned_amount'] || '0');
      const expenditure = parseFloat(record['expenditure'] || '0');
      const released_amount = parseFloat(record['released_amount'] || '0');

      const sanction_date = record['sanction_date'] || null;
      const actual_completion_date = record['completion_date'] || null;
      const physical_progress_pct = parseInt(record['physical_progress_pct'] || '0', 10);

      // The recommendation date is kept as it arrives, or left null.
      //
      // This used to read `record['recommended_date'] || sanction_date || today`,
      // aliasing the sanction date onto the recommendation. Every work sanctioned
      // on ingest therefore carried a recommendation-to-sanction lag of exactly
      // zero, which made the 45-day sanction-decision SLA unmeasurable on ingested
      // data: no row could ever breach it, so R-020 and R-021 were silent for a
      // reason that had nothing to do with the works being timely. Where the
      // column is absent the value is genuinely unknown, and Doctrine 6 says an
      // unknown must not be filled in with a value that makes a rule quiet.
      const recommended_date = record['recommended_date']?.trim() || null;
      if (!recommended_date) worksWithoutRecommendationDate += 1;

      const title = record['work_title']?.replace(/^"|"$/g, '') || `Work ${esakshi_work_id}`;
      const description = record['work_description']?.replace(/^"|"$/g, '') || 'Imported via CSV Data Ingest';
      const category = record['category'] || 'OTHER';
      
      const has_uc = record['has_uc'] === 'true';
      const is_scsp = record['is_scsp'] === 'true';
      const is_tsp = record['is_tsp'] === 'true';
      
      const latitude = parseFloat(record['latitude'] || '28.6139');
      const longitude = parseFloat(record['longitude'] || '77.2090');

      // `first_installment` / `second_installment` are retired from the contract.
      // A file that still carries them is accepted, but the values are counted
      // and reported rather than written: with no payment date on either column
      // there is no honest way to turn them into stage payments, and inventing
      // the dates would put fabricated rows into the history that R-007 measures
      // stall periods against.
      if (parseFloat(record['first_installment'] || '0') > 0) legacyInstallmentRows += 1;
      else if (parseFloat(record['second_installment'] || '0') > 0) legacyInstallmentRows += 1;

      // Retain the UUID of a work already on record, otherwise mint one. Resolved
      // from the map built above rather than by a query inside this loop.
      const workId = existingIdByEsakshi.get(esakshi_work_id) || newId();

      // Stage payments travel with the work, so the two cannot be half-imported.
      if (record['payment_history']) {
        const parsed = parsePaymentHistory(record['payment_history'], workId);
        paymentsToWrite.push(...parsed.payments);
        for (const err of parsed.errors) {
          paymentErrors.push(`${esakshi_work_id}: ${err}`);
        }
      }

      worksToUpsert.push({
        id: workId,
        esakshi_work_id,
        district_id,
        constituency_id,
        agency_id,
        title,
        description,
        category,
        location_name: record['location_name'] || 'Main Site',
        status,
        physical_progress_pct,
        sanctioned_amount,
        expenditure,
        released_amount,
        recommended_date,
        sanction_date,
        actual_completion_date,
        has_uc,
        is_scsp,
        is_tsp,
        latitude,
        longitude,
        // No first_installment / second_installment. Retired from the contract;
        // the stage history in `payments` is the fund-flow record.
        //
        // No mp_name. The CSV does not carry one, so any value written here
        // would be invented, and Doctrine 3 bars MP-level attribution in the
        // first place. The column keeps its schema default.
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }

    if (worksToUpsert.length > 0) {
      // Upsert in batches of 50 to avoid big payload sizes
      const batchSize = 50;
      for (let i = 0; i < worksToUpsert.length; i += batchSize) {
        const batch = worksToUpsert.slice(i, i + batchSize);
        await upsertMany('works', batch, 'esakshi_work_id');
      }
    }

    // Payments after works: the foreign key requires the work row to exist, and
    // `writePayments` refreshes `works.last_payment_date` as it goes, so the
    // stall detector reads a date derived from rows rather than falling back to
    // `sanction_date`.
    let paymentsWritten = 0;
    const paymentsRejected: string[] = [...paymentErrors];
    if (paymentsToWrite.length > 0) {
      const result = await writePayments(paymentsToWrite);
      paymentsWritten = result.written;
      for (const r of result.rejected) {
        paymentsRejected.push(`${r.input.work_id} seq ${r.input.sequence_number ?? '?'}: ${r.reason}`);
      }
    }

    // Run the rules engine & detectors pipeline to refresh the Triage Queue alerts!
    const summary = await runAnalyze(actor);

    // What the rules found on *these* rows.
    //
    // `summary` is corpus-wide, and on a loaded corpus it answers a question the
    // operator did not ask: they uploaded 14 works and were told 2,214 were
    // analysed and 1,647 alerts are in the backlog. Worse, the alert budget caps
    // each district at ten OPEN, and the existing corpus has already filled it,
    // so every finding on a freshly uploaded row lands in BACKLOG and is
    // invisible on the triage queue. The file looked like it had been accepted
    // and nothing had come of it.
    //
    // The budget is not the thing to change — it exists so a bad day upstream
    // cannot bury the queue. What was missing is the answer scoped to the rows
    // just submitted, which is this.
    const ingestedIds = worksToUpsert.map((w) => w.id as string);
    const findings: Array<{
      esakshi_work_id: string;
      rule_id: string;
      severity: string;
      status: string;
      evidence_text: string;
    }> = [];

    // Chunked: the id list travels in the query string, and 200 ids of 36
    // characters keeps the URL well inside what the server accepts.
    for (let i = 0; i < ingestedIds.length; i += 200) {
      const { data, error } = await db
        .from('alerts')
        .select('rule_id, severity, status, evidence_text, works!inner(esakshi_work_id)')
        .in('work_id', ingestedIds.slice(i, i + 200))
        .order('severity_rank', { ascending: true });
      if (error) throw new Error(`ingest findings: ${error.message}`);
      for (const row of (data ?? []) as unknown as Array<{
        rule_id: string;
        severity: string;
        status: string;
        evidence_text: string;
        works: { esakshi_work_id: string } | null;
      }>) {
        findings.push({
          esakshi_work_id: row.works?.esakshi_work_id ?? '',
          rule_id: row.rule_id,
          severity: row.severity,
          status: row.status,
          evidence_text: row.evidence_text,
        });
      }
    }

    // Record audit event
    await appendAudit(actor, 'INGEST_ATTEMPT', 'system', 'ingest', {
      timestamp: nowIso(),
      works_loaded: worksToUpsert.length,
      payments_loaded: paymentsWritten,
      payments_rejected: paymentsRejected.length,
      legacy_installment_rows_ignored: legacyInstallmentRows,
      works_without_recommendation_date: worksWithoutRecommendationDate,
      unrecognised_statuses: unrecognisedStatuses.length,
      alerts_generated: summary.open_alerts,
      findings_on_batch: findings.length,
    });

    res.json({
      data: {
        status: 'success',
        count: worksToUpsert.length,
        payments_written: paymentsWritten,
        // Surfaced, not swallowed. An operator who uploaded 200 payments and got
        // 180 needs to see the 20 and why, in the response that reports success.
        payments_rejected: paymentsRejected,
        // Rows whose retired installment columns held a value. Not converted:
        // neither column carries a payment date, so a stage payment built from
        // them would need one invented.
        legacy_installment_rows_ignored: legacyInstallmentRows,
        // Works excluded from the sanction-decision SLA for want of a start date.
        // Reported so an empty breach count is not mistaken for a clean one.
        works_without_recommendation_date: worksWithoutRecommendationDate,
        // Statuses outside `WORK_STATUSES`, recorded as NOT_STARTED.
        unrecognised_statuses: unrecognisedStatuses,
        analysis: summary,
        // Every alert standing against the rows in this upload, whether the
        // district budget left it OPEN or pushed it to BACKLOG.
        findings,
      }
    });
  } catch (error: any) {
    console.error('Ingestion failed:', error);
    res.status(500).json({ error: { code: 'INGEST_ERROR', message: error.message || 'Internal database write failed' } });
  }
});

/** GET /ingest/history — past ingest runs */
router.get('/history', async (_req, res) => {
  const db = getDb();
  const { data, error } = await db
    .from('audit_events')
    .select('*')
    .eq('action', 'INGEST_ATTEMPT')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`ingest history: ${error.message}`);
  res.json({ data: data ?? [] });
});

export default router;
