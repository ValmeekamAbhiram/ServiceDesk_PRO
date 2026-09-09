/**
 * ServiceDesk Pro — HTTP response helpers.
 *
 * Controllers never hand-build an envelope. Every success path goes through one
 * of these, which is what keeps the shape identical across every endpoint and
 * guarantees `requestId` is echoed back — so a user reporting a bug can quote an
 * id that appears verbatim in the server log.
 *
 * Failures are not handled here. Throw an `AppError` and let
 * `middleware/error.ts` format it; that is the only place an error envelope is
 * built.
 */

import type { Response } from 'express';
import type { ApiSuccess, PageMeta, Paginated } from '@shared/types';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Set by `middleware/request-id.ts`, which runs first on every request. The
 * fallback exists only so a unit test can call these helpers with a bare mock
 * response instead of a full middleware chain.
 */
export function requestIdOf(res: Response): string {
  const id = res.locals?.requestId;
  return typeof id === 'string' && id.length > 0 ? id : 'unknown';
}

/* ──────────────────────────────── success ──────────────────────────────── */

function envelope<T>(res: Response, data: T): ApiSuccess<T> {
  return { success: true, data, requestId: requestIdOf(res) };
}

export function ok<T>(res: Response, data: T): Response {
  return res.status(200).json(envelope(res, data));
}

/**
 * 201 for a newly created resource. Pass `location` to emit a `Location` header
 * pointing at the canonical URL of the new record.
 */
export function created<T>(res: Response, data: T, location?: string): Response {
  if (location) res.setHeader('Location', location);
  return res.status(201).json(envelope(res, data));
}

export function noContent(res: Response): Response {
  return res.status(204).end();
}

/** A list plus its page metadata, in the same `{ success, data }` envelope. */
export function paginated<T>(res: Response, page: Paginated<T>): Response {
  return res.status(200).json(envelope(res, page));
}

/* ─────────────────────────────── pagination ────────────────────────────── */

export function buildPageMeta(page: number, limit: number, total: number): PageMeta {
  const safeLimit = Math.max(1, limit);
  const totalPages = total === 0 ? 0 : Math.ceil(total / safeLimit);
  return { page, limit: safeLimit, total, totalPages, hasNext: page < totalPages };
}

export function toPaginated<T>(
  items: T[],
  page: number,
  limit: number,
  total: number
): Paginated<T> {
  return { items, meta: buildPageMeta(page, limit, total) };
}

export interface Paging {
  page: number;
  limit: number;
  /** Documents to skip — ready to hand to `Query.skip()`. */
  skip: number;
}

/**
 * Clamp caller-supplied paging into something a Mongo query can safely use. A
 * hostile `?limit=1000000` becomes `MAX_PAGE_SIZE`, never an unbounded collection
 * scan, and a non-numeric or negative page becomes 1.
 */
export function resolvePaging(input: { page?: unknown; limit?: unknown } = {}): Paging {
  const rawPage = Number(input.page);
  const rawLimit = Number(input.limit);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Escape hatch for the one endpoint that legitimately returns something other
 * than the JSON envelope: an attachment download. Kept here so the exception is
 * greppable and obviously deliberate rather than scattered through controllers.
 *
 * `filename` is scrubbed before it reaches the header — it originates as
 * `Attachment.originalName`, which is client-supplied, and a newline in a header
 * value is a response-splitting bug.
 */
export function raw(
  res: Response,
  body: Buffer | string,
  contentType: string,
  options: { filename?: string; cacheSeconds?: number; inline?: boolean } = {}
): Response {
  res.setHeader('Content-Type', contentType);
  if (options.filename) {
    const disposition = options.inline ? 'inline' : 'attachment';
    const safe = options.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'download';
    res.setHeader('Content-Disposition', `${disposition}; filename="${safe}"`);
  }
  res.setHeader(
    'Cache-Control',
    options.cacheSeconds ? `private, max-age=${options.cacheSeconds}` : 'no-store'
  );
  return res.status(200).send(body);
}
