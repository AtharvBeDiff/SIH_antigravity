import React, { useCallback, useEffect, useState } from 'react';
import { PageHeader, Card, SeverityChip, Spinner } from '../components/ui';
import { AlertTriangle, CheckCircle2, History, Search, Upload, UploadCloud } from 'lucide-react';

/** One alert standing against a work in the batch just uploaded. */
interface IngestFinding {
  esakshi_work_id: string;
  rule_id: string;
  severity: string;
  status: string;
  evidence_text: string;
}

/** An INGEST_ATTEMPT row from the audit chain, as `GET /api/ingest/history` returns it. */
interface IngestAuditEvent {
  id: string;
  created_at: string;
  this_hash?: string | null;
  payload?: {
    works_loaded?: number;
    payments_loaded?: number;
    payments_rejected?: number;
    legacy_installment_rows_ignored?: number;
    works_without_recommendation_date?: number;
    unrecognised_statuses?: number;
    alerts_generated?: number;
  };
}

/**
 * Timestamp for one audit-chain entry, to the minute.
 *
 * `formatDate` in lib/utils renders the day only, which would label two ingests
 * on the same day identically — unhelpful in an append-only log whose whole point
 * is the order things happened in. An unparseable value is stated as unparseable
 * rather than rendered as "Invalid Date".
 */
function formatAuditTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'timestamp unreadable';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export function IngestPage() {
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  /** Entries the ingest could not write, verbatim from the response. */
  const [rejected, setRejected] = useState<string[]>([]);
  /** Works that arrived with no recommendation date, so no SLA clock. */
  const [undatedCount, setUndatedCount] = useState(0);
  /** Rows whose `status` was outside the enum, verbatim from the response. */
  const [badStatuses, setBadStatuses] = useState<string[]>([]);
  /**
   * What the rules found on the rows just uploaded.
   *
   * `null` before the first upload, `[]` after an upload that raised nothing —
   * the two read very differently to an operator and are not collapsed.
   */
  const [findings, setFindings] = useState<IngestFinding[] | null>(null);
  /** Works in the batch, for "N of M" — a denominator the findings alone don't give. */
  const [batchSize, setBatchSize] = useState(0);
  /** null while the audit chain is still being read; [] means no ingest is on record. */
  const [history, setHistory] = useState<IngestAuditEvent[] | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/ingest/history');
      const json = await res.json();
      setHistory(Array.isArray(json?.data) ? json.data : []);
    } catch (err) {
      // An unreachable audit chain is reported as empty rather than as a fixed
      // row, which is what the placeholder used to do on every render.
      console.error('Failed to load ingest history:', err);
      setHistory([]);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setSuccessMsg(null);
      setRejected([]);
      setUndatedCount(0);
      setBadStatuses([]);
      setFindings(null);
      setBatchSize(0);
      const text = await file.text();
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Ingestion failed');

      // This read `json.data.count || 200`, so an upload that loaded nothing
      // reported "200 works successfully parsed" — the file's own row count
      // replaced by a number from the demo corpus. The response carries the real
      // count; a zero is reported as a zero.
      const d = json.data ?? {};
      const parts = [`${d.count ?? 0} work(s) loaded`, `${d.payments_written ?? 0} stage payment(s) written`];
      if (d.legacy_installment_rows_ignored > 0) {
        parts.push(`${d.legacy_installment_rows_ignored} row(s) carried the retired installment columns and were ignored`);
      }
      setSuccessMsg(`Ingest recorded in the audit chain: ${parts.join(', ')}.`);
      setRejected(Array.isArray(d.payments_rejected) ? d.payments_rejected : []);
      setUndatedCount(d.works_without_recommendation_date ?? 0);
      setBadStatuses(Array.isArray(d.unrecognised_statuses) ? d.unrecognised_statuses : []);
      setFindings(Array.isArray(d.findings) ? d.findings : []);
      setBatchSize(d.count ?? 0);
      await loadHistory();
    } catch (err: any) {
      console.error('Ingest error:', err);
      alert('Ingestion error: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="e-SAKSHI Data Ingestion & Validation Hub"
        description="Upload a work export as CSV. The 22-column layout DRISHTI reads is documented in docs/DATA_CONTRACT.md; four columns are required and the rest are optional."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 space-y-5">
          <h3 className="text-base font-semibold text-slate-900">Upload New e-SAKSHI Export</h3>

          <div className="border-2 border-dashed border-slate-200/80 hover:border-secondary/50 rounded-xl p-8 text-center space-y-3 transition-colors bg-slate-50/30 cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">Drag & drop your e-SAKSHI CSV file here</p>
              {/*
                This said ".csv, .xlsx". The handler sends `file.text()` as a JSON
                string, so a workbook would arrive as binary and fail parsing —
                the format was advertised but never supported.
              */}
              <p className="text-xs text-slate-500 mt-0.5">CSV only (.csv). Required headers: work_id, district_lgd, constituency_code, work_title</p>
            </div>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv"
              className="hidden"
              disabled={uploading}
              onChange={handleFileChange}
            />
            <label
              htmlFor="csv-file-input"
              className="inline-flex items-center justify-center gap-2 font-medium px-4 py-2 text-sm rounded-xl transition-all duration-200 cursor-pointer select-none border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 bg-white shadow-xs"
            >
              {uploading ? <Spinner className="w-4 h-4" /> : <Upload className="w-4 h-4 text-slate-500" />}
              <span>{uploading ? 'Validating Schema...' : 'Select File from Computer'}</span>
            </label>
          </div>

          {successMsg && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/*
            Rejected entries are shown, not counted away. A payment that vanished
            on the way in leaves its work looking unfunded, and R-014 would then
            report that absence as a finding — a fabricated one.
          */}
          {rejected.length > 0 && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{rejected.length} payment entr{rejected.length === 1 ? 'y' : 'ies'} could not be written</span>
              </div>
              <ul className="space-y-1 font-mono text-[11px] max-h-40 overflow-y-auto">
                {rejected.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <p className="text-[11px]">
                The works themselves loaded. These stage payments did not, so the affected
                works have an incomplete fund-flow history until the file is corrected.
              </p>
            </div>
          )}

          {/*
            Two data-quality outcomes that used to be invisible because the ingest
            papered over them. Neither blocks the upload; both change what the
            platform can measure afterwards, so they are stated at the point the
            file lands rather than left to be inferred from an empty screen.
          */}
          {undatedCount > 0 && (
            <div className="p-4 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="font-medium">
                {undatedCount} work(s) arrived without a recommendation date
              </div>
              <p>
                The ingest used to substitute the sanction date here, which made the
                recommendation-to-sanction lag exactly zero and the 45-day SLA unmeasurable —
                no row could breach a limit it was recorded as having met on day zero. The
                value is now left unknown, so these works are excluded from the SLA rather
                than counted as compliant. Supply <code>recommended_date</code> to measure them.
              </p>
            </div>
          )}

          {badStatuses.length > 0 && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{badStatuses.length} row(s) carried an unrecognised status</span>
              </div>
              <ul className="space-y-1 font-mono text-[11px] max-h-40 overflow-y-auto">
                {badStatuses.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              <p className="text-[11px]">
                Valid values are NOT_STARTED, IN_PROGRESS, COMPLETED, ON_HOLD and CANCELLED.
                An unrecognised status is recorded as NOT_STARTED — it is not written verbatim,
                because a status no query matches makes a work invisible to every
                status-filtered rule rather than obviously wrong.
              </p>
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600" />
            <span>Ingest Audit Log</span>
          </h3>
          {/*
            This card previously rendered a fixed row — "Batch #2026-08", "200 Works",
            "Checksum: 36d0921c…" — that was in the JSX, not in the database. It did
            not change after an ingest and did not correspond to one. On a platform
            whose claim is an append-only audit chain, a hand-written audit entry is
            the worst possible placeholder, so it now reads the chain or says it is
            empty.
          */}
          <div className="space-y-3 text-xs">
            {history === null ? (
              <p className="text-slate-500 py-4 text-center">Loading ingest history…</p>
            ) : history.length === 0 ? (
              <p className="text-slate-500 py-4 text-center">
                No ingest has been recorded in the audit chain yet.
              </p>
            ) : (
              history.map((h) => {
                const p = h.payload ?? {};
                return (
                  <div key={h.id} className="p-3 rounded-lg bg-slate-50 border border-white/5 space-y-1">
                    <div className="flex justify-between font-medium">
                      <span className="text-slate-900">{formatAuditTimestamp(h.created_at)}</span>
                      <span className="text-emerald-500">{p.works_loaded ?? 0} works</span>
                    </div>
                    <p className="text-slate-500">
                      {p.payments_loaded ?? 0} stage payment(s)
                      {/*
                        Every field on `payload` is optional — the ingest writes a counter only
                        when it has one — so each comparison coalesces first, in the same `?? 0`
                        idiom the two lines around it use. Written as a bare `p.x > 0` these
                        compiled under TypeScript 5.9 and failed under the `~6.0.2` this package
                        actually asks for (TS18048), which is why the deploy build broke while
                        the local one passed. The rendered output is unchanged: `undefined > 0`
                        and `0 > 0` were both already false.
                      */}
                      {(p.payments_rejected ?? 0) > 0 && `, ${p.payments_rejected} rejected`}
                      {(p.legacy_installment_rows_ignored ?? 0) > 0 && `, ${p.legacy_installment_rows_ignored} legacy row(s) ignored`}
                      {(p.works_without_recommendation_date ?? 0) > 0 && `, ${p.works_without_recommendation_date} without a recommendation date`}
                      {(p.unrecognised_statuses ?? 0) > 0 && `, ${p.unrecognised_statuses} unrecognised status(es)`}
                    </p>
                    <p className="text-slate-500">Alerts after analysis: {p.alerts_generated ?? '—'}</p>
                    {/* The chain hash, as stored. Not a decorative string. */}
                    <p className="text-[10px] text-slate-400 font-mono truncate">
                      {h.this_hash ? `chain: ${h.this_hash}` : 'chain hash not recorded'}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {/*
        What the rules found on the rows just uploaded.

        The response already carried a corpus-wide `analysis` summary, and on a
        loaded corpus that answers a question the operator did not ask: upload 14
        works, get told 2,214 were analysed and 1,647 alerts are in the backlog.
        Worse, the alert budget caps each district at ten OPEN, and the existing
        corpus has already filled it — so every finding on a freshly uploaded row
        goes to BACKLOG and never appears on the triage queue. The file looked
        accepted and nothing looked to have come of it.

        This panel is the answer scoped to the batch, which is the only scope the
        person who uploaded it can act on.
      */}
      {findings !== null && (
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Search className="w-4 h-4 text-blue-600" />
              <span>What the rules found in this upload</span>
            </h3>
            {findings.length > 0 && (
              <p className="text-xs text-slate-500">
                {findings.length} finding{findings.length === 1 ? '' : 's'} across{' '}
                {new Set(findings.map((f) => f.rule_id)).size} rule
                {new Set(findings.map((f) => f.rule_id)).size === 1 ? '' : 's'}, on{' '}
                {new Set(findings.map((f) => f.esakshi_work_id)).size} of the {batchSize} work
                {batchSize === 1 ? '' : 's'} uploaded
              </p>
            )}
          </div>

          {findings.length === 0 ? (
            /*
              Stated as a result, not as an empty state. No rule fired on these
              rows — which is a finding of its own and is not the same as the
              analysis having failed to run.
            */
            <p className="text-xs text-slate-600 py-2">
              No rule fired on any work in this upload. The analysis ran over the whole corpus
              and raised nothing against these rows.
            </p>
          ) : (
            <>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">e-SAKSHI ID</th>
                      <th className="text-left font-medium px-3 py-2">Rule</th>
                      <th className="text-left font-medium px-3 py-2">Severity</th>
                      <th className="text-left font-medium px-3 py-2">Queue</th>
                      <th className="text-left font-medium px-3 py-2">
                        Evidence — the two values compared
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/*
                      Ordered by the backend, severity first, so the row a judge
                      reads at the top is the worst thing in the file. Keyed on
                      work+rule+index: one work can hold several findings and the
                      same rule fires on several works, so neither alone is unique.
                    */}
                    {findings.map((f, i) => (
                      <tr key={`${f.esakshi_work_id}:${f.rule_id}:${i}`} className="align-top">
                        <td className="px-3 py-2 font-mono text-slate-900 whitespace-nowrap">
                          {f.esakshi_work_id || '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                          {f.rule_id}
                        </td>
                        <td className="px-3 py-2">
                          <SeverityChip severity={f.severity} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {/*
                            The alert's own status, not the work's — `StatusBadge`
                            reads work statuses and would render BACKLOG through
                            its unknown-value branch, in the same red it uses for
                            CANCELLED.
                          */}
                          <span
                            className={
                              f.status === 'OPEN'
                                ? 'inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200'
                            }
                          >
                            {f.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{f.evidence_text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/*
                The budget is explained rather than removed. It exists so a bad
                day upstream cannot bury the triage queue, and an operator who
                sees BACKLOG beside a critical finding is owed the reason.
              */}
              {findings.some((f) => f.status === 'BACKLOG') && (
                <p className="text-[11px] text-slate-500">
                  <span className="font-medium text-slate-700">On the queue column:</span> each
                  district is capped at 10 OPEN alerts at a time, ranked by severity, so a
                  reviewer is handed a day's work rather than a wall. Findings past the cap sit in
                  BACKLOG — raised, evidenced and on the record, waiting for a slot. They are not
                  dismissed and they are not lost.
                </p>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
