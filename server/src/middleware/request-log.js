/**
 * ServiceDesk Pro — access logging (§61).
 *
 * One line per completed request, emitted on the response's `finish` event rather
 * than inline, so the log carries the status code and duration that a
 * before-the-handler log cannot know.
 *
 * ## What is not logged
 *
 * No request bodies. The redaction list in `config/logger.ts` would catch a
 * `password` field, but a ticket description is not a named credential and is
 * routinely full of things an employee should not have pasted — internal hostnames,
 * account numbers, occasionally a password in prose. Logging bodies by default would
 * mean the log file quietly becomes the most sensitive store in the system, so the
 * access log records *shape* (method, route, status, duration, size) and leaves
 * content to the audit trail, which has access controls.
 *
 * The query string is logged with values stripped for the same reason: `?q=<term>`
 * is a search someone performed. Key names are kept because "which filters are
 * actually used" is a legitimate operational question.
 *
 * ## Levels carry meaning
 *
 * 5xx logs at `error`, 4xx at `warn`, everything else at `info`, with health checks
 * and static assets dropped to `debug` — a monitoring probe every ten seconds would
 * otherwise bury the traffic that matters.
 */
import { logger } from '@/config/logger';
import { elapsedMs } from '@/middleware/request-id';
/** Paths whose success lines are noise. Failures on them still log normally. */
const QUIET_PATHS = new Set(['/api/health', '/api/health/live', '/api/health/ready', '/favicon.ico']);
/** `?status=OPEN&q=printer` → `status,q`. Names, never values. */
function queryKeys(req) {
    const keys = Object.keys(req.query ?? {});
    return keys.length ? keys.join(',') : undefined;
}
export function requestLog() {
    return function requestLogMiddleware(req, res, next) {
        res.on('finish', () => {
            const durationMs = elapsedMs(req);
            const quiet = QUIET_PATHS.has(req.path) && res.statusCode < 400;
            const level = quiet
                ? 'debug'
                : res.statusCode >= 500
                    ? 'error'
                    : res.statusCode >= 400
                        ? 'warn'
                        : 'info';
            logger[level]({
                requestId: req.requestId,
                method: req.method,
                // `route.path` is the pattern (`/api/tickets/:id`), which groups in a
                // dashboard; `req.path` would produce one distinct label per ticket.
                route: req.route?.path ?? req.path,
                path: req.path,
                status: res.statusCode,
                durationMs,
                query: queryKeys(req),
                bytes: Number(res.getHeader('content-length')) || undefined,
                userId: req.user?.id,
                role: req.user?.role,
                ip: req.ip,
            }, `${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`);
        });
        next();
    };
}
