/**
 * Query Router — POST /query, GET /query/status, GET /query/examples
 *
 * The HTTP surface for P-15. Thin by design: every decision lives in
 * `services/nl_query.ts` and `services/sql_guard.ts`, and this file's job is to read the
 * body, name the actor, and shape the response.
 *
 * ## Two things this router does that are unusual, and deliberate
 *
 * **It returns the generated SQL on success and on failure.** Most text-to-SQL products
 * hide the query. Here it is the point: an officer acting on an integrity finding has to
 * be able to see what was actually counted. Doctrine 7 — a detector nobody can explain is
 * a detector nobody should act on — applies to a query the same way it applies to a rule.
 * On the failure path the SQL travels in `error.details.sql`, so a rejected query is
 * inspectable rather than merely refused.
 *
 * **`POST` for a read.** It mutates nothing in the corpus, which normally argues for GET.
 * But it appends to the audit ledger on every execution, a question is long enough to
 * belong in a body rather than a query string, and a GET would be cached and logged by
 * every intermediary with the question in the URL. The route is POST and the honest
 * description is "a read that is recorded".
 *
 * Express 5: async rejections forward to the error middleware automatically, so nothing
 * here catches to build a response. `throw new ApiError` and let `server.ts:95` render it.
 */

import { Router } from 'express';
import { ApiError, actorOf, requireBody, requireString } from '../http.ts';
import { answerQuestion, capability } from '../services/nl_query.ts';
import { isConfigured } from '../services/llm.ts';

const router = Router();

/**
 * GET /query/status — can this feature be used, and under what limits.
 *
 * Exists so the UI can render an honest disabled state instead of offering a text box
 * that will always fail. It reports the absence of a credential as a fact about the
 * deployment rather than as an error, which is why it is 200 with `available: false` and
 * not a 503.
 */
router.get('/query/status', async (_req, res) => {
  res.json({ data: capability() });
});

/**
 * GET /query/examples — questions that are known to translate well.
 *
 * Not decoration. A blank text box in front of a text-to-SQL system produces questions
 * the schema cannot answer, and the officer reads the resulting error as the product
 * being broken. These examples teach the shape of an answerable question — an aggregate,
 * over a named unit of accountability, with a threshold in it.
 *
 * Every example here is answerable from the eleven allowlisted relations, and none of
 * them aggregates by elected representative. That is not a coincidence; it is the same
 * doctrine the guard enforces, expressed as an affordance so the officer is led toward
 * questions the platform is willing to answer rather than into a rejection.
 */
router.get('/query/examples', async (_req, res) => {
  res.json({
    data: [
      {
        question: 'Which agencies have the most overdue works?',
        why: 'Agency-level accountability, which is the unit an officer can act on.',
      },
      {
        question: 'How many works in each district have released funds but zero expenditure?',
        why: 'A fund-flow question the corpus can answer exactly, per district.',
      },
      {
        question: 'What is the total sanctioned amount in crore by category?',
        why: 'Money aggregated by category, with the unit conversion in the query.',
      },
      {
        question: 'Show open critical alerts with their rule and the work title.',
        why: 'A join across alerts and works, sorted so the severe rows come first.',
      },
      {
        question: 'Which rules have raised the most dismissed alerts?',
        why: 'Rule quality, readable from alerts and review_actions.',
      },
      {
        question: 'List completed works with physical progress below 100 percent.',
        why: 'An internal contradiction in the record — exactly what R-008 looks for.',
      },
      {
        question: 'How many works have no payment recorded since their sanction date?',
        why: 'A null-aware question; the SQL has to decide what a null payment date means.',
      },
      {
        question: 'Average days between sanction and first payment, by district.',
        why: 'A time-to-event measure the corpus supports without modelling.',
      },
    ],
  });
});

/**
 * POST /query — ask a question, get rows plus the SQL that produced them.
 *
 * Body: `{ question: string }`
 *
 * Failure modes, all of them explicit rather than degraded:
 *   - `503 LLM_UNCONFIGURED` — no credential. Checked here before the actor is resolved,
 *     so a deployment without a key gives a clear answer rather than a 401 about a header.
 *   - `400 UNSAFE_QUERY` — the guard refused the generated SQL. `details.sql` carries it.
 *   - `422 QUERY_FAILED` — valid-shaped SQL that Postgres would not run, usually a column
 *     the model invented. Distinguished from `UNSAFE_QUERY` because the officer's next
 *     action differs: rephrase, versus this question is not permitted.
 *   - `502 LLM_AUTH` / `504 LLM_TIMEOUT` / `502 LLM_FAILED` — from `services/llm.ts`.
 */
router.post('/query', async (req, res) => {
  // Checked before `actorOf`, which throws 401 when no actor is named. Without this, a
  // deployment with no Gemini key would report an authentication problem for a request
  // that was never going to reach the model — a misleading error is worse than a blunt one.
  if (!isConfigured()) {
    const cap = capability();
    throw new ApiError(503, 'LLM_UNCONFIGURED', cap.reason ?? 'Model not configured.', {
      status: cap,
    });
  }

  const body = requireBody(req);
  const question = requireString(body, 'question');
  const actor = actorOf(req);

  const answer = await answerQuestion(question, actor);
  res.json({ data: answer });
});

export default router;
