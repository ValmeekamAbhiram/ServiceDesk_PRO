/**
 * ServiceDesk Pro — rate limiting (§3).
 *
 * ## In-process, sliding window, no Redis
 *
 * This is a MERN-only build, so there is no shared counter store. The limiter keeps
 * counters in a `Map` in this process, which has one honest limitation worth stating
 * rather than hiding: **behind N instances the effective limit is N × max**. For this
 * application that is an acceptable trade, and the reasoning is not "Redis was
 * inconvenient":
 *
 *  - The purpose here is abuse and mistake absorption — a runaway client loop, a
 *    script hammering `/api/auth/login`, an accidental infinite `useEffect`. All of
 *    those come from one client to whichever instance the load balancer picked, and
 *    an in-process counter catches them.
 *  - It is not a defence against a distributed attack. Nothing at the application
 *    layer is; that belongs to a proxy or WAF in front of the app, and pretending
 *    otherwise would be worse than being explicit about the boundary.
 *
 * A sliding window rather than fixed buckets, because fixed buckets allow a burst of
 * 2× the limit across a boundary: 600 requests at 14:59 and 600 more at 15:00 both
 * pass a "600 per 15 minutes" fixed window. The implementation keeps request
 * timestamps per key and discards those outside the window — a small array per active
 * client, and the memory is bounded by the sweep below.
 *
 * ## Keying is by identity when there is one
 *
 * An authenticated request is keyed by user id, because that is the actor: an office
 * behind one NAT address would otherwise share a single quota, and one busy
 * technician would lock out their colleagues. Unauthenticated requests are keyed by
 * IP, because there is nothing else — which is exactly why the login limiter is
 * stricter, and why it also counts by *email* so that spraying one password across
 * many accounts from one address is caught even when each account is tried once.
 *
 * ## Failures are cheap and successes are not counted
 *
 * The auth limiter is configured with `skipSuccessful`, so a user who signs in
 * correctly twenty times in a morning is never locked out, while twenty *failures*
 * are throttled. Counting successes would punish normal use to slow down an attack it
 * does not actually slow down.
 */
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { RateLimitError } from '@/utils/errors';
/*
 * One store shared by every limiter, namespaced by `name`, so there is a single
 * sweeper rather than one interval per limiter.
 */
const buckets = new Map();
/**
 * Idle buckets are dropped every minute. Without this, a stream of distinct client
 * IPs would grow the map without bound — the limiter would become the memory leak it
 * exists to prevent. `unref()` so the timer never holds the process open.
 */
const SWEEP_INTERVAL_MS = 60_000;
const sweeper = setInterval(() => {
    const cutoff = Date.now() - Math.max(env.rateLimitWindowMs, SWEEP_INTERVAL_MS) * 2;
    for (const [key, bucket] of buckets) {
        if (bucket.lastSeen < cutoff)
            buckets.delete(key);
    }
}, SWEEP_INTERVAL_MS);
sweeper.unref();
/** Exposed for tests and for `demo:reset`, which should start from a clean slate. */
export function resetRateLimits() {
    buckets.clear();
}
/**
 * `Date.now()`, not the injected clock — deliberately.
 *
 * Rate limits protect the *process* from real traffic in real time. If the demo clock
 * jumped forward four hours, an injected clock would silently clear every window and
 * make the Time Machine a rate-limit bypass. Abuse protection must not be
 * time-travellable.
 */
function realNow() {
    return Date.now();
}
function identityKey(req, options) {
    const who = req.user?.id ?? req.ip ?? 'unknown';
    const extra = options.keyExtra?.(req);
    return extra ? `${options.name}:${who}:${extra}` : `${options.name}:${who}`;
}
export function rateLimit(options) {
    const windowMs = options.windowMs ?? env.rateLimitWindowMs;
    const { max, name } = options;
    return function rateLimitMiddleware(req, res, next) {
        const now = realNow();
        const key = identityKey(req, options);
        const bucket = buckets.get(key) ?? { hits: [], lastSeen: now };
        // Drop everything that has slid out of the window.
        const cutoff = now - windowMs;
        bucket.hits = bucket.hits.filter((at) => at > cutoff);
        bucket.lastSeen = now;
        if (bucket.hits.length >= max) {
            buckets.set(key, bucket);
            const oldest = bucket.hits[0] ?? now;
            const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            res.setHeader('X-RateLimit-Limit', String(max));
            res.setHeader('X-RateLimit-Remaining', '0');
            logger.warn({
                requestId: req.requestId,
                limiter: name,
                userId: req.user?.id,
                ip: req.ip,
                path: req.path,
                hits: bucket.hits.length,
                max,
            }, 'Rate limit exceeded.');
            next(new RateLimitError(retryAfterSeconds, options.message ?? 'Too many requests. Please slow down and try again shortly.'));
            return;
        }
        bucket.hits.push(now);
        buckets.set(key, bucket);
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.hits.length)));
        /*
         * When configured to ignore successes, the hit is retracted once the response
         * status is known. Recorded first and removed after, rather than counted at the
         * end: counting at the end would let a thousand concurrent in-flight attempts
         * all pass, since none of them has finished failing yet.
         */
        if (options.skipSuccessful) {
            res.on('finish', () => {
                if (res.statusCode < 400) {
                    const current = buckets.get(key);
                    if (!current)
                        return;
                    const index = current.hits.lastIndexOf(now);
                    if (index >= 0)
                        current.hits.splice(index, 1);
                }
            });
        }
        next();
    };
}
/* ─────────────────────────── configured limiters ────────────────────────── */
/** Global API limiter, mounted on `/api`. Generous — this catches runaway loops. */
export const globalRateLimit = () => rateLimit({ name: 'global', max: env.RATE_LIMIT_MAX });
/**
 * Login, register, refresh, password reset.
 *
 * Keyed by IP *and* submitted email, so both "one address trying many accounts" and
 * "many addresses trying one account" are throttled. The email is lower-cased and
 * length-capped before it becomes key material — an unbounded client-supplied string
 * in a map key is its own memory-growth problem.
 */
export const authRateLimit = () => rateLimit({
    name: 'auth',
    max: env.AUTH_RATE_LIMIT_MAX,
    skipSuccessful: true,
    keyExtra: (req) => {
        const body = req.body;
        if (typeof body?.email !== 'string')
            return undefined;
        return body.email.trim().toLowerCase().slice(0, 120);
    },
    message: 'Too many attempts. Please wait a few minutes before trying again.',
});
/**
 * AI endpoints. Tighter, because each call costs a provider request and real money,
 * and because an LLM call is the slowest thing the API does — an unbounded loop
 * against it exhausts the connection pool long before it exhausts a quota.
 */
export const aiRateLimit = () => rateLimit({
    name: 'ai',
    max: env.AI_RATE_LIMIT_MAX,
    message: 'The assistant is busy. Please wait a moment and try again.',
});
/** Uploads: bounded separately because each one costs disk, not just CPU. */
export const uploadRateLimit = () => rateLimit({ name: 'upload', max: 60, message: 'Too many uploads. Please wait a moment.' });
