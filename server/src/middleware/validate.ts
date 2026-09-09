/**
 * ServiceDesk Pro — input validation (§3).
 *
 * ## Validation replaces input, it does not merely check it
 *
 * The middleware writes the *parsed* value to `req.validated` and handlers read from
 * there. That is the whole security argument, and it is stronger than it looks:
 *
 *  - Zod's object parsing **strips unknown keys**, so a client that posts
 *    `{ title, status: 'RESOLVED', assignedTechnicianId: '…' }` to an endpoint whose
 *    schema declares only `title` and `description` does not get a partially
 *    honoured privilege escalation. The extra fields do not reach the service at
 *    all. Mongoose's `strict: true` is the second layer behind this, but relying on
 *    the database as the only field filter means every service must remember never
 *    to spread request objects into an update.
 *  - Coercion happens once, here. `?page=2` arrives as a string; `z.coerce.number()`
 *    turns it into `2` so no handler ever does arithmetic on a string, and
 *    `?page=abc` is a 400 rather than a `NaN` that silently becomes page 1.
 *  - `req.body` is deliberately left alone rather than reassigned. If a handler is
 *    written against `req.body` by mistake, it gets the raw value and the mistake is
 *    visible in review, instead of both paths appearing to work.
 *
 * ## Only declared sections are validated
 *
 * A schema declares any of `body`, `query`, `params`. Sections it omits are absent
 * from `req.validated`, so reading `req.validated.query` in a handler whose schema
 * never declared a query shape is a type error, not an empty object that quietly
 * behaves like "no filters".
 *
 * ## Errors are field-shaped
 *
 * A Zod failure becomes `ValidationError` with one `ApiFieldError` per issue, and the
 * client highlights the inputs. `toAppError()` performs the same mapping for
 * anything that throws deeper in the stack, so the two paths cannot drift.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import type { ApiFieldError } from '@shared/types';
import { ValidationError } from '@/utils/errors';

export interface RequestSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Prefix issue paths with the section they came from, so a form can distinguish
 * `body.email` from `query.email` and a developer reading a 400 knows where to look.
 */
function toFieldErrors(section: keyof RequestSchema, error: z.ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? `${section}.${issue.path.join('.')}` : section,
    message: issue.message,
  }));
}

export function validate(schema: RequestSchema): RequestHandler {
  const sections = Object.keys(schema) as (keyof RequestSchema)[];

  return function validateMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const validated: Record<string, unknown> = {};
    const fields: ApiFieldError[] = [];

    for (const section of sections) {
      const sectionSchema = schema[section];
      if (!sectionSchema) continue;

      const result = sectionSchema.safeParse(req[section]);
      if (result.success) {
        validated[section] = result.data;
      } else {
        /*
         * Every section is checked before returning, rather than failing on the
         * first. A form that has both an invalid email and a missing title should
         * show both problems at once — validating one field per round trip is a
         * genuinely unpleasant way to fill in a form.
         */
        fields.push(...toFieldErrors(section, result.error));
      }
    }

    if (fields.length) {
      next(new ValidationError('Some fields need attention.', fields));
      return;
    }

    req.validated = validated;
    next();
  };
}

/* ──────────────────────────── reusable fragments ──────────────────────────
 * Small pieces that appear in most route schemas. Defined once so that, for
 * example, "what counts as a valid ObjectId" has a single answer.
 * ------------------------------------------------------------------------- */

/** 24 hex characters. Rejects the malformed id before it reaches Mongoose. */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id.');

/** `/:id` path parameter, the most common params shape in the app. */
export const idParamSchema = z.object({ id: objectIdSchema });

/**
 * Pagination, shared by every list endpoint. `limit` is capped at 100 in schema
 * rather than trusted: an uncapped `?limit=100000` is a trivial way to turn a list
 * endpoint into a denial-of-service against our own database.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** `?sort=-createdAt` — direction is a leading dash, as in Mongo's own convention. */
export const sortSchema = z.object({
  sort: z.string().max(64).optional(),
});

/**
 * Free-text search input. Trimmed and length-capped; a 10KB search term is not a
 * search, and MongoDB's text stage will happily spend real time on one.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
});

/** ISO date range filter, validated as a pair so `to` cannot precede `from`. */
export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must not be after `to`.',
    path: ['from'],
  });

/**
 * Comma-separated repeatable filter (`?status=OPEN,IN_PROGRESS`), normalised to an
 * array. Accepts the repeated-key form (`?status=OPEN&status=IN_PROGRESS`) too,
 * because both are idiomatic and a client should not have to guess which we chose.
 */
export function csvEnumSchema<const T extends readonly [string, ...string[]]>(values: T) {
  const member = z.enum(values);
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((input, ctx) => {
      if (input === undefined) return undefined;
      const parts = (Array.isArray(input) ? input : input.split(','))
        .map((part) => part.trim())
        .filter(Boolean);

      const parsed: T[number][] = [];
      for (const part of parts) {
        const result = member.safeParse(part);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `"${part}" is not one of: ${values.join(', ')}.`,
          });
          continue;
        }
        parsed.push(result.data);
      }
      return parsed.length ? parsed : undefined;
    });
}
