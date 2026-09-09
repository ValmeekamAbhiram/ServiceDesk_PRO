/**
 * ServiceDesk Pro — Express request augmentation.
 *
 * These are the only properties middleware is allowed to hang off `req`. Keeping
 * the list short and declared in one place stops `req` from becoming an untyped
 * grab-bag, and makes it obvious which middleware must run before a handler can
 * rely on a given field.
 *
 * `tsconfig.json` sets `types: ["node"]`, so `@types/multer`'s own global
 * augmentation (`req.file` / `req.files`) is not auto-included. The reference
 * below pulls it in explicitly for the attachment upload routes.
 */

/// <reference types="multer" />

import type { ActorContext, AuthenticatedUser } from '@/core/actor';

/** Output of `middleware/validate.ts` — the parsed, coerced, trusted input. */
export interface ValidatedInput {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

declare global {
  namespace Express {
    interface Request {
      /**
       * Correlation id for this request. Set by `middleware/requestId.ts`, which
       * runs before everything else, so this is always present. Echoed in the
       * `X-Request-Id` response header, every log line and every audit entry.
       */
      requestId: string;

      /** `clock.nowMs()` at the start of the request, for duration logging. */
      startedAtMs: number;

      /**
       * Present only after `authenticate()` has run. Built from a fresh read of
       * the user document — never from claims the client supplied.
       */
      user?: AuthenticatedUser;

      /**
       * Present alongside `user`. This — not `req` — is what controllers pass
       * into services.
       */
      actor?: ActorContext;

      /**
       * Present only after `validate(schema)` has run. Handlers must read input
       * from here rather than from `req.body` / `req.query`, so an unvalidated
       * field can never reach a service.
       */
      validated?: ValidatedInput;
    }
  }
}
