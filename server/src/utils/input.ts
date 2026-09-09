/**
 * ServiceDesk Pro — validated-input accessors.
 *
 * `middleware/validate.ts` writes the parsed result to `req.validated`, typed as
 * `unknown` because the middleware has no idea which schema a given route used.
 * These three accessors are the one place that assertion is made, so a controller
 * reads `bodyOf<RegisterInput>(req)` instead of scattering `as` casts around.
 *
 * The cast is sound only because of the rule these enforce: **a handler may only
 * read a section its route declared a schema for.** If `validate()` did not run,
 * or ran without that section, the accessor throws rather than handing back
 * `undefined` typed as `T` — which would surface later as a confusing 500 deep
 * inside a service instead of an obvious mistake in the route definition.
 *
 * Reading `req.body` directly in a controller is therefore always a bug: it
 * bypasses coercion, trimming, key-stripping and length limits.
 */

import type { Request } from 'express';
import { InternalError } from '@/utils/errors';

function section<T>(req: Request, name: 'body' | 'query' | 'params'): T {
  const value = req.validated?.[name];
  if (value === undefined) {
    throw new InternalError(
      `This route reads validated ${name} but declared no ${name} schema — add one to validate().`
    );
  }
  return value as T;
}

export function bodyOf<T>(req: Request): T {
  return section<T>(req, 'body');
}

export function queryOf<T>(req: Request): T {
  return section<T>(req, 'query');
}

export function paramsOf<T>(req: Request): T {
  return section<T>(req, 'params');
}
