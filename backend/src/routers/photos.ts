/**
 * Photos router — P-06's HTTP surface.
 *
 * Thin, like `routers/documents.ts`: every decision lives in `services/photo_ai.ts`,
 * `services/photo_reconcile.ts` and `services/photos.ts`. This file reads the body, names the
 * actor, and shapes the response.
 *
 * ## Upload and analysis are separate calls, and that is a design decision
 *
 * `POST /photos` stores the image. `POST /photos/:id/analyze` reads it. A combined endpoint
 * would make a good upload fail because the model was rate-limited, and the officer's
 * response to that would be to upload again — producing a duplicate object for a failure that
 * had nothing to do with the file. Storing first makes analysis retryable.
 *
 * ## The checks are published
 *
 * `GET /photos/checks` returns every `V-0xx` comparison with its own description. A finding
 * that says "V-001" and nothing else is unactionable; the officer should be able to read what
 * a check does without a support call. Same reasoning as `GET /rules` for the R-catalogue and
 * `GET /documents/checks` for the D-catalogue.
 *
 * Express 5 forwards async rejections to the error middleware, so nothing here catches to
 * build a response.
 */

import { Router } from 'express';
import { ApiError, actorOf, requireBody, requireString } from '../http.ts';
import { capability } from '../services/photo_ai.ts';
import { CHECK_IDS } from '../services/photo_reconcile.ts';
import {
  acceptPhotoFinding,
  analyzePhoto,
  dismissPhotoFinding,
  openPhotoFindings,
  photoUrl,
  photosForWork,
  storePhoto,
  MAX_PHOTO_BYTES,
} from '../services/photos.ts';
import { isConfigured } from '../services/llm.ts';

const router = Router();

/**
 * GET /photos/status — whether analysis is configured, and under what limits.
 *
 * 200 with `available: false` when no credential is set, not a 503. A deployment without a key
 * is a fact about the deployment, and the UI needs to render an honest disabled state rather
 * than an upload button whose second step always fails. Same contract as `/api/documents/status`.
 */
router.get('/status', async (_req, res) => {
  res.json({ data: { ...capability(), max_upload_bytes: MAX_PHOTO_BYTES } });
});

/**
 * GET /photos/checks — the V-catalogue.
 *
 * Deliberately labelled: these are not the R-0xx rules, nor the D-0xx document checks. They
 * produce no alerts, do not enter the district alert budget, and are not scored against
 * `answer_key`. The geotag check (V-001) is deterministic; the other three compare a model's
 * blind reading against the record. Publishing that here is how the distinction survives
 * contact with a UI.
 */
router.get('/checks', async (_req, res) => {
  res.json({
    data: {
      checks: Object.entries(CHECK_IDS).map(([id, description]) => ({ id, description })),
      note:
        'These are photo-versus-record comparisons, not catalogued rules. V-001 is ' +
        'deterministic trigonometry on the EXIF geotag; V-002/003/004 compare a vision ' +
        "model's blind reading against the record — no model decides whether a finding " +
        'exists, the comparison is code. They raise no alerts, do not enter the per-district ' +
        'alert budget, and are not scored against the evaluation answer key.',
    },
  });
});

/**
 * GET /photos/findings — open findings across the corpus, most severe first.
 *
 * The photo-AI worklist. Separate from `/api/alerts` and `/api/documents/findings` on
 * purpose: an officer triaging photo discrepancies is doing a different job from one triaging
 * rule alerts, and mixing them would put uncalibrated findings into a queue whose precision
 * is measured.
 */
router.get('/findings', async (req, res) => {
  const raw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 100;
  const data = await openPhotoFindings(limit);
  res.json({ data });
});

/**
 * GET /photos?work_id=… — a work's photos, each with its current analysis and that analysis's
 * findings.
 *
 * `work_id` is required. An unfiltered list of every photo in the corpus is not a view anyone
 * needs, and returning one would mean signing URLs for files nobody asked about.
 */
router.get('/', async (req, res) => {
  const workId = typeof req.query.work_id === 'string' ? req.query.work_id.trim() : '';
  if (workId === '') {
    throw new ApiError(400, 'MISSING_PARAM', "'work_id' is required.");
  }
  const data = await photosForWork(workId);
  res.json({ data });
});

/**
 * POST /photos — store an image against a work.
 *
 * Body: `{ work_id, caption?, filename, content_base64, content_type }`.
 *
 * base64 in a JSON body rather than multipart, for the same reasons as documents: no
 * multipart parser, the `POST /api/ingest` precedent, and `express.json({ limit: '10mb' })`
 * accommodating the 5 MB ceiling once inflated by 4/3. The size limit is enforced on the
 * decoded bytes, so the error names the operator's file size.
 *
 * The response reports `duplicate_of` — other works already holding byte-identical content —
 * and `exif`, the geotag and capture time parsed from the file at upload. Neither is an
 * error: a re-upload correcting a caption is routine, and a missing geotag is common (every
 * messaging app strips it). Both are surfaced at the moment of upload because that is the
 * honest place to show them.
 */
router.post('/', async (req, res) => {
  const body = requireBody(req);
  const caption =
    typeof body['caption'] === 'string' && body['caption'].trim() !== ''
      ? body['caption'].trim()
      : null;
  const result = await storePhoto({
    work_id: requireString(body, 'work_id'),
    caption,
    filename: requireString(body, 'filename'),
    content_base64: requireString(body, 'content_base64'),
    content_type: requireString(body, 'content_type'),
    actor: actorOf(req),
  });

  res.status(201).json({
    data: {
      photo: result.photo,
      duplicate_of: result.duplicate_of,
      // The deterministic facts read from the file's bytes. `latitude`/`longitude` are null
      // when the image carried no geotag — never 0, which would be a real point in the ocean.
      exif: result.exif,
    },
  });
});

/**
 * POST /photos/:id/analyze — read the stored image and compare it against the work.
 *
 * The credential check comes first, before the photo is even looked up, so a keyless
 * deployment answers "not configured" rather than a 404. Same ordering, and the same reason,
 * as `POST /api/documents/:id/extract`.
 *
 * Failure modes, all explicit:
 *   - `503 LLM_UNCONFIGURED` — no credential. The geotag check is deterministic but is
 *     produced within an analysis pass, so it too waits on a configured key.
 *   - `422 PHOTO_UNREADABLE` — the model returned no observation set. A failed reading, which
 *     is different from an image with nothing legible in it, and nothing is recorded.
 *   - `400 DOCUMENT_UNSUPPORTED_TYPE` / `413 DOCUMENT_TOO_LARGE` — the shared `services/llm.ts`
 *     reader's own codes. Structurally unreachable here: a stored photo's type and size were
 *     already validated at upload against a subset of what the reader accepts.
 *
 * `checks_run` is in the response beside `findings` because zero findings out of four checks
 * and zero findings out of zero checks look identical on a dossier and mean opposite things.
 */
router.post('/:id/analyze', async (req, res) => {
  if (!isConfigured()) {
    const cap = capability();
    throw new ApiError(503, 'LLM_UNCONFIGURED', cap.reason ?? 'Model not configured.', {
      status: cap,
    });
  }

  const id = req.params.id;
  const actor = actorOf(req);
  const result = await analyzePhoto(id, actor);

  res.json({
    data: {
      analysis: result.analysis,
      findings: result.findings,
      checks_run: result.checks_run,
      superseded_analysis_id: result.superseded,
    },
  });
});

/** GET /photos/:id/url — a 5-minute signed URL. The evidence bucket is private. */
router.get('/:id/url', async (req, res) => {
  const data = await photoUrl(req.params.id);
  res.json({ data });
});

/**
 * PATCH /photos/findings/:id — accept or dismiss.
 *
 * Body: `{ status: 'ACCEPTED' | 'DISMISSED', note?, reason? }`.
 *
 * A dismissal requires a reason, for the same reason `PATCH /api/alerts/:id` does: a dismissal
 * with no stated reason is indistinguishable from a queue being cleared, and these dismissals
 * are the only evidence a check produces noise. V-002 and the softer V-001 tier are expected
 * to be dismissed often, and that record is how anyone would know to tune them.
 *
 * Unlike documents, no photo finding writes back to `works`: accepting one records the
 * officer's judgement and nothing about the work row changes on it.
 *
 * A finding can be reviewed once: an already-accepted/dismissed finding is `409 ALREADY_REVIEWED`,
 * and one whose analysis a re-read has superseded is `409 ANALYSIS_SUPERSEDED` — the guard lives
 * in `getReviewableFinding`, so a decision is recorded against the reading that was on screen.
 */
router.patch('/findings/:id', async (req, res) => {
  const body = requireBody(req);
  const status = requireString(body, 'status').toUpperCase();
  const actor = actorOf(req);

  if (status === 'ACCEPTED') {
    const note =
      typeof body['note'] === 'string' && body['note'].trim() !== '' ? body['note'].trim() : null;
    const finding = await acceptPhotoFinding(req.params.id, actor, note);
    res.json({ data: { finding } });
    return;
  }

  if (status === 'DISMISSED') {
    const reason = requireString(body, 'reason');
    const finding = await dismissPhotoFinding(req.params.id, actor, reason);
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

export default router;
