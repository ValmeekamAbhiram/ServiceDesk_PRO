/**
 * ServiceDesk Pro — 404 handler for unmatched API routes.
 *
 * Mounted after every route and before `errorHandler()`. It throws rather than
 * responding, so an unknown path produces exactly the same envelope as every other
 * failure — one response format, one code path.
 *
 * The message names the method and path but nothing else. Listing valid routes here
 * would be a free API map for anyone probing the service, and the real documentation
 * is `docs/API.md`.
 */

import type { NextFunction, Request, Response } from 'express';
import { ErrorCode } from '@shared/enums';
import { AppError } from '@/utils/errors';

export function notFoundHandler() {
  return function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
    next(
      new AppError(
        ErrorCode.NOT_FOUND,
        404,
        `No route matches ${req.method} ${req.path}.`
      )
    );
  };
}
