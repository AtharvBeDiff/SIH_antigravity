/**
 * Type-safe API client mapping to the Express 5 backend routers.
 */

import type {
  AgencyPerformanceReport,
  Document,
  DocumentAiStatus,
  DocumentBundle,
  DocumentCheck,
  DocumentExtraction,
  DocumentFinding,
  DuplicateCheckCapability,
  DuplicateCheckResult,
  InspectionCheck,
  InspectionComparison,
  InspectionCoverage,
  InspectionEvidenceBundle,
  InspectionEvidenceStatus,
  InspectionFinding,
  PhotoAiStatus,
  PhotoAnalysis,
  PhotoBundle,
  PhotoCheck,
  PhotoFinding,
  ReservationCompliance,
  SLAStats,
  WorkPhoto,
} from '../types';

/**
 * Same-origin, and deliberately not configurable.
 *
 * This read `import.meta.env.VITE_API_URL`, which Vite freezes into the bundle at
 * BUILD time. The deployed value pointed at a Railway host that no longer exists,
 * so every page going through this client called a dead server — and because the
 * value is baked in, no amount of restarting fixed it. Meanwhile ten other pages
 * fetch a relative '/api/...' directly and ignored this constant entirely, so the
 * app had two different notions of where the backend was, and one of them was wrong.
 *
 * Both now resolve the same way: a relative '/api' handed to whichever proxy is in
 * front. In production that is the rewrite in `vercel.json`; in development it is
 * the `/api` proxy in `vite.config.ts` pointing at localhost:4000. The backend host
 * is therefore configured in exactly one place per environment, in a file under
 * version control, rather than in a dashboard env var that can silently go stale.
 *
 * `vercel.json` cannot carry this note itself — Vercel validates it strictly and
 * rejects unknown keys, so a JSON comment key fails the deploy — so it goes here:
 * that file's `/api/(.*)` rule must stay ABOVE the SPA catch-all `/(.*)`. Vercel
 * takes the first match, and the catch-all answers everything with `index.html`,
 * which is what made these fetches return HTML for a JSON parser to choke on.
 */
const API_BASE = '/api';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');

  // `x-user-id`, because that is the header `actorOf` in `backend/src/http.ts` reads. This
  // line sent `x-actor` for the whole history of the file, which the backend ignores — so
  // every mutation made through this client landed in the audit ledger attributed to
  // `demo-officer`, the DEMO_MODE fallback, and the officer name in localStorage reached
  // nothing. Silent, because the fallback made it look like it worked.
  //
  // This is attribution, not authentication: the value is whatever the browser says it is,
  // and anyone who can call the API can set it. See `docs/API_CONTRACT.md` §11.
  headers.set('x-user-id', localStorage.getItem('mock_actor') || 'officer_1');

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const error = json?.error;
    throw new ApiError(
      error?.code || 'UNKNOWN_ERROR',
      error?.message || `HTTP ${res.status}`,
      error?.details
    );
  }

  return json?.data as T;
}

export const api = {
  meta: {
    get: () => request<any>('/meta'),
  },
  works: {
    list: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/works${q}`);
    },
    get: (id: string) => request<any>(`/works/${id}`),
    /**
     * Semantic duplicate check — P-03. Two things worth knowing at the call site:
     *
     * `duplicateStatus` always answers 200, even with no credential — `available: false` carries
     * a `reason` to show. Ask it before rendering the run control, the same discipline as the
     * document and photo status calls.
     *
     * `duplicateCheck` raises no alerts: it ranks this work's same-district peers by semantic
     * similarity and returns them inline. `threshold` and `limit` are clamped server-side
     * (0..1 and 1..50), so an out-of-range value is corrected rather than rejected.
     */
    duplicateStatus: () =>
      request<DuplicateCheckCapability>('/works/duplicate-check/status'),
    duplicateCheck: (id: string, body?: { threshold?: number; limit?: number }) =>
      request<DuplicateCheckResult>(`/works/${id}/duplicate-check`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
  },
  alerts: {
    list: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/alerts${q}`);
    },
    get: (id: string) => request<any>(`/alerts/${id}`),
    review: (id: string, action: string, reason_code?: string, note?: string) => 
      request<any>(`/alerts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reason_code, note }),
      }),
  },
  inspections: {
    list: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/inspections${q}`);
    },
    create: (data: any) => request<any>('/inspections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

    // ── Inspection evidence vs the work record (P-10) ──
    //
    // These compare what an inspector recorded in the field against what the work record
    // claims. They raise no alerts and are not scored against the evaluation answer key.

    /**
     * Whether the comparison can run. Always `available: true` — no model, no credential — but
     * read anyway so the panel's pre-render check matches documents and photos.
     */
    status: () => request<InspectionEvidenceStatus>('/inspections/status'),
    /** The I-catalogue, so a finding can name its check and the UI can explain it. */
    checks: () => request<{ checks: InspectionCheck[]; note: string }>('/inspections/checks'),
    /**
     * Every inspection on a work with its current comparison. A null `comparison` means the
     * comparison has not been run, not that the inspection is clean.
     */
    evidenceForWork: (workId: string) =>
      request<InspectionEvidenceBundle[]>(
        `/inspections/for-work/${encodeURIComponent(workId)}`,
      ),
    /**
     * Re-runnable. A second call supersedes the previous comparison rather than overwriting it,
     * so the reading an officer acted on survives.
     *
     * `checks_run` comes back beside `findings` because zero findings out of four checks and
     * zero out of zero look identical and mean opposite things.
     */
    compare: (id: string) =>
      request<{
        comparison: InspectionComparison;
        findings: InspectionFinding[];
        checks_run: string[];
        superseded_comparison_id: string | null;
      }>(`/inspections/${encodeURIComponent(id)}/compare`, { method: 'POST' }),
    /** Open findings across the corpus, most severe first. Separate from the alert queue. */
    openFindings: (limit?: number) =>
      request<InspectionFinding[]>(`/inspections/findings${limit ? `?limit=${limit}` : ''}`),
    /** Records the officer's judgement. Writes nothing back to the work — see the router. */
    acceptFinding: (findingId: string, note?: string) =>
      request<{ finding: InspectionFinding }>(
        `/inspections/findings/${encodeURIComponent(findingId)}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'ACCEPTED', note }) },
      ),
    /** A reason is required — same discipline as documents and photos. */
    dismissFinding: (findingId: string, reason: string) =>
      request<{ finding: InspectionFinding }>(
        `/inspections/findings/${encodeURIComponent(findingId)}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'DISMISSED', reason }) },
      ),
  },
  dashboard: {
    get: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/dashboard${q}`);
    },
    districts: () => request<any>('/dashboard/districts'),
  },
  audit: {
    list: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/audit${q}`);
    },
    verify: () => request<any>('/audit/verify'),
  },
  analyze: {
    run: () => request<any>('/analyze', { method: 'POST', body: '{}' }),
  },
  sla: {
    stats: () => request<SLAStats>('/sla/stats'),
    /**
     * Re-run the sanction-decision SLA engine.
     *
     * `alerts_upserted` counts rows written, which includes alerts that already
     * existed and were recomputed in place — it is not a count of newly discovered
     * breaches. The endpoint previously called this `alertsGenerated`, which read as
     * the latter.
     */
    evaluate: () =>
      request<{ alerts_upserted: number; breached: number; at_risk: number }>(
        '/sla/evaluate',
        { method: 'POST', body: '{}' },
      ),
  },
  quota: {
    /** SC/ST reservation compliance (R-016). */
    get: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<ReservationCompliance>(`/quota${q}`);
    },
    /** Physical inspection coverage against works under implementation (R-017). */
    inspection: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<InspectionCoverage>(`/quota/inspection${q}`);
    },
  },
  agencies: {
    /**
     * Per-agency workload and delivery pacing.
     *
     * Passing `district_id` rebuilds the pacing expectation from that district's own
     * corpus, so the index compares agencies against district medians rather than
     * national ones — a different, and for a district officer more useful, number.
     */
    get: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<AgencyPerformanceReport>(`/agencies${q}`);
    },
  },
  heatmap: {
    get: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/heatmap${q}`);
    },
  },
  healthReports: {
    get: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/health_reports${q}`);
    },
    post: (data: any) => request<any>('/health_reports', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  },
  public: {
    list: (search?: string) => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      return request<any>(`/public/works${q}`);
    },
    get: (id: string) => request<any>(`/public/works/${id}`),
  },
  /**
   * Document AI — P-04. Upload and extraction are two calls on purpose: a combined one
   * would make a good upload fail because the model was rate-limited, and the officer's
   * response to that would be to upload again, producing a duplicate object for a failure
   * that had nothing to do with the file.
   */
  documents: {
    /** Ask before rendering an upload control. `available: false` carries a `reason`. */
    status: () => request<DocumentAiStatus>('/documents/status'),
    /** The D-catalogue, so a finding can name its check and the UI can explain it. */
    checks: () => request<{ checks: DocumentCheck[]; note: string }>('/documents/checks'),
    forWork: (workId: string) =>
      request<DocumentBundle[]>(`/documents?work_id=${encodeURIComponent(workId)}`),
    findings: (limit?: number) =>
      request<DocumentFinding[]>(`/documents/findings${limit ? `?limit=${limit}` : ''}`),
    upload: (data: {
      work_id: string;
      type: string;
      filename: string;
      content_base64: string;
      content_type: string;
    }) =>
      request<{
        document: Document;
        readable_kind: string | null;
        duplicate_of: string[];
      }>('/documents', { method: 'POST', body: JSON.stringify(data) }),
    extract: (id: string) =>
      request<{
        extraction: DocumentExtraction;
        findings: DocumentFinding[];
        checks_run: string[];
        superseded_extraction_id: string | null;
      }>(`/documents/${id}/extract`, { method: 'POST' }),
    /** Signed for five minutes; the evidence bucket is private. */
    url: (id: string) => request<{ url: string; expires_in: number }>(`/documents/${id}/url`),
    accept: (findingId: string, note?: string) =>
      request<{ finding: DocumentFinding; work_updated: Record<string, unknown> | null }>(
        `/documents/findings/${findingId}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'ACCEPTED', note }) },
      ),
    /** A reason is required. See the router: a dismissal with none is unreadable later. */
    dismiss: (findingId: string, reason: string) =>
      request<{ finding: DocumentFinding; work_updated: null }>(
        `/documents/findings/${findingId}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'DISMISSED', reason }) },
      ),
  },

  /**
   * Photo AI — P-06. Upload and analysis are two calls, for the same reason as documents: a
   * model call can fail for reasons unrelated to the file, and a combined endpoint would fail a
   * good upload and push the officer to re-upload a duplicate.
   */
  photos: {
    /** Ask before rendering an upload/analyse control. `available: false` carries a `reason`. */
    status: () => request<PhotoAiStatus>('/photos/status'),
    /** The V-catalogue, so a finding can name its check and the UI can explain it. */
    checks: () => request<{ checks: PhotoCheck[]; note: string }>('/photos/checks'),
    forWork: (workId: string) =>
      request<PhotoBundle[]>(`/photos?work_id=${encodeURIComponent(workId)}`),
    findings: (limit?: number) =>
      request<PhotoFinding[]>(`/photos/findings${limit ? `?limit=${limit}` : ''}`),
    upload: (data: {
      work_id: string;
      caption?: string;
      filename: string;
      content_base64: string;
      content_type: string;
    }) =>
      request<{
        photo: WorkPhoto;
        duplicate_of: string[];
        exif: { latitude: number | null; longitude: number | null; taken_at: string | null };
      }>('/photos', { method: 'POST', body: JSON.stringify(data) }),
    analyze: (id: string) =>
      request<{
        analysis: PhotoAnalysis;
        findings: PhotoFinding[];
        checks_run: string[];
        superseded_analysis_id: string | null;
      }>(`/photos/${id}/analyze`, { method: 'POST' }),
    /** Signed for five minutes; the evidence bucket is private. */
    url: (id: string) => request<{ url: string; expires_in: number }>(`/photos/${id}/url`),
    accept: (findingId: string, note?: string) =>
      request<{ finding: PhotoFinding }>(
        `/photos/findings/${findingId}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'ACCEPTED', note }) },
      ),
    /** A reason is required — same discipline as documents. */
    dismiss: (findingId: string, reason: string) =>
      request<{ finding: PhotoFinding }>(
        `/photos/findings/${findingId}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'DISMISSED', reason }) },
      ),
  },
};
