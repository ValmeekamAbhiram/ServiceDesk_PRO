/**
 * ServiceDesk Pro — pure helpers shared by the server and the client.
 *
 * Everything in here must stay dependency-free and side-effect-free: it is
 * imported by the pure SLA engine (which is unit-tested without Mongo or HTTP)
 * and by React render paths.
 */

/* No enum imports: these helpers must stay usable by the pure SLA engine. */

/**
 * Deterministic avatar palette. Kept here rather than in `labels.ts` so this
 * module has no imports at all — see the header.
 */
const AVATAR_COLORS = [
  '#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c',
  '#4f46e5', '#0891b2', '#16a34a', '#c026d3', '#d97706',
];

/* ─────────────────────────────── Identity ───────────────────────────────── */

/** `"Rahul Sharma"` -> `"RS"`; falls back to the first two letters. */
export function initialsOf(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable 32-bit FNV-1a hash — used for deterministic colour/vector bucketing. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic avatar colour so the same user always looks the same. */
export function avatarColorFor(seed: string): string {
  return AVATAR_COLORS[hash32(seed) % AVATAR_COLORS.length];
}

export function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

/* ───────────────────────────── Numbering ────────────────────────────────── */

/** `1042` -> `TKT-001042`. */
export function formatSequence(prefix: string, seq: number, width = 6): string {
  return `${prefix}-${String(seq).padStart(width, '0')}`;
}

export function parseSequence(code: string): { prefix: string; seq: number } | null {
  const m = /^([A-Z]{2,4})-(\d+)$/.exec(String(code || '').trim().toUpperCase());
  if (!m) return null;
  return { prefix: m[1], seq: Number(m[2]) };
}

/* ─────────────────────────── Time formatting ────────────────────────────── */

/** 254 -> `"4h 14m"`; 0 -> `"0m"`; negatives keep the sign. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(Math.round(minutes));
  const days = Math.floor(total / (60 * 24));
  const hours = Math.floor((total % (60 * 24)) / 60);
  const mins = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return sign + parts.join(' ');
}

/** Seconds -> `"03:42:19"` (or `"1d 03:42:19"` beyond a day). */
export function formatCountdown(totalSeconds: number): string {
  const negative = totalSeconds < 0;
  const s = Math.abs(Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const core = days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  return negative ? `-${core}` : core;
}

/** Minutes from local midnight -> `"09:00"`. */
export function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `"09:30"` -> 570. Throws on malformed input so config errors surface early. */
export function parseMinuteOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) throw new Error(`Invalid time-of-day "${hhmm}" (expected HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) {
    throw new Error(`Time-of-day out of range: "${hhmm}"`);
  }
  return h * 60 + min;
}

export function relativeTime(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.round((nowMs - then) / 1000);
  const future = diff < 0;
  const s = Math.abs(diff);
  const pick = (value: number, unit: string): string => {
    const rounded = Math.round(value);
    const label = `${rounded} ${unit}${rounded === 1 ? '' : 's'}`;
    return future ? `in ${label}` : `${label} ago`;
  };
  if (s < 45) return future ? 'in a moment' : 'just now';
  if (s < 3600) return pick(s / 60, 'minute');
  if (s < 86400) return pick(s / 3600, 'hour');
  if (s < 86400 * 30) return pick(s / 86400, 'day');
  if (s < 86400 * 365) return pick(s / (86400 * 30), 'month');
  return pick(s / (86400 * 365), 'year');
}

/* ─────────────────────────────── Currency ───────────────────────────────── */

export function formatCurrency(
  amount: number | null | undefined,
  currency = 'INR',
  locale = 'en-IN'
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, locale = 'en-IN'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale).format(value);
}

/* ─────────────────────────────── Text ──────────────────────────────────── */

export function truncate(input: string, max = 140): string {
  const s = String(input ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Strips markdown decorations for previews and email plain-text parts. */
export function stripMarkdown(input: string): string {
  return String(input ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>*-]\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/* ─────────────────────────────── Numbers ───────────────────────────────── */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function percent(part: number, whole: number, digits = 1): number {
  if (!whole) return 0;
  return round((part / whole) * 100, digits);
}

export function safeDivide(a: number, b: number, fallback = 0): number {
  return b === 0 ? fallback : a / b;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

export function average(values: number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

/* ─────────────────────────────── Arrays ────────────────────────────────── */

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function groupBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = keyOf(item);
    (out[k] ||= []).push(item);
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ────────────────────────── Dates (UTC-safe) ───────────────────────────── */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MINUTE_MS;
}

export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function toIso(d: Date | null | undefined): string | null {
  return isValidDate(d) ? d.toISOString() : null;
}

/** Years between two instants, one decimal — used for asset age. */
export function ageInYears(from: Date, to: Date): number {
  return round(daysBetween(from, to) / 365.25, 1);
}
