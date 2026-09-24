/**
 * ServiceDesk Pro — request correlation (§61).
 *
 * Runs before everything else, so `req.requestId` is safe to read from any other
 * middleware, controller, service or audit write without a null check.
 *
 * ## Why an inbound id is trusted, and why that is safe
 *
 * If the client sends `X-Request-Id`, we adopt it. That sounds like trusting input,
 * so it is worth being precise about what the value is allowed to do: nothing. It is
 * never used in a query, never compared against a stored value, never used for
 * authorisation — it is a log label. Adopting it is what lets a browser session, an
 * API log line and an audit row be lined up in one search, which is the entire point
 * of having correlation ids.
 *
 * It is still validated, because a log label that can contain newlines or 4KB of
 * text is a log-injection vector: a crafted id could forge a fake log line and make
 * an audit trail unreadable. So an inbound id must be a short, boring token, and
 * anything else is replaced with a generated one rather than rejected — a malformed
 * header is not worth failing a request over.
 *
 * `startedAtMs` uses the injected clock rather than `Date.now()`, so a demo
 * time-jump shows consistent timestamps across logs and SLA state. Durations are
 * measured with `performance.now()` instead: it is monotonic, so a time-travel jump
 * mid-request cannot produce a negative or wildly inflated duration.
 */
import { randomUUID } from 'node:crypto';
import { getClock } from '@/config/clock';
const REQUEST_ID_HEADER = 'x-request-id';
/**
 * Deliberately narrow: letters, digits, dash, underscore, up to 64 characters.
 * Wide enough for a UUID or a trace id from an upstream proxy, narrow enough that
 * nothing in it can break a log line.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Monotonic start marks, so a duration is never affected by the demo clock. */
const monotonicStart = new WeakMap();
export function requestId() {
    return function requestIdMiddleware(req, res, next) {
        const inbound = req.get(REQUEST_ID_HEADER);
        const id = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
        req.requestId = id;
        req.startedAtMs = getClock().nowMs();
        monotonicStart.set(req, performance.now());
        // Echoed so a user reporting a problem can quote the id from their network tab.
        res.setHeader('X-Request-Id', id);
        /*
         * Also on `res.locals`, because `utils/respond.ts` builds the success envelope
         * from the response alone — a handler that only has `res` in scope must still
         * be able to echo the id.
         */
        res.locals.requestId = id;
        next();
    };
}
/** Elapsed wall-clock milliseconds for this request, monotonic and demo-proof. */
export function elapsedMs(req) {
    const start = monotonicStart.get(req);
    return start === undefined ? 0 : Math.round(performance.now() - start);
}
