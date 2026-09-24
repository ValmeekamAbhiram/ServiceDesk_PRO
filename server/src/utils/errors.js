/**
 * ServiceDesk Pro — error hierarchy.
 *
 * Anything thrown from a controller, service or middleware should be an
 * `AppError`. `middleware/error.ts` is the single place that turns one of these
 * into the wire envelope, and the only place that logs a stack trace — raw
 * stacks are never sent to a client.
 *
 * `expose` is the safety valve: when false the middleware substitutes a generic
 * message, so an internal failure cannot leak a connection string, a file path
 * or a query into the browser. It defaults to true for 4xx (the caller can fix a
 * 4xx, so telling them what is wrong is the entire point) and false for 5xx.
 *
 * The `ErrorCode` set is deliberately small: one code per thing the *client* must
 * behave differently about — refresh a token, highlight form fields, offer a
 * reload on a conflict — not one code per place something can go wrong. The
 * human-readable `message` carries the detail.
 */
import { ErrorCode } from '@shared/enums';
export class AppError extends Error {
    code;
    statusCode;
    fields;
    meta;
    expose;
    constructor(code, statusCode, message, options = {}) {
        super(message, { cause: options.cause });
        this.name = new.target.name;
        this.code = code;
        this.statusCode = statusCode;
        this.fields = options.fields;
        this.meta = options.meta;
        this.expose = options.expose ?? statusCode < 500;
        Error.captureStackTrace?.(this, new.target);
    }
}
/* ───────────────────────────── 4xx client errors ────────────────────────── */
export class ValidationError extends AppError {
    constructor(message = 'Some fields need attention.', fields, cause) {
        super(ErrorCode.VALIDATION_FAILED, 400, message, { fields, cause });
    }
}
export class UnauthenticatedError extends AppError {
    constructor(message = 'Please sign in to continue.', cause) {
        super(ErrorCode.UNAUTHENTICATED, 401, message, { cause });
    }
}
/**
 * Login failure. The message is deliberately identical for "no such email" and
 * "wrong password", so the endpoint cannot be used to enumerate which addresses
 * are registered.
 */
export class InvalidCredentialsError extends AppError {
    constructor(message = 'Incorrect email or password.') {
        super(ErrorCode.UNAUTHENTICATED, 401, message);
    }
}
/** Distinct from `TOKEN_INVALID`: the client should try its refresh token. */
export class TokenExpiredError extends AppError {
    constructor(message = 'Your session has expired. Please sign in again.') {
        super(ErrorCode.TOKEN_EXPIRED, 401, message);
    }
}
/** Distinct from `TOKEN_EXPIRED`: refreshing will not help, sign in again. */
export class TokenInvalidError extends AppError {
    constructor(message = 'Invalid or malformed token.', cause) {
        super(ErrorCode.TOKEN_INVALID, 401, message, { cause });
    }
}
export class ForbiddenError extends AppError {
    constructor(message = 'You do not have permission to perform this action.') {
        super(ErrorCode.FORBIDDEN, 403, message);
    }
}
/** The Time Machine and other demo-only endpoints, outside demo mode. */
export class DemoDisabledError extends AppError {
    constructor(message = 'Demo controls are disabled on this deployment.') {
        super(ErrorCode.DEMO_DISABLED, 403, message);
    }
}
/**
 * Also used for records the caller may not see. Services throw this instead of
 * `ForbiddenError` after a scoped query, which is what makes an unauthorised id
 * and a non-existent id indistinguishable to the caller.
 */
export class NotFoundError extends AppError {
    constructor(resource = 'Resource', identifier) {
        super(ErrorCode.NOT_FOUND, 404, identifier ? `${resource} ${identifier} was not found.` : `${resource} was not found.`);
    }
}
export class ConflictError extends AppError {
    constructor(message = 'The request conflicts with the current state.', meta) {
        super(ErrorCode.CONFLICT, 409, message, { meta });
    }
}
/** A unique index rejected the write. Carries the offending fields for the form. */
export class DuplicateError extends AppError {
    constructor(message = 'A record with these details already exists.', fields) {
        super(ErrorCode.CONFLICT, 409, message, { fields });
    }
}
/**
 * Optimistic-concurrency failure — the client's `version` is stale. The current
 * version travels in the envelope so the client can offer "reload and reapply"
 * rather than simply failing.
 */
export class VersionConflictError extends AppError {
    constructor(currentVersion, resource = 'record') {
        super(ErrorCode.VERSION_CONFLICT, 409, `This ${resource} was changed by someone else while you were editing. Reload it and try again.`, { meta: { currentVersion } });
    }
}
/** A status change the transition table forbids. Lists what *is* allowed. */
export class InvalidTransitionError extends AppError {
    constructor(entity, from, to, allowed = []) {
        super(ErrorCode.INVALID_TRANSITION, 409, `A ${entity} cannot move from ${from} to ${to}.` +
            (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ''), { meta: { from, to, allowed } });
    }
}
/*
 * Rejected uploads share one code — the client's response to any refused file is
 * the same, show the message and keep the form — but the status codes differ so
 * that proxy logs stay meaningful.
 */
export class PayloadTooLargeError extends AppError {
    constructor(limitBytes) {
        const mb = Math.round((limitBytes / (1024 * 1024)) * 10) / 10;
        super(ErrorCode.UPLOAD_REJECTED, 413, `That file is larger than the ${mb} MB limit.`, {
            meta: { limitBytes },
        });
    }
}
export class UnsupportedMediaTypeError extends AppError {
    constructor(received, allowed) {
        super(ErrorCode.UPLOAD_REJECTED, 415, `Files of type "${received}" are not allowed. Accepted types: ${allowed.join(', ')}.`, { meta: { received, allowed } });
    }
}
export class UploadRejectedError extends AppError {
    constructor(message, meta) {
        super(ErrorCode.UPLOAD_REJECTED, 400, message, { meta });
    }
}
/** Note the argument order: seconds first, message second. */
export class RateLimitError extends AppError {
    constructor(retryAfterSeconds, message = 'Too many requests. Please slow down.') {
        super(ErrorCode.RATE_LIMITED, 429, message, { meta: { retryAfterSeconds } });
    }
}
/* ───────────────────────────── 5xx server errors ────────────────────────── */
/**
 * Exposed on purpose: "try again shortly" is actionable and reveals nothing.
 * Ticket suggestions fall back to the offline classifier rather than throwing, so
 * this is for cases where there is genuinely nothing to degrade to.
 */
export class ServiceUnavailableError extends AppError {
    constructor(message = 'That service is unavailable. Please try again shortly.', cause) {
        super(ErrorCode.SERVICE_UNAVAILABLE, 503, message, { cause, expose: true });
    }
}
export class DatabaseError extends AppError {
    constructor(message = 'The database is unavailable.', cause) {
        super(ErrorCode.SERVICE_UNAVAILABLE, 503, message, { cause, expose: false });
    }
}
export class InternalError extends AppError {
    constructor(message = 'Something went wrong on our side.', cause) {
        super(ErrorCode.INTERNAL, 500, message, { cause, expose: false });
    }
}
/* ──────────────────────────────── normalising ───────────────────────────── */
export function isAppError(error) {
    return error instanceof AppError;
}
function fieldErrorsFromZod(issues) {
    return issues.map((issue) => ({
        path: issue.path.join('.') || '(body)',
        message: issue.message,
    }));
}
/**
 * Convert anything thrown anywhere into an `AppError`. Keeping the mapping in one
 * function is what stops a Mongoose cast failure or a Zod failure from reaching
 * the client as an opaque 500.
 */
export function toAppError(error) {
    if (isAppError(error))
        return error;
    if (error && typeof error === 'object') {
        const e = error;
        // Zod
        if (e.name === 'ZodError' && Array.isArray(e.issues)) {
            return new ValidationError('Some fields need attention.', fieldErrorsFromZod(e.issues), error);
        }
        // Mongo duplicate key
        if (e.code === 11000 || e.code === '11000') {
            const keys = Object.keys(e.keyValue ?? {});
            const fields = keys.map((path) => ({ path, message: 'Already in use.' }));
            const label = keys.length ? keys.join(', ') : 'value';
            return new DuplicateError(`That ${label} is already in use.`, fields);
        }
        // Mongoose document validation
        if (e.name === 'ValidationError' && e.errors) {
            const fields = Object.entries(e.errors).map(([path, detail]) => ({
                path: detail.path ?? path,
                message: detail.message ?? 'Invalid value.',
            }));
            return new ValidationError('Some fields need attention.', fields, error);
        }
        // Mongoose cast failure — a bad ObjectId in a path parameter, most often
        if (e.name === 'CastError') {
            // A malformed id can only ever refer to a record that does not exist.
            if (e.kind === 'ObjectId')
                return new NotFoundError('Resource');
            return new ValidationError('A value in the request had the wrong type.', e.path ? [{ path: e.path, message: 'Invalid value.' }] : undefined, error);
        }
        // jsonwebtoken
        if (e.name === 'TokenExpiredError')
            return new TokenExpiredError();
        if (e.name === 'JsonWebTokenError' || e.name === 'NotBeforeError') {
            return new TokenInvalidError('Invalid or malformed token.', error);
        }
        // Mongo/Mongoose connectivity
        if (e.name === 'MongoNetworkError' ||
            e.name === 'MongoServerSelectionError' ||
            e.name === 'MongoTimeoutError' ||
            e.name === 'MongooseError') {
            return new DatabaseError('The database is unavailable.', error);
        }
        // multer / body-parser limits
        if (e.code === 'LIMIT_FILE_SIZE' ||
            e.name === 'PayloadTooLargeError' ||
            e.code === 'entity.too.large') {
            return new UploadRejectedError('That upload is too large.');
        }
        if (e.code === 'LIMIT_UNEXPECTED_FILE') {
            return new UploadRejectedError('Unexpected file field in the upload.');
        }
        // Malformed JSON body
        if (e.name === 'SyntaxError' && typeof e.message === 'string' && 'body' in e) {
            return new ValidationError('The request body is not valid JSON.', undefined, error);
        }
    }
    const message = error instanceof Error ? error.message : String(error);
    return new InternalError(message || 'Something went wrong on our side.', error);
}
/* ──────────────────────────────── assertions ───────────────────────────── */
/**
 * Turn a possibly-missing lookup into a typed value or a 404. Services call this
 * after a *scoped* query — that ordering is what hides existence from someone who
 * is not allowed to know.
 */
export function assertFound(value, resource, identifier) {
    if (value === null || value === undefined)
        throw new NotFoundError(resource, identifier);
    return value;
}
/** Guard a business rule with a 409. */
export function assertState(condition, message, meta) {
    if (!condition)
        throw new ConflictError(message, meta);
}
/** Guard an authorisation rule with a 403. Prefer `assertFound` for reads. */
export function assertAllowed(condition, message) {
    if (!condition)
        throw new ForbiddenError(message);
}
/**
 * Optimistic concurrency, shared by every mutable resource: pass the client's
 * `version` and the stored document's.
 */
export function assertVersion(expected, actual, resource = 'record') {
    if (expected === undefined) {
        throw new ValidationError('This update is missing the `version` field.', [
            { path: 'version', message: 'Required, so concurrent edits can be detected.' },
        ]);
    }
    if (expected !== actual)
        throw new VersionConflictError(actual, resource);
}
