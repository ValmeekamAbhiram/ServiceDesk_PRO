/**
 * ServiceDesk Pro — auth routes.
 *
 * Mounted at `/api/auth`. Middleware order per route is deliberate and matches the
 * sequence documented in `middleware/index.ts`:
 *
 *     rate limit → authenticate → validate → handler
 *
 * `authRateLimit()` keys on the submitted email as well as the IP, so brute-forcing
 * one account is limited even from rotating addresses. It runs before `validate()`
 * because there is no reason to spend a Zod parse on a caller that is already over
 * its budget, and it is configured with `skipSuccessful`, so a person mistyping a
 * password twice and then getting it right is not penalised.
 *
 * `/refresh` is rate limited too. It is unauthenticated by definition — the access
 * token has expired, which is the whole reason for calling it — so without a limit
 * it would be the one unmetered way to probe for valid refresh tokens.
 */

import { Router } from 'express';
import { authenticate, authRateLimit, validate } from '@/middleware';
import * as controller from '@/modules/auth/auth.controller';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from '@/modules/auth/auth.schema';

export const authRouter = Router();

/* ─────────────────────────────── public ──────────────────────────────── */

authRouter.post('/register', authRateLimit(), validate(registerSchema), controller.register);
authRouter.post('/login', authRateLimit(), validate(loginSchema), controller.login);
authRouter.post('/refresh', authRateLimit(), validate(refreshSchema), controller.refresh);

/* ──────────────────────────── authenticated ──────────────────────────── */

authRouter.get('/me', authenticate(), controller.me);
authRouter.post('/logout', authenticate(), controller.logout);
authRouter.post(
  '/change-password',
  authenticate(),
  authRateLimit(),
  validate(changePasswordSchema),
  controller.changePassword
);
