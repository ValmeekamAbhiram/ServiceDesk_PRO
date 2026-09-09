/**
 * ServiceDesk Pro — shared Zod fields.
 *
 * Query strings are the awkward half of request validation: everything arrives as a
 * string, arrays arrive as either `?status=A,B` or `?status=A&status=B` depending on
 * the client, and `?breached=false` is a *truthy* string. The helpers here settle
 * each of those once, so no route has to remember.
 *
 * The rule they all follow: coerce at the boundary, and let the service receive real
 * types. A service that has to wonder whether `page` is a number or the string "2"
 * is a service that will eventually get it wrong.
 */

import { Types } from 'mongoose';
import { z } from 'zod';

/**
 * A 24-character hex id. Validated here rather than left to Mongoose because a
 * malformed id should be a 400 naming the field, not a `CastError` that
 * `toAppError` has to rescue into a vague 404.
 */
export const objectIdField = z
  .string()
  .trim()
  .refine((value) => Types.ObjectId.isValid(value) && /^[0-9a-fA-F]{24}$/.test(value), {
    message: 'Not a valid id.',
  });

/** `{ params: { id } }` — by far the most common route shape. */
export const idParams = { params: z.object({ id: objectIdField }) };

/** Trimmed, length-bounded free text. `max` is enforced to match the schema field. */
export function textField(min: number, max: number, message?: string) {
  return z.string().trim().min(min, message).max(max);
}

/** Optional text where an empty string means "clear this field", not "unchanged". */
export function nullableTextField(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();
}

/**
 * `?flag=true` / `1` / `yes` → true; `false` / `0` / `no` / absent → false. Written
 * out rather than using `z.coerce.boolean()`, which returns `true` for the string
 * `"false"` and is a reliable source of inverted filters.
 */
export const queryBoolean = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes')
  .optional();

export const queryPage = z.coerce.number().int().min(1).max(10_000).optional();
export const queryLimit = z.coerce.number().int().min(1).max(100).optional();

/**
 * A repeatable enum filter, accepting both `?status=OPEN,IN_PROGRESS` and
 * `?status=OPEN&status=IN_PROGRESS` — Express produces a string for the first and an
 * array for the second, and clients differ on which they send.
 *
 * Unknown members are rejected rather than dropped: silently ignoring
 * `?status=DONE` would return every ticket, which looks like a filter that works.
 */
export function queryEnumList<T extends string>(values: readonly [T, ...T[]]) {
  const member = z.enum(values);
  return z
    .preprocess((raw) => {
      if (raw === undefined || raw === null || raw === '') return undefined;
      const parts = Array.isArray(raw) ? raw : [raw];
      return parts
        .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
        .map((part) => (typeof part === 'string' ? part.trim() : part))
        .filter((part) => part !== '');
    }, z.array(member).min(1).max(values.length))
    .optional();
}

/**
 * An ISO date bound for a range filter. Rejects unparseable input up front so an
 * `Invalid Date` never reaches a Mongo query, where it silently matches nothing.
 */
export const queryDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Not a valid date.' })
  .transform((value) => new Date(value))
  .optional();

/**
 * Free-text search. Capped and trimmed; an empty or whitespace-only `q` becomes
 * `undefined` so `?q=` behaves as "no search" rather than as a text query for
 * nothing.
 */
export const querySearch = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

/** Sort direction, defaulted at the schema so services never see `undefined`. */
export const querySortOrder = z.enum(['asc', 'desc']).default('desc');
