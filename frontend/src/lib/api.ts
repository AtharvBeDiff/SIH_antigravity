/**
 * Type-safe API client mapping to the Express 5 backend routers.
 */

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
    stats: () => request<any>('/sla/stats'),
    evaluate: () => request<any>('/sla/evaluate', { method: 'POST', body: '{}' }),
  },
  quota: {
    get: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<any>(`/quota${q}`);
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
  }
};
