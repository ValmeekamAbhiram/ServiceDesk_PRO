/**
 * ServiceDesk Pro — middleware barrel.
 *
 * ## The order these run in is part of the design
 *
 * `app.ts` composes them in this sequence, and each position is load-bearing:
 *
 *  1. `requestId()`      — first, so every later log line and error has a correlation id.
 *  2. helmet / cors / compression / body parsers — framework concerns.
 *  3. `requestLog()`     — after the id exists, before anything can fail.
 *  4. `globalRateLimit()`— before authentication, so an unauthenticated flood is
 *                          rejected without a database read. A limiter behind
 *                          `authenticate()` would still pay for every hit it blocks.
 *  5. `authenticate()`   — per-route, not global: public routes exist.
 *  6. `requireRole` / `requirePermission` — after authentication, obviously.
 *  7. `validate(schema)` — after authorization, so an unauthorized caller learns
 *                          nothing from validation messages about the shape of an
 *                          endpoint they may not use.
 *  8. the handler.
 *  9. `notFoundHandler()` — after all routes.
 * 10. `errorHandler()`    — last, and the only place that writes an error response.
 *
 * The rate-limit exceptions: `authRateLimit()` sits in front of the auth routes
 * specifically (it keys on the submitted email, so it must run after the body
 * parser), and `aiRateLimit()` / `uploadRateLimit()` mount on their own routers.
 */

export { requestId, elapsedMs } from '@/middleware/request-id';
export { requestLog } from '@/middleware/request-log';
export { errorHandler } from '@/middleware/error';
export { notFoundHandler } from '@/middleware/not-found';

export {
  validate,
  objectIdSchema,
  idParamSchema,
  paginationSchema,
  sortSchema,
  searchQuerySchema,
  dateRangeSchema,
  csvEnumSchema,
} from '@/middleware/validate';

export { authenticate, optionalAuth, requireActor, authenticateToken } from '@/middleware/authenticate';

export {
  requireRole,
  requirePermission,
  requireAllPermissions,
  requireResourceOwnership,
  requireDemoMode,
  type ResourceOwnershipOptions,
} from '@/middleware/authorize';

export {
  rateLimit,
  resetRateLimits,
  globalRateLimit,
  authRateLimit,
  aiRateLimit,
  uploadRateLimit,
  type RateLimitOptions,
} from '@/middleware/rate-limit';

