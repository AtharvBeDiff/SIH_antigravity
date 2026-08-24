/**
 * MPLADS Platform — Utility Library
 *
 * Pure functions used across the platform. No side effects,
 * no database access. Deterministic where noted.
 *
 * Math.random() is BANNED — use makeRng(seed).
 */

import { createHash } from 'node:crypto';

// ─── Hashing & IDs ──────────────────────────────────────────

/** Deterministic JSON serialisation (sorted keys, no spaces). */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (value as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return value;
  });
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Stable deterministic ID from content — same input always
 * produces the same ID. Used for alert origin_id dedup.
 */
export function stableId(...parts: (string | number)[]): string {
  return sha256(parts.join('|')).slice(0, 24);
}

/** Random ID (not deterministic — use for new entities). */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Seeded RNG (Math.random is BANNED) ─────────────────────

/**
 * Mulberry32 — fast 32-bit PRNG. Deterministic: same seed → same sequence.
 */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Date / Time helpers ─────────────────────────────────────

/** ISO-8601 UTC timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD from a Date or ISO string. */
export function toDateStr(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/** Days between two YYYY-MM-DD strings. Positive if b > a. */
export function daysBetween(a: string, b: string): number {
  const msA = new Date(a + 'T00:00:00Z').getTime();
  const msB = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((msB - msA) / 86_400_000);
}

/** Approximate months between two YYYY-MM-DD strings. */
export function monthsBetween(a: string, b: string): number {
  const dtA = new Date(a + 'T00:00:00Z');
  const dtB = new Date(b + 'T00:00:00Z');
  return (dtB.getUTCFullYear() - dtA.getUTCFullYear()) * 12 + (dtB.getUTCMonth() - dtA.getUTCMonth());
}

/** Add N days to a YYYY-MM-DD string. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

/** YYYY-MM from a YYYY-MM-DD string. */
export function toMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

// ─── Money formatting ────────────────────────────────────────

/** Format rupees: ₹12,34,567 (Indian grouping). */
export function fmtINR(rupees: number): string {
  if (rupees < 0) return '-' + fmtINR(-rupees);
  const str = Math.round(rupees).toString();
  if (str.length <= 3) return '₹' + str;
  const last3 = str.slice(-3);
  const rest = str.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return '₹' + grouped + ',' + last3;
}

// ─── Geo ─────────────────────────────────────────────────────

/** Haversine distance in metres between two lat/lng points. */
export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Statistics ──────────────────────────────────────────────

/** Median of a sorted-or-unsorted numeric array. */
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Percentile (0–100) of a numeric array. */
export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Median Absolute Deviation. */
export function mad(arr: number[]): number {
  const med = median(arr);
  return median(arr.map(x => Math.abs(x - med)));
}

/**
 * Robust z-score using MAD (not IsolationForest).
 * "3.4× the district median for this category" is followable by an officer.
 */
export function robustZ(value: number, med: number, madValue: number): number {
  if (madValue === 0) return 0;
  return 0.6745 * (value - med) / madValue;
}

// ─── Text Similarity ─────────────────────────────────────────

/** Tokenize: lowercase, strip punctuation, split on whitespace. */
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)
  );
}

/** Token-set similarity ratio (0–1). */
export function tokenSetRatio(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  // Dice coefficient (2*|A∩B| / (|A|+|B|))
  return (2 * intersection) / (setA.size + setB.size);
}

/** Jaccard similarity (|A∩B| / |A∪B|). */
export function jaccard(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  const union = new Set([...setA, ...setB]);
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / union.size;
}

/** Hamming distance between two hex strings (perceptual hash comparison). */
export function hexHamming(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`Hex strings must be same length: ${a.length} vs ${b.length}`);
  }
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const nibbleA = parseInt(a[i]!, 16);
    const nibbleB = parseInt(b[i]!, 16);
    let xor = nibbleA ^ nibbleB;
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

// ─── Template rendering ─────────────────────────────────────

/**
 * Simple mustache-style template: "Cost is {{ratio}}× the median"
 * with vars = { ratio: 3.4 } → "Cost is 3.4× the median"
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return key in vars ? String(vars[key]) : `{{${key}}}`;
  });
}

// ─── Object helpers ──────────────────────────────────────────

/** Pick named keys from an object. */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const k of keys) {
    if (k in obj) result[k] = obj[k];
  }
  return result;
}

/** Random integer in [min, max] inclusive, using a seeded RNG. */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Pick a random element from an array, using a seeded RNG. */
export function randPick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Shuffle an array in place using Fisher-Yates + seeded RNG. */
export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Round to N decimal places. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
