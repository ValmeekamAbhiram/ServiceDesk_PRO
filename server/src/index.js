/**
 * ServiceDesk Pro — server entry point.
 *
 * Boot order matters: the database connects *before* the port opens, so a request
 * can never arrive at a handler that has no connection to query. Anything that
 * fails during boot is fatal and exits non-zero — a half-started API that returns
 * 503 forever is harder to diagnose than a process that refused to start.
 */
import http from 'node:http';
import { connectDb, disconnectDb, syncIndexes } from '@/config/db';
import { env } from '@/config/env';
import { logger, logStartupWarnings, withQuietLogs } from '@/config/logger';
import { createApp } from '@/app';
import { attachSocketServer, closeSocketServer } from '@/realtime/socket';
import { startSlaMonitor, stopSlaMonitor } from '@/modules/sla/sla-monitor';
const log = logger.child({ module: 'bootstrap' });
/**
 * Populate an ephemeral database before the port opens.
 *
 * `USE_IN_MEMORY_DB=auto` exists so a fresh clone runs with no MongoDB installed.
 * That fallback only delivers a working application if something puts users in it:
 * an empty database has no account to sign in as, and `npm run seed` cannot help —
 * it is a separate process, so it would start its own in-memory MongoDB, seed that,
 * and throw it away on exit. It refuses to run for exactly that reason. So the boot
 * that owns the ephemeral instance is the only place the data can come from.
 *
 * Deliberately smaller than `npm run seed` against a real mongod: this runs on every
 * restart, and a few seconds of `tsx watch` latency is worth more than the extra
 * history. Point `MONGO_URI` at a real MongoDB and seed it once for the full set.
 *
 * Imported lazily so the seeder — and the faker-shaped data it carries — is never
 * loaded by a production boot, which cannot reach this branch anyway.
 */
async function seedEphemeralDatabase() {
    const { runSeed, optionsFromEnv } = await import('@/seed/seed');
    await syncIndexes();
    /* Quiet, because the seeder goes through the real services and would otherwise
     * write a few hundred "created" lines over the two things a developer actually
     * needs from this boot: the port and the demo credentials. */
    const result = await withQuietLogs(() => runSeed(optionsFromEnv({
        reset: true,
        ticketCount: Math.min(env.SEED_TICKET_COUNT, 40),
        assetCount: Math.min(env.SEED_ASSET_COUNT, 20),
        monthsOfHistory: Math.min(env.SEED_MONTHS_OF_HISTORY, 2),
    })));
    log.info({ ...result.counts, durationMs: result.durationMs }, 'Seeded the in-memory database with demo data');
    /* The password is the one from `.env`, and it is printed for the same reason the
     * seeder prints it: an account nobody can sign in to is not a demo. Development
     * only — `env.ts` refuses to start production while the development secrets and
     * this password are in place. */
    for (const login of result.logins) {
        log.info(`  ${login.role.padEnd(10)} ${login.email}  /  ${env.SEED_PASSWORD}`);
    }
}
async function main() {
    logStartupWarnings();
    const db = await connectDb();
    log.info({ kind: db.kind, target: db.target, ephemeral: db.ephemeral }, 'Database connected');
    if (db.ephemeral && !env.isProduction)
        await seedEphemeralDatabase();
    const server = http.createServer(createApp());
    /* Attached before the port opens: a socket that connected in the window between
     * `listen()` and this line would be handled by nothing. */
    const io = attachSocketServer(server);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(env.PORT, () => resolve());
    });
    log.info({ port: env.PORT, env: env.NODE_ENV, demoMode: env.demoMode, version: env.appVersion }, `ServiceDesk Pro API listening on ${env.SERVER_URL}`);
    /* After the port, not before: the first sweep is a minute away and nothing about
     * serving requests depends on it, so a slow first query cannot delay the boot. */
    startSlaMonitor();
    /*
     * One shutdown path for both signals. Stop accepting connections first, then
     * close the database, so an in-flight request finishes against a live
     * connection rather than throwing on a socket that has already gone.
     */
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        log.info({ signal }, 'Shutting down');
        /* First, so a sweep cannot start writing to a connection that is about to close. */
        stopSlaMonitor();
        const forceExit = setTimeout(() => {
            log.warn('Graceful shutdown timed out — exiting');
            process.exit(1);
        }, 10_000);
        forceExit.unref();
        /*
         * Closing the real-time channel is the whole HTTP shutdown too: `io.close()`
         * disconnects every socket, then closes the server it was attached to and waits
         * for in-flight requests to drain. So there is no `server.close()` here — that
         * would be a second close of a closed server. The order still matters for the
         * original reason: websockets are kicked before the drain starts, because a
         * websocket never ends on its own and would otherwise hold shutdown open until
         * the force-exit timer fired.
         *
         * The database closes even if the channel did not, hence `then` rather than a
         * chain that a rejection would skip.
         */
        void closeSocketServer(io)
            .catch((error) => log.error({ err: error }, 'Error closing the real-time channel'))
            .then(() => disconnectDb())
            .catch((error) => log.error({ err: error }, 'Error closing the database'))
            .finally(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch((error) => {
    logger.fatal({ err: error }, 'Failed to start');
    process.exit(1);
});
