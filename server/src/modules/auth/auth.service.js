/**
 * ServiceDesk Pro — authentication service.
 *
 * Everything that mints, rotates or revokes a credential lives here. Controllers
 * hand it validated input and a context; it hands back an `AuthResponse`.
 *
 * The properties worth knowing before changing anything in this file:
 *
 *  - **The client never chooses a role.** `register()` writes `Role.EMPLOYEE`,
 *    full stop. `auth.schema.ts` has no `role` key, so a `role` in the body is
 *    stripped before this module ever sees it — belt and braces.
 *  - **Login reveals nothing.** A missing email still costs one bcrypt compare,
 *    and a deactivated account is only reported *after* the password verifies, so
 *    neither timing nor message distinguishes "no such user" from "wrong
 *    password" from "suspended".
 *  - **Refresh tokens rotate and detect reuse.** Each login opens a `familyId`;
 *    every refresh revokes the presented row and issues a new one in the same
 *    family. Presenting an already-revoked token means it leaked, so the entire
 *    family is revoked and the holder has to sign in again.
 *  - **A password change invalidates everything.** `passwordChangedAt` moves
 *    forward, which makes `authenticate()` refuse every previously issued access
 *    token, and all sessions are revoked. That includes the caller's own, which is
 *    why this endpoint returns a fresh `AuthResponse` rather than 204.
 *
 * No transactions: the deployment target is a standalone mongod (including the
 * in-memory fallback), so where a race is possible it is called out in a comment
 * and the write order is chosen to fail safe.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { AuditAction, AuditEntity, Role, UserStatus } from '@shared/enums';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { resolvePermissions } from '@/core/authz/permissions';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '@/core/auth/tokens';
import { Session, User } from '@/models';
import { toCurrentUserDto } from '@/modules/users/user.mapper';
import { record } from '@/modules/audit/audit.service';
import { DuplicateError, ForbiddenError, InvalidCredentialsError, TokenInvalidError, ValidationError, assertFound, } from '@/utils/errors';
const log = logger.child({ module: 'auth.service' });
/* ─────────────────────────── timing equalisation ──────────────────────────
 * Comparing against a real hash when no user matched keeps the failure paths the
 * same length; returning early instead would make "unknown email" measurably
 * faster than "wrong password" and turn the login form into an account
 * enumerator. Built lazily on the first miss so the cost is paid once, not on
 * every import, and from random bytes so no fixed hash sits in the source.
 */
let timingDecoy = null;
async function equaliseFailureTiming(candidate) {
    timingDecoy ??= await bcrypt.hash(randomBytes(24).toString('hex'), env.BCRYPT_ROUNDS);
    await bcrypt.compare(candidate, timingDecoy);
}
/** "Chrome on Windows" — cosmetic label for the session list, best-effort. */
function deviceLabelFrom(userAgent) {
    if (!userAgent)
        return null;
    const browser = /\bEdg\//.test(userAgent) ? 'Edge'
        : /\bOPR\//.test(userAgent) ? 'Opera'
            : /\bFirefox\//.test(userAgent) ? 'Firefox'
                : /\bChrome\//.test(userAgent) ? 'Chrome'
                    : /\bSafari\//.test(userAgent) ? 'Safari'
                        : null;
    const os = /Windows/i.test(userAgent) ? 'Windows'
        : /Android/i.test(userAgent) ? 'Android'
            : /(iPhone|iPad|iOS)/i.test(userAgent) ? 'iOS'
                : /Mac OS X/i.test(userAgent) ? 'macOS'
                    : /Linux/i.test(userAgent) ? 'Linux'
                        : null;
    if (browser && os)
        return `${browser} on ${os}`;
    return browser ?? os ?? userAgent.slice(0, 60);
}
async function issueSession(user, familyId, ctx, now) {
    const refreshToken = generateRefreshToken();
    const session = await Session.create({
        userId: user._id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        familyId,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + env.refreshTokenTtlSeconds * 1000),
        lastUsedAt: now,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        deviceLabel: deviceLabelFrom(ctx.userAgent),
    });
    const sessionId = session._id.toString();
    const access = signAccessToken(user._id.toString(), sessionId, now);
    return {
        sessionId,
        tokens: {
            accessToken: access.token,
            refreshToken,
            accessTokenExpiresAt: access.expiresAt.toISOString(),
        },
    };
}
/** Revoke every live session in a family. Returns how many were actually live. */
async function revokeFamily(familyId, at, reason) {
    const result = await Session.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: at, revokedReason: reason } });
    return result.modifiedCount ?? 0;
}
/** Shape the wire response. `permissions` is derived, never read from the record. */
function authResponse(user, tokens) {
    return { ...tokens, user: toCurrentUserDto(user, resolvePermissions(user.role)) };
}
/* ───────────────────────────────── register ───────────────────────────────── */
/**
 * Self-service sign-up. Always creates an **employee**, with one deliberate
 * exception: if the users collection is completely empty the first account
 * becomes an admin, so a fresh install is not locked out of its own admin screens
 * before the seeder has run.
 *
 * That bootstrap is safe because it is reachable only while no user exists at all
 * — `npm run seed` creates an admin, and after any account exists the branch is
 * dead. Two simultaneous registrations against a genuinely empty database could
 * both see zero and both become admin; with no transactions available that race is
 * accepted, and on an empty install there is nothing yet to protect.
 */
/**
 * An `ActorContext` for the audit trail on the two paths that have no signed-in user
 * yet. Registration and sign-in *establish* the identity, so the entry has to be
 * attributed to the account the request just proved it owns — attributing it to nobody
 * would make "who created this admin account?" unanswerable, which is the one question
 * the first-account rule below makes worth asking.
 */
function actorForAccount(user, ctx) {
    return {
        user: {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            permissions: resolvePermissions(user.role),
            sessionId: null,
        },
        requestId: ctx.requestId,
        clock: ctx.clock,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        automated: false,
    };
}
export async function register(input, ctx) {
    const taken = await User.exists({ email: input.email });
    if (taken) {
        // A friendlier field error than the unique index would give. The index is
        // still the real guarantee — see the catch in `auth.controller.ts`.
        throw new DuplicateError('That email address is already registered.', [
            { path: 'email', message: 'Already registered. Try signing in instead.' },
        ]);
    }
    const isFirstAccount = (await User.countDocuments({}, { limit: 1 })) === 0;
    const now = ctx.clock.now();
    const user = await User.create({
        name: input.name,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, env.BCRYPT_ROUNDS),
        role: isFirstAccount ? Role.ADMIN : Role.EMPLOYEE,
        status: UserStatus.ACTIVE,
        lastLoginAt: now,
    });
    log.info({ requestId: ctx.requestId, userId: user._id.toString(), role: user.role, isFirstAccount }, 'Account registered');
    await record({
        action: AuditAction.USER_CREATED,
        entityType: AuditEntity.USER,
        entityId: user._id.toString(),
        entityLabel: user.email,
        /* The first account becomes an administrator without anybody approving it, which
         * is the single most privilege-granting event in the system. It belongs in the
         * trail in as many words. */
        summary: isFirstAccount
            ? `Registered ${user.email} as the first account, which is an administrator`
            : `Registered ${user.email}`,
    }, actorForAccount(user, ctx));
    const { tokens } = await issueSession(user, randomUUID(), ctx, now);
    return authResponse(user, tokens);
}
/* ────────────────────────────────── login ─────────────────────────────────── */
export async function login(input, ctx) {
    // `passwordHash` is `select: false` on the schema, so it has to be asked for.
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    if (!user) {
        await equaliseFailureTiming(input.password);
        throw new InvalidCredentialsError();
    }
    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches)
        throw new InvalidCredentialsError();
    /*
     * Deliberately *after* the password check. Reporting "this account is
     * deactivated" to someone who has not proved they own it would confirm the
     * address is registered, which is exactly what `InvalidCredentialsError` exists
     * to avoid.
     */
    if (user.status !== UserStatus.ACTIVE) {
        throw new ForbiddenError('This account is not active. Please contact your IT administrator.');
    }
    const now = ctx.clock.now();
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: now } });
    const { tokens } = await issueSession(user, randomUUID(), ctx, now);
    log.info({ requestId: ctx.requestId, userId: user._id.toString() }, 'Signed in');
    /* Successful sign-ins only. A failed attempt must not write a row: the trail is
     * readable by administrators, an unlimited write path reachable without credentials
     * is a way to fill a disk, and the login rate limiter already logs the refusals. */
    await record({
        action: AuditAction.LOGIN,
        entityType: AuditEntity.USER,
        entityId: user._id.toString(),
        entityLabel: user.email,
        summary: `Signed in as ${user.role.toLowerCase()}`,
    }, actorForAccount(user, ctx));
    return authResponse(user, tokens);
}
/* ───────────────────────────────── logout ────────────────────────────────── */
/**
 * Revokes the session behind the caller's access token. Idempotent: signing out
 * twice, or with an already-revoked session, is a no-op rather than an error.
 *
 * The access token itself remains cryptographically valid until it expires — it is
 * `authenticate()`'s session lookup that stops it working, which is why sessions
 * are checked on every request rather than trusted from the token.
 */
export async function logout(actor) {
    const { sessionId } = actor.user;
    if (!sessionId)
        return;
    await Session.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: actor.clock.now(), revokedReason: 'signed out' } });
    log.info({ requestId: actor.requestId, userId: actor.user.id }, 'Signed out');
    await record({
        action: AuditAction.LOGOUT,
        entityType: AuditEntity.USER,
        entityId: actor.user.id,
        entityLabel: actor.user.email,
        summary: 'Signed out',
    }, actor);
}
/* ───────────────────────────────── refresh ───────────────────────────────── */
/**
 * Exchange a refresh token for a new pair. The presented token is always
 * consumed, so a refresh token is single-use.
 *
 * Reuse detection: if the presented row is already revoked, either it was rotated
 * away (so someone is replaying an old token) or it was explicitly revoked. Both
 * mean the value is in hands it should not be in, and there is no way to tell the
 * thief from the victim — so the whole family is revoked and both parties have to
 * sign in again. Losing a session is the cheap outcome; leaving a leaked token
 * working is not.
 */
export async function refresh(input, ctx) {
    const session = await Session.findOne({
        refreshTokenHash: hashRefreshToken(input.refreshToken),
    }).select('+refreshTokenHash');
    // Unknown, or already swept by the TTL index on `expiresAt`.
    if (!session)
        throw new TokenInvalidError('Please sign in again.');
    const now = ctx.clock.now();
    if (session.revokedAt) {
        const revoked = await revokeFamily(session.familyId, now, 'refresh token reuse detected');
        log.warn({
            requestId: ctx.requestId,
            userId: session.userId.toString(),
            familyId: session.familyId,
            sessionsRevoked: revoked,
        }, 'Refresh token reuse detected — session family revoked');
        throw new TokenInvalidError('Please sign in again.');
    }
    // The TTL index only sweeps once a minute, so expiry is checked here too.
    if (session.expiresAt.getTime() <= now.getTime()) {
        throw new TokenInvalidError('Your session has expired. Please sign in again.');
    }
    const user = await User.findById(session.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
        await revokeFamily(session.familyId, now, 'account no longer active');
        throw new TokenInvalidError('Please sign in again.');
    }
    /*
     * Issue first, then retire the old row. If the process dies between the two the
     * client holds a working token and the old one stays live for its remaining TTL
     * — recoverable. The other order would leave the client with nothing.
     */
    const { tokens, sessionId } = await issueSession(user, session.familyId, ctx, now);
    await Session.updateOne({ _id: session._id, revokedAt: null }, {
        $set: {
            revokedAt: now,
            revokedReason: 'rotated',
            replacedBySessionId: sessionId,
            lastUsedAt: now,
        },
    });
    return authResponse(user, tokens);
}
/* ────────────────────────────── change password ──────────────────────────── */
/**
 * Change your own password. Returns a full `AuthResponse` rather than 204, and it
 * has to: moving `passwordChangedAt` forward makes `authenticate()` reject every
 * access token minted before it — the caller's included — and every session is
 * revoked on the way through. Without a fresh pair in the response the user would
 * be silently signed out by their own success case.
 *
 * There is no "forgot password" flow by design. An administrator resets a
 * password from the user admin screen; nothing here sends email.
 */
export async function changePassword(actor, input) {
    /*
     * Bound to a local before `assertFound`, deliberately. Inlining an awaited
     * Mongoose query into a generic call makes TypeScript instantiate `select()`'s
     * document-override generic from its constraint rather than its default, which
     * quietly degrades every field to `any | undefined`. Two lines buy real types.
     */
    const found = await User.findById(actor.user.id).select('+passwordHash');
    const user = assertFound(found, 'Account');
    const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!matches) {
        // 400 with a field error, not 401: the caller is authenticated, they just
        // mistyped. A 401 would make the client think its token had gone stale.
        throw new ValidationError('Your current password is not correct.', [
            { path: 'currentPassword', message: 'Incorrect password.' },
        ]);
    }
    const now = actor.clock.now();
    await User.updateOne({ _id: user._id }, {
        $set: {
            passwordHash: await bcrypt.hash(input.newPassword, env.BCRYPT_ROUNDS),
            passwordChangedAt: now,
        },
    });
    // Revoke before issuing, or the replacement session would be caught by its own
    // clean-up.
    const revoked = await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: now, revokedReason: 'password changed' } });
    log.info({ requestId: actor.requestId, userId: user._id.toString(), sessionsRevoked: revoked.modifiedCount ?? 0 }, 'Password changed — all sessions revoked');
    /* An event, with no values attached — see the audit service header. The count of
     * revoked sessions is the useful detail and gives nothing away. */
    await record({
        action: AuditAction.PASSWORD_RESET,
        entityType: AuditEntity.USER,
        entityId: user._id.toString(),
        entityLabel: user.email,
        summary: `Changed their own password; ${revoked.modifiedCount ?? 0} session(s) revoked`,
    }, actor);
    const { tokens } = await issueSession(user, randomUUID(), actor, now);
    return authResponse(user, tokens);
}
/* ─────────────────────────────────── me ──────────────────────────────────── */
/**
 * The signed-in user's own profile. `authenticate()` already loaded enough to
 * authorise the request, but not the profile fields the header and settings page
 * show, so this re-reads. `permissions` is recomputed from the role here as
 * everywhere else — the client uses it only to hide controls it would be refused.
 */
export async function currentUser(actor) {
    const found = await User.findById(actor.user.id);
    const user = assertFound(found, 'Account');
    return toCurrentUserDto(user, resolvePermissions(user.role));
}
