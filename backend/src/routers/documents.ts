/**
 * Documents router — P-04's HTTP surface.
 *
 * Thin, like `routers/query.ts`: every decision lives in `services/document_ai.ts`,
 * `services/document_reconcile.ts` and `services/documents.ts`. This file reads the body,
 * names the actor, and shapes the response.
 *
 * ## Upload and extraction are separate calls, and that is a design decision
 *
 * `POST /documents` stores the file. `POST /documents/:id/extract` reads it. A combined
 * endpoint would make a good upload fail because the model was rate-limited, and the
 * officer's response to that would be to upload again — producing a duplicate object for a
 * failure that had nothing to do with the file. Storing first makes extraction retryable.
 *
 * ## The checks are published
 *
 * `GET /documents/checks` returns every `D-0xx` comparison with its own description. A
 * finding that says "D-001" and nothing else is unactionable, and the officer should be
 * able to read what a check does without a support call. Same reasoning as
 * `GET /rules` for the R-catalogue.
 *
 * Express 5 forwards async rejections to the error middleware, so nothing here catches to
 * build a response.
 */

import { Router } from 'express';
import { ApiError, actorOf, requireBody, requireString } from '../http.ts';
import { capability } from '../services/document_ai.ts';
import { CHECK_IDS } from '../services/document_reconcile.ts';
import {
  acceptFinding,
  dismissFinding,
  documentUrl,
  documentsForWork,
  extractDocument,
  openFindings,
  storeDocument,
  MAX_UPLOAD_BYTES,
} from '../services/documents.ts';
import { isConfigured } from '../services/llm.ts';

const router = Router();

/**
 * GET /documents/status — whether reading is configured, and under what limits.
 *
 * 200 with `available: false` when no credential is set, not a 503. A deployment without a
 * key is a fact about the deployment, and the UI needs to render an honest disabled state
 * rather than an upload button whose second step always fails. Same contract as
 * `/api/query/status`.
 */
router.get('/status', async (_req, res) => {
  res.json({ data: { ...capability(), max_upload_bytes: MAX_UPLOAD_BYTES } });
});

/**
 * GET /documents/checks — the D-catalogue.
 *
 * Deliberately labelled: these are not the R-0xx rules. They produce no alerts, do not enter
 * the district alert budget, and are not scored against `answer_key`. Publishing them here
 * with that statement attached is how the distinction survives contact with a UI.
 */
router.get('/checks', async (_req, res) => {
  res.json({
    data: {
      checks: Object.entries(CHECK_IDS).map(([id, description]) => ({ id, description })),
      note:
        'These are document-versus-record comparisons, not catalogued rules. Each is ' +
        'arithmetic or string comparison over an extracted field and a portal field — no ' +
        'model decides whether a finding exists. They raise no alerts, do not enter the ' +
        'per-district alert budget, and are not scored against the evaluation answer key.',
    },
  });
});

/**
 * GET /documents/findings — open findings across the corpus, most severe first.
 *
 * The document-AI worklist. Separate from `/api/alerts` on purpose: an officer triaging
 * document discrepancies is doing a different job from one triaging rule alerts, and mixing
 * them would put uncalibrated findings into a queue whose precision is measured.
 */
router.get('/findings', async (req, res) => {
  const raw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 500) : 100;
  const data = await openFindings(limit);
  res.json({ data });
});

/**
 * GET /documents?work_id=… — a work's documents, each with its current extraction and that
 * extraction's findings.
 *
 * `work_id` is required. An unfiltered list of every document in the corpus is not a view
 * anyone needs, and returning one would mean signing URLs for files nobody asked about.
 */
router.get('/', async (req, res) => {
  const workId = typeof req.query.work_id === 'string' ? req.query.work_id.trim() : '';
  if (workId === '') {
    throw new ApiError(400, 'MISSING_PARAM', "'work_id' is required.");
  }
  const data = await documentsForWork(workId);
  res.json({ data });
});

/**
 * POST /documents — store a file against a work.
 *
 * Body: `{ work_id, type, filename, content_base64, content_type }`.
 *
 * base64 in a JSON body rather than multipart: the backend has no multipart parser, the
 * precedent is `POST /api/ingest` which posts a CSV as a JSON string, and
 * `express.json({ limit: '10mb' })` accommodates the 5 MB ceiling once inflated by 4/3.
 * The size limit is enforced on the *decoded* bytes, so the error names the operator's file
 * size rather than a transport artefact.
 *
 * The response reports `duplicate_of` — other works already holding byte-identical
 * content. Not an error: a re-upload correcting metadata is routine, and refusing it would
 * push the operator around the platform. But the same completion certificate on two works
 * is worth seeing at the moment it happens.
 */
router.post('/', async (req, res) => {
  const body = requireBody(req);
  const result = await storeDocument({
    work_id: requireString(body, 'work_id'),
    type: requireString(body, 'type'),
    filename: requireString(body, 'filename'),
    content_base64: requireString(body, 'content_base64'),
    content_type: requireString(body, 'content_type'),
    actor: actorOf(req),
  });

  res.status(201).json({
    data: {
      document: result.document,
      // null when `type` names no kind this platform can read. Reported at upload time so
      // the officer learns it now rather than when extraction refuses.
      readable_kind: result.kind,
      duplicate_of: result.duplicate_of,
    },
  });
});

/**
 * POST /documents/:id/extract — read the stored file and compare it against the work.
 *
 * The credential check comes first, before the document is even looked up, so a keyless
 * deployment answers "not configured" rather than a 404 or an authentication error about a
 * header. Same ordering, and the same reason, as `POST /api/query`.
 *
 * Failure modes, all explicit:
 *   - `503 LLM_UNCONFIGURED` — no credential.
 *   - `422 UNKNOWN_DOCUMENT_KIND` — `documents.type` names no readable kind. The kind
 *     selects the checks, so guessing it would compare a document against requirements it
 *     never claimed to meet.
 *   - `422 DOCUMENT_UNREADABLE` — the model returned no field set. A failed reading, which
 *     is different from a document that states nothing, and nothing is recorded.
 *   - `400 DOCUMENT_UNSUPPORTED_TYPE` / `413 DOCUMENT_TOO_LARGE` — from `services/llm.ts`.
 *
 * `checks_run` is in the response beside `findings` because zero findings out of eight
 * checks and zero findings out of zero checks look identical on a dossier and mean opposite
 * things.
 */
router.post('/:id/extract', async (req, res) => {
  if (!isConfigured()) {
    const cap = capability();
    throw new ApiError(503, 'LLM_UNCONFIGURED', cap.reason ?? 'Model not configured.', {
      status: cap,
    });
  }

  const id = req.params.id;
  const actor = actorOf(req);
  const result = await extractDocument(id, actor);

  res.json({
    data: {
      extraction: result.extraction,
      findings: result.findings,
      checks_run: result.checks_run,
      superseded_extraction_id: result.superseded,
    },
  });
});

/** GET /documents/:id/url — a 5-minute signed URL. The evidence bucket is private. */
router.get('/:id/url', async (req, res) => {
  const data = await documentUrl(req.params.id);
  res.json({ data });
});

/**
 * PATCH /documents/findings/:id — accept or dismiss.
 *
 * Body: `{ status: 'ACCEPTED' | 'DISMISSED', note?, reason? }`.
 *
 * A dismissal requires a reason, for the same reason `PATCH /api/alerts/:id` does: a
 * dismissal with no stated reason is indistinguishable from a queue being cleared, and
 * these dismissals are the only evidence a check produces noise. D-005 is expected to be
 * dismissed often, and that record is how anyone would know to retire it.
 *
 * Accepting D-007 is the one path in this feature that writes to `works` — see
 * `acceptFinding`. It is gated on a human because `has_uc` gates R-003, and a model reading
 * of a poor scan must not be able to silence a compliance rule.
 */
router.patch('/findings/:id', async (req, res) => {
  const body = requireBody(req);
  const status = requireString(body, 'status').toUpperCase();
  const actor = actorOf(req);

  if (status === 'ACCEPTED') {
    const note = typeof body['note'] === 'string' && body['note'].trim() !== ''
      ? body['note'].trim()
      : null;
    const result = await acceptFinding(req.params.id, actor, note);
    res.json({ data: result });
    return;
  }

  if (status === 'DISMISSED') {
    const reason = requireString(body, 'reason');
    const finding = await dismissFinding(req.params.id, actor, reason);
    res.json({ data: { finding, work_updated: null } });
    return;
  }

  throw new ApiError(
    400,
    'INVALID_VALUE',
    "'status' must be ACCEPTED or DISMISSED. A finding cannot be returned to OPEN — the " +
      'ledger records the decision that was made, and reopening would leave two ' +
      'contradictory entries with no way to tell which is current.',
  );
});

export default router;
