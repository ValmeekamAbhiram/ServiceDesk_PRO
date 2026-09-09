/**
 * ServiceDesk Pro — MongoDB connection.
 *
 * The whole app talks to one Mongoose connection created here. The interesting
 * part is `USE_IN_MEMORY_DB=auto` (the default in `.env.example`):
 *
 *   auto   → try the real `MONGO_URI` first; if nothing is listening, fall back
 *            to an ephemeral in-process MongoDB and say so loudly.
 *   always → skip the probe, go straight to in-memory (fast test runs).
 *   never  → real Mongo or fail. Forced in production by `config/env.ts`.
 *
 * The fallback exists because §71 requires "application works after fresh
 * setup", and a reviewer cloning this repo may not have `mongod` installed or
 * Docker running. It is still MongoDB — `mongodb-memory-server` downloads and
 * runs a genuine mongod binary — so queries, indexes, text search and
 * aggregation pipelines all behave identically. The only difference is that the
 * data lives in a temp directory and disappears when the process exits, which is
 * exactly why `config/env.ts` refuses to allow it in production.
 */

import mongoose from 'mongoose';
import net from 'node:net';
import { env } from '@/config/env';
import { moduleLogger } from '@/config/logger';

const log = moduleLogger('db');

export type DbKind = 'external' | 'in-memory';

export interface DbConnectionInfo {
  kind: DbKind;
  /** Host and database name only — never the full URI, which may hold credentials. */
  target: string;
  ephemeral: boolean;
}

let connectionInfo: DbConnectionInfo | null = null;
/** Held so `disconnectDb()` can shut the in-process server down cleanly. */
let memoryServer: { getUri(): string; stop(): Promise<boolean | void> } | null = null;

/* ──────────────────────────── mongoose defaults ─────────────────────────── */

/**
 * Applied here and, deliberately, from `src/test/db.ts` as well. The test harness
 * opens its own connection and so does not import this module; when the two
 * diverged, every suite passed against a configuration production did not use.
 *
 * `strictQuery` is `'throw'`, not `true`. Both keep a typo'd filter key out of the
 * query, but `true` does it by *stripping* the key — so a filter for
 * `{ assigneeId: x }` when the field is `assignee` becomes `{}` and returns the
 * entire collection. In an application whose read authorization is a filter
 * (`scopeFilter()` adds `requesterId` for anyone without `TICKET_READ_ALL`) that is
 * not a bug, it is an authorization bypass one typo deep. `'throw'` raises a
 * `StrictModeError` instead, which is a 500 — the correct outcome for a mistake in
 * our own query, and one nobody can miss.
 *
 * `sanitizeFilter` is deliberately **not** set. It defends against an unvalidated
 * request object reaching a filter — the classic `{"email": {"$ne": null}}` login
 * bypass — by wrapping any `$`-keyed object in `$eq`. The catch is that it cannot
 * tell an attacker's operator object from one this codebase wrote itself, so it
 * also rewrites `{ _id: { $in: ids } }` into `{ _id: { $eq: { $in: ids } } }`.
 * On an ObjectId path that throws a CastError, which `toAppError` turns into a
 * 404; on a string or date path it throws nothing and quietly matches zero
 * documents, which is the worse of the two. Status filters, date ranges and
 * `$text` search all fail that way — silently.
 *
 * The defence it offers is already present, earlier and stronger: `validate()`
 * parses every body, query and param through a Zod schema before a service sees
 * it, and ids go through `toObjectId()`. A nested object cannot survive
 * `z.string()`. Turning the flag back on would mean wrapping all eleven
 * first-party operator filters in `mongoose.trusted()` and remembering to do so
 * for every query written from now on — where the price of forgetting is a
 * silently empty result rather than an error. See `sanitize-filter.test.ts`.
 */
export function applyMongooseDefaults(): void {
  mongoose.set('strictQuery', 'throw');
  mongoose.set('id', false);
}

applyMongooseDefaults();

if (env.isDevelopment && env.LOG_LEVEL === 'trace') {
  mongoose.set('debug', (collection: string, method: string) => {
    log.trace({ collection, method }, 'mongo op');
  });
}

/* ──────────────────────────────── helpers ──────────────────────────────── */

/** Redact credentials before a URI is allowed anywhere near a log line. */
export function describeUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    const db = parsed.pathname.replace(/^\//, '') || '(default)';
    return `${parsed.hostname}:${parsed.port || '27017'}/${db}`;
  } catch {
    return '(unparsable mongo uri)';
  }
}

/**
 * Cheap TCP probe so `auto` mode does not wait out Mongo's full server-selection
 * timeout before falling back. 800ms is generous for localhost and short enough
 * that boot never feels stalled.
 */
function probeTcp(uri: string, timeoutMs = 800): Promise<boolean> {
  let host = '127.0.0.1';
  let port = 27017;
  try {
    const parsed = new URL(uri);
    if (parsed.hostname) host = parsed.hostname;
    if (parsed.port) port = Number(parsed.port);
  } catch {
    return Promise.resolve(false);
  }
  // A replica-set or Atlas URI can't be probed this way; let Mongoose try it.
  if (uri.startsWith('mongodb+srv://') || uri.includes(',')) return Promise.resolve(true);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function startMemoryServer(): Promise<string> {
  // Imported lazily and by name so a production install without devDependencies
  // never has to resolve this module.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create({
    instance: { dbName: 'servicedesk_pro' },
  });
  memoryServer = server;
  return server.getUri();
}

/* ──────────────────────────────── lifecycle ─────────────────────────────── */

export async function connectDb(): Promise<DbConnectionInfo> {
  if (connectionInfo && mongoose.connection.readyState === 1) return connectionInfo;

  const options: mongoose.ConnectOptions = {
    // Short, because in `auto` mode a failure here is a fallback signal, not a
    // fatal error. Production uses `never`, where the retry loop below applies.
    serverSelectionTimeoutMS: env.inMemoryDb === 'auto' ? 3_000 : 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    autoIndex: !env.isProduction,
    retryWrites: true,
  };

  if (env.inMemoryDb === 'always') {
    const uri = await startMemoryServer();
    await mongoose.connect(uri, { ...options, autoIndex: true });
    connectionInfo = { kind: 'in-memory', target: describeUri(uri), ephemeral: true };
    log.warn(
      'Using an in-process MongoDB (USE_IN_MEMORY_DB=true). All data is discarded when this process exits.'
    );
    attachConnectionHandlers();
    return connectionInfo;
  }

  const reachable = env.inMemoryDb === 'never' ? true : await probeTcp(env.MONGO_URI);

  if (reachable) {
    try {
      await mongoose.connect(env.MONGO_URI, options);
      connectionInfo = {
        kind: 'external',
        target: describeUri(env.MONGO_URI),
        ephemeral: false,
      };
      log.info({ target: connectionInfo.target }, 'Connected to MongoDB');
      attachConnectionHandlers();
      return connectionInfo;
    } catch (error) {
      if (env.inMemoryDb === 'never') throw error;
      log.warn(
        { target: describeUri(env.MONGO_URI), err: error },
        'Could not connect to MongoDB; falling back to an in-process instance.'
      );
    }
  } else {
    log.warn(
      { target: describeUri(env.MONGO_URI) },
      'Nothing is listening on MONGO_URI; falling back to an in-process MongoDB.'
    );
  }

  const uri = await startMemoryServer();
  await mongoose.connect(uri, { ...options, autoIndex: true });
  connectionInfo = { kind: 'in-memory', target: describeUri(uri), ephemeral: true };
  log.warn(
    'Running on an ephemeral in-process MongoDB. Data will NOT survive a restart; ' +
      'demo data is re-seeded on every boot. Start a real mongod and set MONGO_URI to keep it.'
  );
  attachConnectionHandlers();
  return connectionInfo;
}

let handlersAttached = false;

function attachConnectionHandlers(): void {
  if (handlersAttached) return;
  handlersAttached = true;

  mongoose.connection.on('error', (error: unknown) => {
    log.error({ err: error }, 'MongoDB connection error');
  });
  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    log.info('MongoDB reconnected');
  });
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  connectionInfo = null;
  handlersAttached = false;
}

export function getDbInfo(): DbConnectionInfo | null {
  return connectionInfo;
}

/**
 * For `src/test/db.ts`, which opens its own connection and therefore never runs the
 * code above that records what it connected to. Without this, `dbHealth()` answers
 * `kind: null` under test and a real kind in production — the same shape of
 * divergence that `applyMongooseDefaults()` exists to close, and a health check that
 * behaves differently in the suite than in the deployment is not worth much.
 */
export function registerTestConnection(target: string | null): void {
  connectionInfo = target
    ? { kind: 'in-memory', target: describeUri(target), ephemeral: true }
    : null;
}

/** Becomes `HealthDto.db` on the health endpoint. */
export function dbHealth(): { status: 'up' | 'down' | 'degraded'; kind: DbKind | null } {
  const state = mongoose.connection.readyState;
  const status = state === 1 ? 'up' : state === 2 ? 'degraded' : 'down';
  return { status, kind: connectionInfo?.kind ?? null };
}

/**
 * Build every index declared on every registered model. Called at boot in
 * development and by the seeder; skipped in production, where indexes should be
 * created deliberately rather than on process start.
 */
export async function syncIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);
  await Promise.all(names.map((name) => mongoose.models[name]?.createIndexes()));
  log.info({ models: names.length }, 'Indexes synchronised');
}
