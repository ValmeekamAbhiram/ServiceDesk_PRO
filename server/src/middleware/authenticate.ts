/**
 * ServiceDesk Pro — authentication.
 *
 * ## Every request re-reads the user
 *
 * The access token proves *who* is calling. It does not say what they may do. This
 * middleware takes `sub` from the token, loads the user document, loads the session
 * row, and rebuilds role and permissions from scratch — on every request.
 *
 * That is one extra indexed read per call, and it buys the property the brief
 * demands: never trust role information supplied by the frontend. A token claim is
 * frontend-supplied data. It is signed, so it cannot be *forged*, but it is a
 * snapshot of the past and cannot be corrected. Put `role` in the token and
 * demoting an administrator leaves them an administrator until their token expires;
 * put it in the database and the demotion is effective on their very next click.
 * The same applies to deactivating an account, locking one after a breach, or
 * revoking a single permission.
 *
 * Four things are therefore checked in order, each of which independently ends the
 * request:
 *
 *  1. The token verifies, is of type `access`, and has not expired.
 *  2. The user exists and is `ACTIVE` — a suspended account with a valid token in
 *     hand is refused.
 *  3. The session named by `sid` exists, is not revoked, and has not expired. This
 *     is what makes "log out everywhere" affect tokens already issued.
 *  4. The token was issued *after* `passwordChangedAt`. Changing a password
 *     invalidates every token minted before the change, which is what a user
 *     believes they are doing when they change a password after a scare.
 *
 * ## Failures are uniform
 *
 * Every failure above returns the same 401 shape. A response that distinguished
 * "no such user" from "wrong session" from "account suspended" would be an oracle:
 * an attacker holding a stale token could learn whether an account still exists and
 * whether it is active. `ErrorCode.UNAUTHENTICATED` with one message, and the real
 * reason in the log where support can read it.
 *
 * ## `optionalAuth`
 *
 * A few endpoints are legitimately better with an identity and correct without one
 * (the health endpoint's detail level, the outage banner on the login page). Those
 * use `optionalAuth()`, which populates `req.user` when a valid token is present and
 * proceeds anonymously otherwise. It never *fails* on a bad token, so it must never
 * guard anything — the guarding is `authenticate()`'s job, and every route that
 * needs an identity says so.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserStatus, type Permission } from '@shared/enums';
import { getClock } from '@/config/clock';
import { logger } from '@/config/logger';
import { bearerToken, verifyAccessToken } from '@/core/auth/tokens';
import { resolvePermissions } from '@/core/authz/permissions';
import type { ActorContext, AuthenticatedUser } from '@/core/actor';
import { Session, User, type UserDoc } from '@/models';
import { UnauthenticatedError } from '@/utils/errors';

/** Only the fields an `AuthenticatedUser` needs. Notably not `passwordHash`. */
const USER_PROJECTION = ['name', 'email', 'role', 'status', 'passwordChangedAt'].join(' ');

type AuthUserDoc = Pick<
  UserDoc,
  '_id' | 'name' | 'email' | 'role' | 'status' | 'passwordChangedAt'
>;

function toAuthenticatedUser(user: AuthUserDoc, sessionId: string): AuthenticatedUser {
  const permissions: ReadonlySet<Permission> = resolvePermissions(user.role);

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    permissions,
    sessionId,
  };
}

/** Build the context services receive. Never `req` itself — see `core/actor.ts`. */
function buildActor(req: Request, user: AuthenticatedUser): ActorContext {
  return {
    user,
    requestId: req.requestId,
    clock: getClock(),
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    automated: false,
  };
}

/**
 * Resolve a bearer token to an authenticated user, or throw.
 *
 * Shared by the HTTP middleware and the Socket.IO handshake, so a socket connection
 * is subject to exactly the same four checks as a REST call. A real-time channel
 * that authenticated more loosely than the API would be the obvious way around
 * every guard in the application.
 */
export async function authenticateToken(
  token: string,
  nowMs: number
): Promise<AuthenticatedUser> {
  const claims = verifyAccessToken(token, nowMs);

  const [user, session] = await Promise.all([
    User.findById(claims.sub).select(USER_PROJECTION).lean<AuthUserDoc>().exec(),
    Session.findById(claims.sid)
      .select('userId revokedAt expiresAt')
      .lean<{ _id: unknown; userId: unknown; revokedAt: Date | null; expiresAt: Date }>()
      .exec(),
  ]);

  // `reason` is for the log only; the client always sees the same message.
  const fail = (reason: string): never => {
    logger.debug({ userId: claims.sub, sessionId: claims.sid, reason }, 'Authentication rejected.');
    throw new UnauthenticatedError('Your session is no longer valid. Please sign in again.');
  };

  if (!user) return fail('user not found');
  if (user.status !== UserStatus.ACTIVE) return fail(`user status ${user.status}`);
  if (!session) return fail('session not found');
  if (session.revokedAt) return fail('session revoked');
  if (session.expiresAt.getTime() <= nowMs) return fail('session expired');
  if (String(session.userId) !== String(user._id)) return fail('session/user mismatch');

  /*
   * `iat` is in seconds and `passwordChangedAt` in milliseconds, so the comparison
   * is done in seconds with a floor on the password timestamp. Rounding the other
   * way would leave a token issued in the same second as the change still valid.
   */
  if (user.passwordChangedAt && typeof claims.iat === 'number') {
    const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (claims.iat < changedAtSeconds) return fail('token predates password change');
  }

  return toAuthenticatedUser(user, String(session._id));
}

/* ──────────────────────────────── middleware ────────────────────────────── */

export function authenticate(): RequestHandler {
  return async function authenticateMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const token = bearerToken(req.get('authorization'));
      if (!token) {
        throw new UnauthenticatedError('Sign in to continue.');
      }

      const user = await authenticateToken(token, getClock().nowMs());
      req.user = user;
      req.actor = buildActor(req, user);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** See the `optionalAuth` note in the file header. Never use this as a guard. */
export function optionalAuth(): RequestHandler {
  return async function optionalAuthMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    const token = bearerToken(req.get('authorization'));
    if (!token) {
      next();
      return;
    }

    try {
      const user = await authenticateToken(token, getClock().nowMs());
      req.user = user;
      req.actor = buildActor(req, user);
    } catch {
      // Anonymous is a valid outcome here. Deliberately silent: a stale token on a
      // public endpoint is normal, not an incident.
    }
    next();
  };
}

/**
 * Assert that authentication has run, and narrow the types for a handler.
 *
 * Controllers call `const actor = requireActor(req)` rather than `req.actor!`. The
 * non-null assertion would compile just as well and would be wrong the day someone
 * mounts a handler without `authenticate()` in front of it — this throws a 401
 * instead of dereferencing undefined and producing a 500 that looks like a bug in
 * the handler rather than a missing middleware.
 */
export function requireActor(req: Request): ActorContext {
  if (!req.actor) {
    throw new UnauthenticatedError('Sign in to continue.');
  }
  return req.actor;
}
