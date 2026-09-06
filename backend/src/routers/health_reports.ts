/**
 * Health reports — the 10-day progress check-in.
 *
 * The GET here used to catch the "table does not exist" error and answer 200 with
 * an empty list, because `health_reports` was DROPped by the schema and never
 * created. That is the failure mode this router now refuses: a caller could not
 * tell "no reports filed" from "nowhere to file them", the POST on the same
 * router had no such catch and 500'd, and R-019 measured cadence from
 * `works.updated_at` instead. The table exists (migration 010); a missing-table
 * error is now a real error and is reported as one.
 */

import { Router } from 'express';
import { ApiError, actorOf } from '../http.ts';
import { appendAudit } from '../services/audit_chain.ts';
import {
  recentReports,
  reportsForWork,
  writeHealthReport,
} from '../services/health_reports.ts';

const router = Router();

// GET /api/health_reports — list reports, newest first.
//
// Express 5 forwards async rejections to the error middleware, so there is no
// try/catch: a database error becomes a 500 with its own message rather than an
// empty array that reads as "no reports".
router.get('/', async (req, res) => {
  const workId = typeof req.query.work_id === 'string' ? req.query.work_id : '';
  const data = workId ? await reportsForWork(workId) : await recentReports(100);
  res.json({ data });
});

// POST /api/health_reports — file a 10-day report.
router.post('/', async (req, res) => {
  const { work_id, reported_by, report_date, progress_pct, evidence_image_key, remarks } =
    req.body ?? {};

  if (!work_id || progress_pct === undefined) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'work_id and progress_pct are required for a health report',
    );
  }

  // `evidence_image_key` is deliberately optional. It used to be required, which
  // meant a field inspector with no photo could file nothing at all — and a
  // work with no report is indistinguishable from a work nobody visited, which
  // is precisely what R-019 exists to surface. A report without a photo is a
  // weaker record than one with it; it is not worse than no record.
  let result;
  try {
    result = await writeHealthReport({
      work_id,
      reported_by,
      report_date,
      progress_pct,
      evidence_image_key,
      remarks,
    });
  } catch (err) {
    // The service throws a plain Error for a rejected input (out-of-range
    // progress, unknown work). Those are the caller's fault and are reported as
    // 400 with the reason, rather than surfacing as an opaque 500.
    const message = err instanceof Error ? err.message : String(err);
    if (/^(no work_id|progress_pct|report_date|unknown work_id)/.test(message)) {
      throw new ApiError(400, 'BAD_REQUEST', message);
    }
    throw err;
  }

  // Doctrine: every state mutation is audited. Two things changed — a report was
  // filed and the work's progress was overwritten — and the payload carries the
  // before-and-after of the second, because a progress figure that moved with no
  // record of what it was is an unexplainable number on a dossier.
  await appendAudit(actorOf(req), 'HEALTH_REPORT_FILED', 'work', work_id, {
    report_id: result.report.id,
    report_date: result.report.report_date,
    reported_by: result.report.reported_by,
    replaced_same_day_report: result.replaced,
    progress_pct_before: result.previous_progress_pct,
    progress_pct_after: result.report.progress_pct,
    has_evidence_image: Boolean(result.report.evidence_image_key),
  });

  res.status(201).json({ data: result.report, replaced: result.replaced });
});

export default router;
