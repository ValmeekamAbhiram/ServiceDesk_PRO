/**
 * ServiceDesk Pro — the terminal error handler.
 *
 * Every failure in the application funnels through here, and this is the only place
 * that decides what a client is told. That centralisation is the point: a rule about
 * not leaking internals cannot be enforced if forty handlers each format their own
 * errors.
 *
 * ## The `expose` rule
 *
 * `AppError.expose` decides whether the thrown message reaches the browser. It
 * defaults to true for 4xx (the user needs to know their file was too large) and
 * false for 5xx, where messages are replaced with a generic line. This matters
 * because 5xx messages are written by libraries, not by us:
 * `MongoServerError: Authentication failed for user 'sd_app' on 'cluster0.abc.mongodb.net'`
 * is a genuine 500 message, and it names infrastructure and an account. The user
 * gets "Something went wrong on our end." plus the request id, which is what they
 * actually need to get help.
 *
 * Stack traces are logged, never serialised. `NODE_ENV=development` does not change
 * that: a dev-only branch that puts a stack in a response body is exactly the branch
 * that ends up enabled in a staging environment someone forgot about. The stack is
 * one `grep` away in the log, keyed by the same request id the user can read off
 * their screen.
 *
 * ## Why unknown throws are converted rather than crashing
 *
 * `toAppError()` maps Zod issues, Mongo duplicate keys, Mongoose validation and cast
 * failures onto the proper 4xx codes. Without it a bad ObjectId in a URL — something
 * any crawler will produce — would be a 500 and would page someone. With it, a
 * malformed id is a 404, which is the truth: it cannot refer to a record that exists.
 *
 * ## Client aborts are not errors
 *
 * A user navigating away mid-request produces `ECONNABORTED` / `ERR_STREAM_PREMATURE_CLOSE`
 * on a socket nobody is listening to. Those are logged at debug and not counted as
 * failures, because an error rate that rises when users close tabs is not measuring
 * anything about the service.
 */
import { ErrorCode } from '@shared/enums';
import { logger } from '@/config/logger';
import { toAppError } from '@/utils/errors';
import { elapsedMs } from '@/middleware/request-id';
const GENERIC_5XX_MESSAGE = 'Something went wrong on our end. Please try again.';
/** Node/undici codes that mean "the client went away", not "we failed". */
const CLIENT_ABORT_CODES = new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'EPIPE',
    'ERR_STREAM_PREMATURE_CLOSE',
]);
/*
 * Note what is *not* checked here: `req.destroyed`. Node destroys the request
 * stream as soon as a body has been fully read, so on any POST that awaited
 * anything — a database lookup, a bcrypt compare — `req.destroyed` is true while
 * the connection is perfectly healthy. Trusting it meant every asynchronous 4xx on
 * a POST destroyed the socket and the caller saw an empty reply instead of its
 * error. The socket's own state is the honest signal.
 */
function isClientAbort(error, res) {
    const code = error?.code;
    if (code !== undefined && CLIENT_ABORT_CODES.has(code))
        return true;
    return res.socket?.destroyed === true || !res.writable;
}
/** Assemble the wire body, applying the `expose` rule. */
function buildBody(error, requestId) {
    const message = error.expose ? error.message : GENERIC_5XX_MESSAGE;
    const body = {
        success: false,
        error: { code: error.code, message },
        requestId,
    };
    // Field errors are only ever produced by our own validation, so they are safe.
    if (error.fields?.length)
        body.error.fields = error.fields;
    /*
     * `meta` is merged rather than nested, because the contract puts
     * `currentVersion` and `retryAfterSeconds` directly on the error body — the UI
     * reads `error.currentVersion` to offer a reconciliation view. Only exposed
     * errors carry meta outward; a 500's meta stays in the log.
     */
    if (error.expose && error.meta)
        Object.assign(body.error, error.meta);
    return body;
}
export function errorHandler() {
    return function errorMiddleware(err, req, res, next) {
        /*
         * Headers already sent means a response was streaming when it failed — a file
         * download, say. There is no way to turn that into a JSON error, and trying
         * corrupts the body. Destroy the socket and let Express finish.
         */
        if (res.headersSent) {
            logger.error({ requestId: req.requestId, err }, 'Error after response started; connection destroyed.');
            res.destroy();
            return;
        }
        if (isClientAbort(err, res)) {
            logger.debug({ requestId: req.requestId, path: req.path }, 'Client aborted request.');
            res.destroy();
            return;
        }
        const error = toAppError(err);
        const requestId = req.requestId ?? 'unknown';
        const logPayload = {
            requestId,
            code: error.code,
            status: error.statusCode,
            method: req.method,
            path: req.path,
            durationMs: elapsedMs(req),
            userId: req.user?.id,
            role: req.user?.role,
            // pino serialises `err` with its stack and `cause` chain. Log only.
            err: error,
            meta: error.meta,
        };
        if (error.statusCode >= 500) {
            logger.error(logPayload, `Unhandled failure: ${error.message}`);
        }
        else if (error.code === ErrorCode.RATE_LIMITED || error.statusCode === 401) {
            // Expected, high-volume, and worth watching in aggregate rather than reading.
            logger.info(logPayload, `Rejected: ${error.message}`);
        }
        else {
            logger.warn(logPayload, `Request failed: ${error.message}`);
        }
        // `next` is unused but must stay in the signature — Express identifies an
        // error handler by its arity, and dropping the fourth parameter silently
        // turns this into ordinary middleware that never runs.
        void next;
        res.status(error.statusCode).json(buildBody(error, requestId));
    };
}
