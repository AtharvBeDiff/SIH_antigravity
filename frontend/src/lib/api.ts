/**
 * Type-safe API client mapping to the Express 5 backend routers.
 */

import type {
  AgencyPerformanceReport,
  InspectionCoverage,
  ReservationCompliance,
  SLAStats,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  // We attach a mock actor token for demo purposes. 
  // In a real app, this would be a Supabase JWT.
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('x-actor', localStorage.getItem('mock_actor') || 'officer_1');

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
  }
};
