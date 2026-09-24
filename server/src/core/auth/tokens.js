/**
 * ServiceDesk Pro — token primitives. Pure: no Express, no Mongoose.
 *
 * ## Two secrets, two token types
 *
 * Access and refresh tokens are signed with different secrets (`JWT_SECRET` and
 * `JWT_REFRESH_SECRET`, which `config/env.ts` refuses to let be equal in
 * production). The reason is containment: an access token travels in an
 * `Authorization` header on every request and through every proxy log, so it is the
 * one more likely to leak — and if the two shared a secret, a leaked 15-minute
 * access token could be replayed as a 7-day refresh token. Separate secrets make
 * that impossible rather than merely unlikely, and the `typ` claim is checked on top
 * so even one secret cannot mint the other kind.
 *
 * ## What the access token carries, and what it does not
 *
 * It carries `sub` (user id) and `sid` (session id). It does **not** carry role or
 * permissions. That is a deliberate refusal of the obvious optimisation, and "never trust
 * role information supplied by the frontend" is why: a token claim is
 * frontend-supplied data, signed by us but *stale by construction*. If `role` lived
 * in the token, demoting an admin would leave them an admin for up to fifteen
 * minutes, and revoking a permission would not take effect until their token
 * expired. Instead the role and the permission set are re-derived from the user
 * document on every request, so a revocation is effective on the next call.
 *
 * `sid` is what makes logout real. Without it, a stolen access token stays valid
 * until it expires no matter what the user does; with it, `authenticate()` checks the
 * session row and a revoked session fails immediately.
 *
 * ## Refresh tokens are opaque, not JWTs
 *
 * A refresh token is 32 bytes of randomness, stored as a SHA-256 hash on the session
 * row. It carries no claims because it needs none — it is a lookup key. Hashing means
 * a database leak yields nothing replayable, and single-use rotation means a token
 * presented twice is evidence of theft rather than an ambiguous failure.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { TokenExpiredError, TokenInvalidError } from '@/utils/errors';
/** Distinguishes the two token kinds inside the payload itself. */
export const TokenType = {
    ACCESS: 'access',
    REFRESH: 'refresh',
};
const ISSUER = 'servicedesk-pro';
const AUDIENCE = 'servicedesk-pro-api';
/* ─────────────────────────────── access tokens ──────────────────────────── */
export function signAccessToken(userId, sessionId, issuedAt) {
    const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000);
    const expiresInSeconds = env.accessTokenTtlSeconds;
    const options = {
        issuer: ISSUER,
        audience: AUDIENCE,
        /*
         * `iat` is set explicitly from the injected clock rather than left to the
         * library. Under the demo clock the two differ by hours, and a token whose
         * `iat` is in the future relative to its own verifier is rejected as
         * `notBefore` — which would break the Time Machine in a thoroughly confusing
         * way.
         */
        expiresIn: expiresInSeconds,
        notBefore: 0,
    };
    const token = jwt.sign({ sub: userId, sid: sessionId, typ: TokenType.ACCESS, iat: issuedAtSeconds }, env.JWT_SECRET, options);
    return {
        token,
        expiresAt: new Date((issuedAtSeconds + expiresInSeconds) * 1000),
        expiresInSeconds,
    };
}
/**
 * Verify an access token's signature, claims and type.
 *
 * `clockTimestamp` is passed from the injected clock so expiry is judged against
 * the same "now" the rest of the request uses — without it, a demo jump of +4h
 * would make every freshly-issued token appear expired.
 *
 * Throws `TokenExpiredError` or `TokenInvalidError`; never returns null, so a caller
 * cannot forget to check.
 */
export function verifyAccessToken(token, nowMs) {
    let payload;
    try {
        payload = jwt.verify(token, env.JWT_SECRET, {
            issuer: ISSUER,
            audience: AUDIENCE,
            clockTimestamp: Math.floor(nowMs / 1000),
            algorithms: ['HS256'],
        });
    }
    catch (error) {
        const name = error.name;
        if (name === 'TokenExpiredError') {
            throw new TokenExpiredError('Your session has expired. Please sign in again.');
        }
        // NotBeforeError, JsonWebTokenError, SyntaxError — all "this token is not ours".
        throw new TokenInvalidError();
    }
    if (typeof payload === 'string' || payload === null)
        throw new TokenInvalidError();
    const claims = payload;
    /*
     * The type check is not redundant with the separate secret. Belt and braces is
     * warranted here: if a future change ever made the secrets equal (a mistaken
     * env copy, a shared secret store), this check is the thing that still stops a
     * refresh token from being used as an access token.
     */
    if (claims.typ !== TokenType.ACCESS)
        throw new TokenInvalidError('Wrong token type.');
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
        throw new TokenInvalidError();
    }
    return claims;
}
/**
 * Extract a bearer token from an `Authorization` header.
 *
 * Case-insensitive on the scheme (`Bearer`, `bearer`) because clients vary, but
 * strict about the shape — a header with two spaces or extra parts is rejected rather
 * than salvaged.
 */
export function bearerToken(header) {
    if (!header)
        return null;
    const parts = header.trim().split(/\s+/);
    if (parts.length !== 2)
        return null;
    if (parts[0]?.toLowerCase() !== 'bearer')
        return null;
    return parts[1] || null;
}
/* ────────────────────────────── refresh tokens ──────────────────────────── */
/** 32 bytes of CSPRNG output, base64url. Opaque by design — see the header. */
export function generateRefreshToken() {
    return randomBytes(32).toString('base64url');
}
/**
 * SHA-256, not bcrypt.
 *
 * bcrypt is correct for passwords because they are low-entropy and guessable, so
 * the work factor is the defence. A refresh token is 256 bits of randomness and
 * cannot be brute-forced at any work factor, so the slow hash buys nothing — and it
 * would cost a bcrypt comparison on every token refresh, plus a salt, which would
 * make the value unindexable. A single SHA-256 keeps the lookup a unique-index hit.
 */
export function hashRefreshToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
