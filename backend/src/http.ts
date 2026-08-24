/**
 * MPLADS Platform — HTTP Request Helpers
 *
 * Used in Express route handlers for query parsing,
 * body validation, and error creation.
 * Express 5 auto-forwards async rejections — throw ApiError,
 * don't build error responses in handlers.
 */

import type { Request } from 'express';
import type { PagingParams } from './types.ts';

// ─── API Error ───────────────────────────────────────────────

export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// ─── Query param extractors ──────────────────────────────────

/** Extract string query param, or undefined. */
export function qstr(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' ? v : undefined;
}

/** Extract numeric query param, or undefined. */
export function qnum(req: Request, key: string): number | undefined {
  const v = req.query[key];
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Extract boolean query param (true/false/1/0), or undefined. */
export function qbool(req: Request, key: string): boolean | undefined {
  const v = req.query[key];
  if (typeof v !== 'string') return undefined;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

// ─── Paging ──────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function paging(req: Request): PagingParams {
  const page = Math.max(1, qnum(req, 'page') ?? 1);
  const raw = qnum(req, 'page_size') ?? DEFAULT_PAGE_SIZE;
  const page_size = Math.min(MAX_PAGE_SIZE, Math.max(1, raw));
  return { page, page_size };
}

// ─── Actor extraction ────────────────────────────────────────

/**
 * Extracts the acting user's ID from the request.
 * In DEMO_MODE, falls back to 'demo-officer'.
 */
export function actorOf(req: Request): string {
  // Check for Supabase JWT user info
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    // In production, decode JWT and extract user ID
    // For now, use a header-based approach
  }
  // Check custom header (set by auth middleware)
  const userId = req.headers['x-user-id'];
  if (typeof userId === 'string' && userId) return userId;

  // Demo mode fallback
  if (process.env['DEMO_MODE'] === 'true') return 'demo-officer';

  throw new ApiError(401, 'UNAUTHORIZED', 'No authenticated user');
}

// ─── Body validation ─────────────────────────────────────────

/** Require a JSON body to be present. */
export function requireBody(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object') {
    throw new ApiError(400, 'MISSING_BODY', 'Request body is required');
  }
  return req.body as Record<string, unknown>;
}

/** Require a specific string field from the body. */
export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const v = body[field];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ApiError(400, 'MISSING_FIELD', `'${field}' is required and must be a non-empty string`);
  }
  return v.trim();
}

/** Require a field value to be one of the allowed values. */
export function requireOneOf<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const v = requireString(body, field);
  if (!allowed.includes(v as T)) {
    throw new ApiError(400, 'INVALID_VALUE', `'${field}' must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

// ─── Guards ──────────────────────────────────────────────────

/** Throw 404 if value is null. */
export function notFound(value: unknown, entity: string, id: string): asserts value {
  if (value === null || value === undefined) {
    throw new ApiError(404, 'NOT_FOUND', `${entity} '${id}' not found`);
  }
}

/** Require DEMO_MODE to be true. */
export function requireDemoMode(): void {
  if (process.env['DEMO_MODE'] !== 'true') {
    throw new ApiError(403, 'NOT_DEMO', 'This endpoint is only available in demo mode');
  }
}
