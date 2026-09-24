/**
 * ServiceDesk Pro — structured logging.
 *
 * One pino instance for the whole process. Two things are deliberate:
 *
 *  1. **Redaction is central, not per-call-site.** `REDACT_PATHS` below strips
 *     passwords, tokens, cookies, API keys and authorization headers before pino
 *     serialises anything. A developer who logs a whole request body six months
 *     from now still cannot leak a credential — the safety does not depend on
 *     them remembering. Values become `[redacted]`, so the *shape* of a payload
 *     is still debuggable while its secrets are not.
 *  2. **Pretty output is dev-only.** In production the transport is plain
 *     newline-delimited JSON on stdout, which is what a log collector wants.
 *
 * Usage: `logger.child({ requestId })` — see `middleware/requestId.ts`. Every
 * request-scoped log line carries its `requestId` so a support question ("what
 * happened to request b3f1…?") is one grep away.
 */
import pino from 'pino';
import { env } from '@/config/env';
/**
 * Paths pino replaces with `[redacted]`.
 *
 * `*` matches one level, so `*.password` covers `req.body.password` and
 * `user.password` alike without enumerating every container. Kept broad on
 * purpose: a false positive costs a debugging inconvenience, a false negative
 * costs a credential in a log file.
 */
const REDACT_PATHS = [
    // Credentials, at any nesting depth we realistically log.
    'password',
    '*.password',
    '*.*.password',
    'currentPassword',
    '*.currentPassword',
    'newPassword',
    '*.newPassword',
    'confirmPassword',
    '*.confirmPassword',
    'passwordHash',
    '*.passwordHash',
    // Tokens and secrets.
    'token',
    '*.token',
    'accessToken',
    '*.accessToken',
    'refreshToken',
    '*.refreshToken',
    'refreshTokenHash',
    '*.refreshTokenHash',
    'resetToken',
    '*.resetToken',
    'verificationToken',
    '*.verificationToken',
    'apiKey',
    '*.apiKey',
    'secret',
    '*.secret',
    'authorization',
    '*.authorization',
    'cookie',
    '*.cookie',
    // Request/response objects serialised by pino-http.
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'req.headers["set-cookie"]',
    'res.headers["set-cookie"]',
    'req.body.password',
    'req.body.currentPassword',
    'req.body.newPassword',
    'req.body.confirmPassword',
    'req.body.token',
    'req.body.refreshToken',
    // Anything that walked in from process env.
    'env.JWT_SECRET',
    'env.JWT_REFRESH_SECRET',
    'env.AI_API_KEY',
    'env.EMBEDDING_API_KEY',
    'env.SMTP_PASSWORD',
    'env.S3_SECRET_ACCESS_KEY',
    'env.MONGO_URI',
];
/**
 * Never log a Mongoose document wholesale — it may carry `passwordHash` and it
 * serialises to hundreds of lines. Log the id, and the fields you actually need.
 */
const baseOptions = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: {
        service: 'servicedesk-api',
        version: env.appVersion,
        env: env.NODE_ENV,
    },
    // ISO timestamps rather than epoch millis: readable in a terminal and sortable
    // in a collector.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => ({ level: label }),
    },
    serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
    },
    hooks: {
        // See `withQuietLogs` below. A no-op unless something has asked for quiet.
        logMethod(args, method, level) {
            if (quietBelow !== null && level < quietBelow)
                return;
            method.apply(this, args);
        },
    },
};
/* ─────────────────────────────── quiet mode ──────────────────────────────── */
let quietBelow = null;
/**
 * Suppress everything below `warn` — on this logger *and every child* — for the
 * duration of `run`.
 *
 * The seeder drives the real services, so it emits one "asset created" /
 * "ticket created" line per row. That is the right behaviour for an application
 * and useless as boot output: a few hundred lines that bury the port number and
 * the demo credentials underneath them.
 *
 * Raising `logger.level` cannot fix it. A pino child captures its parent's level
 * when it is constructed, and every service built its child logger at import
 * time, so a later change to the parent reaches none of them. A `logMethod` hook
 * lives in the options children share, which makes it the one lever that does.
 */
export async function withQuietLogs(run) {
    quietBelow = pino.levels.values.warn;
    try {
        return await run();
    }
    finally {
        quietBelow = null;
    }
}
/**
 * `pino-pretty` is a devDependency, so a production install that skipped dev
 * deps must not crash at boot. If the transport cannot be constructed we fall
 * back to JSON and say so.
 */
function createLogger() {
    const wantsPretty = env.LOG_PRETTY && !env.isProduction;
    if (!wantsPretty)
        return pino(baseOptions);
    try {
        return pino({
            ...baseOptions,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss.l',
                    ignore: 'pid,hostname,service,version,env',
                    messageFormat: '{if requestId}[{requestId}] {end}{msg}',
                    singleLine: false,
                },
            },
        });
    }
    catch {
        const fallback = pino(baseOptions);
        fallback.warn('pino-pretty is unavailable; falling back to JSON logs.');
        return fallback;
    }
}
export const logger = createLogger();
/** Request-scoped child. Every line it writes carries the correlation id. */
export function requestLogger(requestId) {
    return logger.child({ requestId });
}
/**
 * Subsystem-scoped child — `sla`, `socket`, `ai`, `mail`, `seed`. Makes it
 * possible to raise the level for one noisy subsystem without drowning in the
 * rest.
 */
export function moduleLogger(module) {
    return logger.child({ module });
}
/** Written once at boot by `index.ts`, after `env` has been validated. */
export function logStartupWarnings() {
    for (const warning of env.warnings) {
        logger.warn({ configuration: true }, warning);
    }
}
