/**
 * Inspection Router — the field-inspection surface, and P-10's evidence comparison.
 *
 * `GET /`, `POST /` and `GET /:id` record and read inspections. The `/status`, `/checks`,
 * `/findings`, `/for-work/:workId` and `/:id/compare` routes are P-10: comparing what an
 * inspector recorded in the field against what the work record claims. Every decision lives in
 * `services/inspection_reconcile.ts` (the comparison) and `services/inspection_compare.ts` (the
 * orchestration); this file reads the body, names the actor, and shapes the response.
 *
 * Express 5 forwards async rejections to the error middleware, so nothing here catches to build
 * a response.
 */

import { Router } from 'express';
import { getDb, get, all, insert, insertMany } from '../db.ts';
import { ApiError, paging, qstr, notFound, requireBody, requireString, actorOf } from '../http.ts';
import { appendAudit } from '../services/audit_chain.ts';
import { newId, nowIso } from '../util.ts';
import { CHECK_IDS } from '../services/inspection_reconcile.ts';
import {
  acceptInspectionFinding,
  capability,
  compareInspection,
  dismissInspectionFinding,
  evidenceForWork,
  openInspectionFindings,
} from '../services/inspection_compare.ts';
import type { Inspection, InspectionItem } from '../types.ts';

const router = Router();

/** GET /inspections — list inspections */
router.get('/', async (req, res) => {
  const { page, page_size } = paging(req);
  const work_id = qstr(req, 'work_id');

  const db = getDb();
  let query = db.from('inspections').select('*', { count: 'exact' });
  if (work_id) query = query.eq('work_id', work_id);
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1);

  const { data, error, count: total } = await query;
  if (error) throw new Error(`inspections list: ${error.message}`);

  res.json({
    data: data ?? [],
    meta: { total: total ?? 0, page, page_size, has_more: (total ?? 0) > page * page_size },
  });
});

/** POST /inspections — create or sync inspection from field PWA */
router.post('/', async (req, res) => {
  const actor = actorOf(req);
  const body = requireBody(req);

  const inspectionId = newId();
  const inspection = {
    id: inspectionId,
    work_id: body['work_id'] as string,
    inspector_id: actor,
    inspector_name: (body['inspector_name'] as string) ?? actor,
    inspection_date: (body['inspection_date'] as string) ?? nowIso().slice(0, 10),
    latitude: body['latitude'] as number,
    longitude: body['longitude'] as number,
    overall_status: body['overall_status'] as string,
    notes: (body['notes'] as string) ?? null,
    photo_keys: (body['photo_keys'] as string[]) ?? [],
    synced: true,
    created_at: nowIso(),
  };

  await insert('inspections', inspection);

  // Insert checklist items
  const items = (body['items'] as Array<{ checklist_id: string; checked: boolean; note?: string }>) ?? [];
  if (items.length > 0) {
    const itemRows = items.map(item => ({
      id: newId(),
      inspection_id: inspectionId,
      checklist_id: item.checklist_id,
      checked: item.checked,
      note: item.note ?? null,
    }));
    await insertMany('inspection_items', itemRows);
  }

  await appendAudit(actor, 'INSPECTION_CREATED', 'inspection', inspectionId, {
    work_id: body['work_id'],
    overall_status: body['overall_status'],
  });

  // `inspection` already carries `id`, so spreading it after an explicit `id` silently
  // overwrote the explicit one (TS2783). They hold the same value; the spread alone is correct.
  res.status(201).json({ data: inspection });
});

// ─── Inspection evidence vs the work record (P-10) ───────────────────────────
//
// These sit between `POST /` and `GET /:id` deliberately. Express matches in declaration
// order, so `/status`, `/checks`, `/findings` and `/for-work/:workId` must be declared before
// the `/:id` parameter route or that route would swallow them — `GET /inspections/status`
// would look up an inspection whose id is the literal string "status".

/**
 * GET /inspections/status — whether the comparison can run.
 *
 * Unconditionally `available: true`, unlike `/api/photos/status` and `/api/documents/status`:
 * every I-check is deterministic arithmetic over values already on record, so there is no
 * credential and no configuration state in which the feature is unavailable. Kept as an
 * endpoint anyway so the panel's pre-render check is uniform across all three features.
 */
router.get('/status', async (_req, res) => {
  res.json({ data: capability() });
});

/**
 * GET /inspections/checks — the I-catalogue.
 *
 * Deliberately labelled: these are not the R-0xx rules, the D-0xx document checks, or the
 * V-0xx photo checks. They raise no alerts, do not enter the per-district alert budget, carry
 * no verification_status, and are not scored against the evaluation answer key.
 */
router.get('/checks', async (_req, res) => {
  res.json({
    data: {
      checks: Object.entries(CHECK_IDS).map(([id, description]) => ({ id, description })),
      note:
        'These are inspection-versus-record comparisons, not catalogued rules. Every one is ' +
        'deterministic — a distance, a date subtraction or an equality over values already on ' +
        'record; no model is consulted. They raise no alerts, do not enter the per-district ' +
        'alert budget, and are not scored against the evaluation answer key. The record side ' +
        'names the column compared against, never a person: no column records who entered a ' +
        "work's status, so attributing it to an author would be a fabrication.",
    },
  });
});

/**
 * GET /inspections/findings — open findings across the corpus, most severe first.
 *
 * The inspection-evidence worklist. Separate from `/api/alerts` on purpose: an officer
 * triaging field-evidence discrepancies is doing a different job from one triaging rule
 * alerts, and mixing them would put uncalibrated findings into a queue whose precision is
 * measured against the answer key.
 */
router.get('/findings', async (req, res) => {
  const raw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 100;
  const data = await openInspectionFindings(limit);
  res.json({ data });
});

/**
 * GET /inspections/for-work/:workId — every inspection on a work with its current comparison.
 *
 * A null `comparison` on a row means nobody has run the comparison yet — not that the
 * inspection is clean. The panel renders those two states differently.
 */
router.get('/for-work/:workId', async (req, res) => {
  const data = await evidenceForWork(req.params.workId);
  res.json({ data });
});

/**
 * POST /inspections/:id/compare — compare one inspection against its work and photographs.
 *
 * Re-runnable: a second call supersedes the previous comparison rather than overwriting it, so
 * the reading an officer acted on survives. `checks_run` is in the response beside `findings`
 * because zero findings out of four checks and zero out of zero look identical on a dossier
 * and mean opposite things.
 */
router.post('/:id/compare', async (req, res) => {
  const result = await compareInspection(req.params['id'] ?? '', actorOf(req));
  res.json({
    data: {
      comparison: result.comparison,
      findings: result.findings,
      checks_run: result.checks_run,
      superseded_comparison_id: result.superseded,
    },
  });
});

/**
 * PATCH /inspections/findings/:id — accept or dismiss.
 *
 * Body: `{ status: 'ACCEPTED' | 'DISMISSED', note?, reason? }`.
 *
 * A dismissal requires a reason, as everywhere else in the platform: a dismissal with no stated
 * reason is indistinguishable from a queue being cleared, and dismissals are the only evidence
 * a check produces noise. I-001 is expected to be dismissed on large or linear sites, and that
 * record is how anyone would know to widen its tolerance.
 *
 * No inspection finding writes back to `works`: accepting one records the officer's judgement,
 * and the correction to the work record belongs in e-SAKSHI.
 */
router.patch('/findings/:id', async (req, res) => {
  const body = requireBody(req);
  const status = requireString(body, 'status').toUpperCase();
  const actor = actorOf(req);
  const id = req.params['id'] ?? '';

  if (status === 'ACCEPTED') {
    const note =
      typeof body['note'] === 'string' && body['note'].trim() !== '' ? body['note'].trim() : null;
    const finding = await acceptInspectionFinding(id, actor, note);
    res.json({ data: { finding } });
    return;
  }

  if (status === 'DISMISSED') {
    const reason = requireString(body, 'reason');
    const finding = await dismissInspectionFinding(id, actor, reason);
    res.json({ data: { finding } });
    return;
  }

  throw new ApiError(
    400,
    'INVALID_VALUE',
    "'status' must be ACCEPTED or DISMISSED. A finding cannot be returned to OPEN — the " +
      'ledger records the decision that was made, and reopening would leave two contradictory ' +
      'entries with no way to tell which is current.',
  );
});

/** GET /inspections/:id — inspection detail with items */
router.get('/:id', async (req, res) => {
  const inspection = await get<Inspection>('inspections', { id: req.params['id'] });
  notFound(inspection, 'Inspection', req.params['id'] ?? '');

  const items = await all<InspectionItem>('inspection_items', {
    where: { inspection_id: inspection.id },
  });

  res.json({ data: { ...inspection, items } });
});

export default router;
