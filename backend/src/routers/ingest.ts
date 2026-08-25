/**
 * Ingest Router — POST /ingest, GET /ingest/history
 * Validates, parses, and upserts 21-column e-SAKSHI CSV datasets,
 * then triggers compliance rule re-execution.
 */

import { Router } from 'express';
import { getDb, upsertMany } from '../db.ts';
import { appendAudit } from '../services/audit_chain.ts';
import { actorOf, requireBody } from '../http.ts';
import { nowIso, newId } from '../util.ts';
import { runAnalyze } from '../services/alerts.ts';

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

    // Pre-fetch districts, constituencies, agencies to map them dynamically
    const { data: districts } = await db.from('districts').select('id, lgd_code, name');
    const { data: constituencies } = await db.from('constituencies').select('id, lgd_code, name');
    const { data: agencies } = await db.from('agencies').select('id, name');

    const districtMap = new Map(districts?.map(d => [d.lgd_code || d.name, d.id]) || []);
    const constituencyMap = new Map(constituencies?.map(c => [c.lgd_code || c.name, c.id]) || []);
    const agencyMap = new Map(agencies?.map(a => [a.name, a.id]) || []);

    const worksToUpsert: any[] = [];

    // Parse records (Skip header)
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]!);
      if (values.length < headers.length) continue;

      const record: Record<string, string> = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] || '';
      });

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
      const status = record['status'] || 'PROPOSED';
      const sanctioned_amount = parseFloat(record['sanctioned_amount'] || '0');
      const expenditure = parseFloat(record['expenditure'] || '0');
      const released_amount = parseFloat(record['released_amount'] || '0');

      const sanction_date = record['sanction_date'] || null;
      const actual_completion_date = record['completion_date'] || null;
      const physical_progress_pct = parseInt(record['physical_progress_pct'] || '0', 10);
      
      const title = record['work_title']?.replace(/^"|"$/g, '') || `Work ${esakshi_work_id}`;
      const description = record['work_description']?.replace(/^"|"$/g, '') || 'Imported via CSV Data Ingest';
      const category = record['category'] || 'OTHER';
      
      const has_uc = record['has_uc'] === 'true';
      const is_scsp = record['is_scsp'] === 'true';
      const is_tsp = record['is_tsp'] === 'true';
      
      const latitude = parseFloat(record['latitude'] || '28.6139');
      const longitude = parseFloat(record['longitude'] || '77.2090');

      const first_installment = parseFloat(record['first_installment'] || '0');
      const second_installment = parseFloat(record['second_installment'] || '0');

      // Check if we already have it in DB to retain its UUID, otherwise create one
      const { data: existingWork } = await db
        .from('works')
        .select('id')
        .eq('esakshi_work_id', esakshi_work_id)
        .maybeSingle();

      worksToUpsert.push({
        id: existingWork?.id || newId(),
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
        recommended_date: record['recommended_date'] || sanction_date || nowIso().slice(0, 10),
        sanction_date,
        actual_completion_date,
        has_uc,
        is_scsp,
        is_tsp,
        latitude,
        longitude,
        first_installment,
        second_installment,
        mp_name: 'Hon. Member of Parliament',
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

    // Run the rules engine & detectors pipeline to refresh the Triage Queue alerts!
    const summary = await runAnalyze(actor);

    // Record audit event
    await appendAudit(actor, 'INGEST_ATTEMPT', 'system', 'ingest', {
      timestamp: nowIso(),
      works_loaded: worksToUpsert.length,
      alerts_generated: summary.open_alerts,
    });

    res.json({
      data: {
        status: 'success',
        count: worksToUpsert.length,
        analysis: summary
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
