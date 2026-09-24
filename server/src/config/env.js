/**
 * ServiceDesk Pro — environment configuration.
 *
 * Parsed, validated and frozen exactly once at import time so a typo in `.env`
 * fails the boot with a readable message instead of surfacing as `undefined`
 * three layers deep. Every value has a working local default, which is what
 * makes `git clone && npm run setup && npm run dev` work with no configuration.
 *
 * Rules enforced here:
 *  - Secrets are never logged and never leave this module (see `publicConfig()`).
 *  - The development JWT secrets are refused outright in production.
 *  - Demo mode (Time Machine, reseed endpoints) is forced off in production —
 *    those controls must never be reachable by real users.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `<repo>/server` */
export const SERVER_ROOT = path.resolve(HERE, '../..');
/** `<repo>` */
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
/*
 * Precedence: real process env  >  server/.env  >  <repo>/.env
 * dotenv never overwrites an already-set key, so loading the most specific file
 * first gives exactly that ordering.
 */
for (const candidate of [
    path.join(SERVER_ROOT, '.env'),
    path.join(REPO_ROOT, '.env'),
]) {
    if (fs.existsSync(candidate))
        dotenv.config({ path: candidate });
}
/* ────────────────────────── raw value normalisation ─────────────────────── */
/**
 * Values that may legitimately contain `#`, quotes or leading/trailing spaces.
 * These are passed through untouched; everything else is trimmed and has any
 * trailing ` # comment` removed, because `.env.example` documents several keys
 * with inline comments and users copy it verbatim.
 */
const VERBATIM_KEYS = new Set([
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'AI_API_KEY',
    'SEED_PASSWORD',
    'MONGO_URI',
]);
function normaliseRawEnv(source) {
    const out = {};
    for (const [key, raw] of Object.entries(source)) {
        if (raw === undefined)
            continue;
        let value = raw;
        if (!VERBATIM_KEYS.has(key)) {
            value = value.replace(/\s+#.*$/, '').trim();
        }
        // An empty value means "not configured" — drop it so zod defaults apply.
        if (value === '')
            continue;
        out[key] = value;
    }
    return out;
}
/* ─────────────────────────────── zod helpers ────────────────────────────── */
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'n', 'off']);
/** Accepts `true/false/1/0/yes/no/on/off`, any casing, with a typed default. */
function zBool(defaultValue) {
    return z.preprocess((v) => {
        if (v === undefined)
            return defaultValue;
        if (typeof v === 'boolean')
            return v;
        const s = String(v).trim().toLowerCase();
        if (TRUTHY.has(s))
            return true;
        if (FALSY.has(s))
            return false;
        return v; // fall through to a proper "expected boolean" error
    }, z.boolean());
}
/**
 * Case-insensitive enum with a default, so `LOG_LEVEL=INFO` works.
 *
 * The `const` type parameter is load-bearing. Without it, the contextual type
 * that `z.object({ ... })` imposes on its shape (`ZodTypeAny`) participates in
 * inference and collapses the tuple members to `string` — so `env.AI_PROVIDER`
 * would come out as `string` instead of its four-member union, and every
 * downstream narrowing would silently stop working.
 */
function zLowerEnum(values, defaultValue) {
    return z.preprocess((v) => (v === undefined ? defaultValue : String(v).trim().toLowerCase()), z.enum(values));
}
/** Comma-separated list -> trimmed, de-duplicated string array. */
function zCsv() {
    return z.preprocess((v) => {
        if (v === undefined)
            return [];
        if (Array.isArray(v))
            return v;
        return Array.from(new Set(String(v)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)));
    }, z.array(z.string()));
}
/** A `15m` / `7d` / `900s` style duration accepted by `jsonwebtoken`. */
const zDuration = z
    .string()
    .regex(/^\d+\s*(ms|s|m|h|d|w|y)$/i, 'expected a duration like "15m", "7d" or "30s"');
/**
 * Convert a validated duration string into whole seconds.
 *
 * Duration strings are the right thing in a `.env` file — `15m` is readable and
 * hard to mistype by an order of magnitude, which `900` is not. But every consumer
 * (token expiry, TTL indexes, cookie `maxAge`) wants a number, and parsing the
 * string at each of those call sites is how one of them ends up treating minutes as
 * seconds. So it is parsed exactly once, here, and exported as derived numbers.
 *
 * The regex above has already guaranteed the shape, so this cannot fail.
 */
const DURATION_UNIT_SECONDS = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3_600,
    d: 86_400,
    w: 604_800,
    y: 31_536_000,
};
function durationToSeconds(duration) {
    const match = /^(\d+)\s*(ms|s|m|h|d|w|y)$/i.exec(duration.trim());
    if (!match)
        return 0;
    const amount = Number(match[1]);
    const unit = (match[2] ?? 's').toLowerCase();
    return Math.round(amount * (DURATION_UNIT_SECONDS[unit] ?? 1));
}
/* ──────────────────────────────── schema ───────────────────────────────── */
const EnvSchema = z.object({
    /* Runtime */
    NODE_ENV: zLowerEnum(['development', 'production', 'test'], 'development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    SERVER_URL: z.string().url().default('http://localhost:5000'),
    CLIENT_URL: z.string().url().default('http://localhost:5173'),
    CORS_EXTRA_ORIGINS: zCsv(),
    /* Database */
    MONGO_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/servicedesk_pro'),
    USE_IN_MEMORY_DB: zLowerEnum(['auto', 'true', 'false'], 'auto'),
    /* Auth */
    JWT_SECRET: z
        .string()
        .min(16, 'JWT_SECRET must be at least 16 characters')
        .default('dev-only-access-secret-change-me-0123456789abcdef'),
    JWT_REFRESH_SECRET: z
        .string()
        .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters')
        .default('dev-only-refresh-secret-change-me-fedcba9876543210'),
    JWT_ACCESS_TTL: zDuration.default('15m'),
    JWT_REFRESH_TTL: zDuration.default('7d'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
    /* Demo mode / Time Machine */
    DEMO_MODE: zBool(true),
    DEMO_BANNER: zBool(true),
    /* SLA engine */
    BUSINESS_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
    SLA_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
    /* Ticket suggestions. With no key, the offline classifier is used. */
    AI_PROVIDER: zLowerEnum(['auto', 'anthropic', 'heuristic'], 'auto'),
    AI_API_KEY: z.string().default(''),
    AI_MODEL: z.string().default('claude-sonnet-5'),
    AI_MAX_TOKENS: z.coerce.number().int().min(64).max(8_000).default(800),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
    AI_ENABLED: zBool(true),
    /* Uploads — local disk only, via multer. */
    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
    /* Rate limits */
    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(600),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(3).default(20),
    AI_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
    /* Observability */
    LOG_LEVEL: zLowerEnum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'], 'info'),
    LOG_PRETTY: zBool(true),
    /* Seed / demo credentials */
    SEED_PASSWORD: z.string().min(6).default('Passw0rd!'),
    SEED_TICKET_COUNT: z.coerce.number().int().min(0).max(5_000).default(120),
    SEED_ASSET_COUNT: z.coerce.number().int().min(0).max(2_000).default(40),
    SEED_USER_COUNT: z.coerce.number().int().min(1).max(500).default(14),
    SEED_MONTHS_OF_HISTORY: z.coerce.number().int().min(1).max(24).default(3),
});
/* ────────────────────────────── parse & derive ─────────────────────────── */
function fail(issues) {
    const lines = issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\n\n` +
        `Compare your .env against .env.example, or delete .env to use the defaults.`);
}
const parsed = EnvSchema.safeParse(normaliseRawEnv(process.env));
if (!parsed.success)
    fail(parsed.error.issues);
const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';
const isTest = raw.NODE_ENV === 'test';
const isDevelopment = raw.NODE_ENV === 'development';
/** Non-fatal problems worth shouting about; logged by `index.ts` at boot. */
const warnings = [];
const DEV_SECRET_MARKERS = ['dev-only', 'change-me', 'changeme', 'secret-here'];
function looksLikeDevSecret(secret) {
    const s = secret.toLowerCase();
    return DEV_SECRET_MARKERS.some((marker) => s.includes(marker));
}
if (isProduction) {
    const offenders = [];
    if (looksLikeDevSecret(raw.JWT_SECRET))
        offenders.push('JWT_SECRET');
    if (looksLikeDevSecret(raw.JWT_REFRESH_SECRET))
        offenders.push('JWT_REFRESH_SECRET');
    if (offenders.length) {
        throw new Error(`Refusing to start in production with the development ${offenders.join(' and ')}. ` +
            `Generate real values:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
    }
    if (raw.JWT_SECRET === raw.JWT_REFRESH_SECRET) {
        throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must differ — a leaked access token must not be usable as a refresh token.');
    }
    if (raw.USE_IN_MEMORY_DB === 'true') {
        throw new Error('USE_IN_MEMORY_DB=true cannot be used in production: all data is lost when the process exits. Set MONGO_URI instead.');
    }
}
else if (raw.JWT_SECRET === raw.JWT_REFRESH_SECRET) {
    warnings.push('JWT_SECRET and JWT_REFRESH_SECRET are identical — fine for local dev, never for production.');
}
/**
 * The Time Machine and the reseed endpoint are destructive demo controls. They are
 * gated on this single flag, which production can never turn on.
 */
const demoMode = raw.DEMO_MODE && !isProduction;
if (raw.DEMO_MODE && isProduction) {
    warnings.push('DEMO_MODE=true was ignored: demo controls are permanently disabled in production.');
}
/** In-memory Mongo is a dev/demo convenience only. */
const inMemoryDb = isProduction
    ? 'never'
    : raw.USE_IN_MEMORY_DB === 'true'
        ? 'always'
        : raw.USE_IN_MEMORY_DB === 'false'
            ? 'never'
            : 'auto';
/**
 * Effective suggestion provider. An empty key can only ever mean the offline
 * classifier, and the resolution happens here, once — so no service has to decide
 * for itself whether it is allowed to make a network call.
 */
const aiHasKey = raw.AI_API_KEY.trim().length > 0;
const aiProvider = raw.AI_ENABLED && raw.AI_PROVIDER !== 'heuristic' && aiHasKey ? 'anthropic' : 'heuristic';
if (raw.AI_ENABLED && raw.AI_PROVIDER !== 'heuristic' && !aiHasKey) {
    warnings.push('AI_API_KEY is empty — ticket suggestions will use the offline keyword classifier.');
}
/** Absolute upload root; relative values resolve against `server/`. */
const uploadDir = path.isAbsolute(raw.UPLOAD_DIR)
    ? raw.UPLOAD_DIR
    : path.resolve(SERVER_ROOT, raw.UPLOAD_DIR);
const corsOrigins = Array.from(new Set([raw.CLIENT_URL, ...raw.CORS_EXTRA_ORIGINS]));
export function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    if (corsOrigins.includes(origin))
        return true;
    if (/^https:\/\/[a-z0-9-]+(\.vercel\.app|\.onrender\.com)$/i.test(origin))
        return true;
    if (!isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
        return true;
    return false;
}
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'));
        return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/* ─────────────────────────────── public API ────────────────────────────── */
export const env = Object.freeze({
    ...raw,
    /* derived runtime flags */
    isProduction,
    isDevelopment,
    isTest,
    appVersion: readPackageVersion(),
    repoRoot: REPO_ROOT,
    serverRoot: SERVER_ROOT,
    /* derived, sanitised feature configuration */
    demoMode,
    inMemoryDb,
    aiProvider,
    aiConfigured: aiHasKey,
    uploadDir,
    corsOrigins,
    maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
    rateLimitWindowMs: raw.RATE_LIMIT_WINDOW_MINUTES * 60_000,
    /* Durations, parsed once. See `durationToSeconds`. */
    accessTokenTtlSeconds: durationToSeconds(raw.JWT_ACCESS_TTL),
    refreshTokenTtlSeconds: durationToSeconds(raw.JWT_REFRESH_TTL),
    /** Non-fatal configuration problems, logged once at boot. */
    warnings: Object.freeze(warnings),
});
/**
 * The subset of configuration that is safe to expose over HTTP (`/api/health`) and to
 * write to logs. Secrets are deliberately absent — there is no code path that
 * serialises `env` wholesale.
 *
 * The return type is the shared DTO rather than `Record<string, unknown>`: this object
 * is spread into a public HTTP response, and a typo in a key there is a silently
 * missing field.
 */
export function publicConfig() {
    return {
        nodeEnv: env.NODE_ENV,
        version: env.appVersion,
        demoMode: env.demoMode,
        timezone: env.BUSINESS_TIMEZONE,
        aiEnabled: env.AI_ENABLED,
        aiProvider: env.aiProvider,
        maxUploadMb: env.MAX_UPLOAD_MB,
    };
}
