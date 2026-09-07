/**
 * Ask the Corpus — the honest replacement for the copilot card that claimed
 * "continuous multi-modal anomaly telemetry active on 200 works".
 *
 * The design rule for this screen: **the SQL is not an implementation detail hidden
 * behind a disclosure triangle, it is part of the answer.** An officer who is going to
 * act on a number has to be able to see what was counted, and a text-to-SQL feature that
 * hides the query is asking to be trusted on the strength of its confidence. So the
 * generated SQL renders above the rows, always, unfolded.
 *
 * Three states this screen refuses to fudge:
 *   - **No credential on the server.** `/api/query/status` says so and the input is
 *     disabled with the reason shown. It does not offer a text box that will always fail.
 *   - **A rejected query.** The guard's explanation and the SQL it refused are both
 *     rendered. A refusal the officer cannot read looks like a bug.
 *   - **A truncated answer.** When the row cap was binding and reached, the result is
 *     labelled as partial rather than presented as the whole.
 */

import { useEffect, useState } from 'react';
import { PageHeader, Card, Button, Spinner } from '../components/ui';
import {
  Search,
  Database,
  AlertTriangle,
  Info,
  Table as TableIcon,
  Clock,
  ShieldCheck,
} from 'lucide-react';

interface QueryCapability {
  available: boolean;
  reason: string | null;
  model: string;
  readable_relations: string[];
  max_rows: number;
  statement_timeout_ms: number;
}

interface QueryExample {
  question: string;
  why: string;
}

interface QueryAnswer {
  question: string;
  sql_generated: string;
  sql_executed: string;
  relations: string[];
  truncated: boolean;
  rows: Record<string, unknown>[];
  row_count: number;
  columns: string[];
  model: string;
  latency_ms: { model: number; database: number };
  audit_seq: number | null;
}

interface QueryFailure {
  code: string;
  message: string;
  /** Present on UNSAFE_QUERY and QUERY_FAILED — the SQL that was refused. */
  sql: string | null;
}

/**
 * Renders a cell.
 *
 * `null` becomes an em dash, never `0` and never an empty cell. This is the eleventh
 * doctrine applied at the smallest possible scale: a null in a result set means the
 * database had nothing there, and rendering it as a blank invites the reader to supply
 * their own meaning.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toFixed(2);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AskPage() {
  const [capability, setCapability] = useState<QueryCapability | null>(null);
  const [examples, setExamples] = useState<QueryExample[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [failure, setFailure] = useState<QueryFailure | null>(null);
  const [asking, setAsking] = useState(false);
  const [loadingCapability, setLoadingCapability] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [capRes, exRes] = await Promise.all([
          fetch('/api/query/status'),
          fetch('/api/query/examples'),
        ]);
        const capJson = await capRes.json();
        const exJson = await exRes.json();
        setCapability(capJson.data ?? null);
        setExamples(exJson.data ?? []);
      } catch (err) {
        console.error('Failed to load query capability:', err);
      } finally {
        setLoadingCapability(false);
      }
    };
    load();
  }, []);

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed === '' || asking) return;

    setAsking(true);
    setAnswer(null);
    setFailure(null);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'demo-officer' },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = await res.json();

      if (!res.ok) {
        setFailure({
          code: json?.error?.code ?? 'UNKNOWN_ERROR',
          message: json?.error?.message ?? `HTTP ${res.status}`,
          sql: json?.error?.details?.sql ?? null,
        });
        return;
      }
      setAnswer(json.data as QueryAnswer);
    } catch (err) {
      setFailure({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'The request did not complete.',
        sql: null,
      });
    } finally {
      setAsking(false);
    }
  };

  const available = capability?.available === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ask the Corpus"
        description="A question in plain language is translated to SQL by a language model, checked against an allowlist, and executed read-only. The generated SQL is shown with every answer — an officer acting on a number has to be able to see what was counted."
      />

      {/* Capability state first. An input that cannot work should say so before it is used. */}
      {loadingCapability ? (
        <Card className="flex items-center gap-3">
          <Spinner />
          <span className="text-sm text-slate-500">Checking whether this feature is configured…</span>
        </Card>
      ) : !available ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-900">This feature is not configured</p>
              <p className="text-xs text-amber-800 leading-relaxed">
                {capability?.reason ??
                  'No language-model credential is configured on the server.'}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* The question box. */}
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="space-y-3"
        >
          <label htmlFor="corpus-question" className="block text-sm font-semibold text-slate-800">
            Your question
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="corpus-question"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={!available || asking}
              maxLength={500}
              placeholder="Which agencies have the most overdue works?"
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-white
                         placeholder:text-slate-400 focus:outline-none focus:ring-2
                         focus:ring-blue-500/40 focus:border-blue-400 disabled:bg-slate-50
                         disabled:text-slate-400 disabled:cursor-not-allowed"
              aria-describedby="corpus-question-limits"
            />
            <Button type="submit" disabled={!available || asking || question.trim() === ''}>
              {asking ? <Spinner className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              {asking ? 'Translating…' : 'Ask'}
            </Button>
          </div>
          <p id="corpus-question-limits" className="text-[11px] text-slate-500 leading-relaxed">
            Read-only. Results are capped at {capability?.max_rows ?? 500} rows and the statement
            times out after {((capability?.statement_timeout_ms ?? 5000) / 1000).toFixed(0)}s.
            Questions that group by elected representative are refused — accountability in this
            platform attaches to the implementing agency and the district.
            {capability?.model ? ` Model: ${capability.model}.` : ''}
          </p>
        </form>
      </Card>

      {/* Examples. Not decoration — they teach the shape of an answerable question. */}
      {examples.length > 0 && !answer && !failure && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Questions this corpus can answer</h2>
          </div>
          <ul className="space-y-2">
            {examples.map((ex) => (
              <li key={ex.question}>
                <button
                  type="button"
                  disabled={!available || asking}
                  onClick={() => {
                    setQuestion(ex.question);
                    ask(ex.question);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl border border-slate-200
                             hover:border-blue-300 hover:bg-blue-50/40 transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="block text-sm text-slate-800">{ex.question}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">{ex.why}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* A refusal, rendered in full. The officer needs the reason and the SQL. */}
      {failure && (
        <Card className="border-rose-200 bg-rose-50/30">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-2 min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-900">
                {failure.code === 'UNSAFE_QUERY'
                  ? 'The generated query was refused'
                  : failure.code === 'QUERY_FAILED'
                    ? 'The generated query did not run'
                    : 'The question could not be answered'}
              </p>
              <p className="text-xs text-rose-800 leading-relaxed">{failure.message}</p>
              {failure.sql && (
                <div>
                  <p className="text-[11px] font-semibold text-rose-900 mb-1">
                    SQL the model produced
                  </p>
                  <pre className="text-[11px] font-mono bg-white border border-rose-200 rounded-lg
                                  p-3 overflow-x-auto text-slate-800 whitespace-pre-wrap break-words">
                    {failure.sql}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* The answer: SQL first, then rows. */}
      {answer && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">SQL that produced this answer</h2>
            </div>
            <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg
                            p-3 overflow-x-auto text-slate-800 whitespace-pre-wrap break-words">
              {answer.sql_generated}
            </pre>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <TableIcon className="w-3.5 h-3.5" />
                {answer.relations.join(', ')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {answer.latency_ms.model}ms model · {answer.latency_ms.database}ms database
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {answer.audit_seq !== null
                  ? `Recorded in the audit ledger at #${answer.audit_seq}`
                  : 'Not recorded in the audit ledger'}
              </span>
            </div>

            {/* The row cap wraps every query, so the executed text differs from the
                generated text. Showing both keeps the claim above honest. */}
            <details className="mt-3">
              <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700">
                SQL as executed, with the row cap applied
              </summary>
              <pre className="mt-2 text-[11px] font-mono bg-slate-50 border border-slate-200
                              rounded-lg p-3 overflow-x-auto text-slate-700 whitespace-pre-wrap break-words">
                {answer.sql_executed}
              </pre>
            </details>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {answer.row_count === 0
                  ? 'No rows matched'
                  : `${answer.row_count.toLocaleString('en-IN')} ${answer.row_count === 1 ? 'row' : 'rows'}`}
              </h2>
              {answer.truncated && (
                <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-50
                                 text-amber-800 border border-amber-200">
                  Capped — this is a partial answer
                </span>
              )}
            </div>

            {answer.row_count === 0 ? (
              <p className="text-sm text-slate-500">
                The query ran and returned nothing. That is an answer: no record in the corpus
                satisfies these conditions.
              </p>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {answer.columns.map((col) => (
                        <th
                          key={col}
                          scope="col"
                          className="text-left px-3 py-2 font-semibold text-slate-700 whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {answer.rows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        {answer.columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                            {cell(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
