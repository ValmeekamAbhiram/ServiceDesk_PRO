/**
 * ServiceDesk Pro — seed CLI.
 *
 * `npm run seed` on an empty database, `npm run seed:reset` to replace what is there,
 * `npm run seed:minimal` for accounts and categories with no history.
 *
 * ## The two refusals
 * This script will not run against production, and it will not run against the in-memory
 * database. The first is obvious: it creates fourteen accounts that share one published
 * password. The second is less obvious and just as important — `mongodb-memory-server`
 * discards everything when the process exits, so seeding it would spend two minutes
 * building a dataset that is deleted before anyone can look at it. Both refusals exit
 * non-zero and say what to change, because a seeder that silently does nothing is worse
 * than one that fails.
 *
 * ## Why the password is printed
 * At the end this prints three email addresses and the shared password in plain text.
 * That is deliberate. The alternative — a password that only exists in `.env` — makes the
 * first five minutes of using the application a hunt through configuration files. The
 * mitigation is not secrecy, it is the refusal above: these credentials cannot exist in a
 * production database, so printing them costs nothing.
 */
import { connectDb, disconnectDb, syncIndexes } from '@/config/db';
import { env } from '@/config/env';
import { optionsFromEnv, runSeed } from '@/seed/seed';
/* Plain `console` and not the application logger, on purpose: this is a person reading a
 * terminal, not a log aggregator reading JSON. The logger still records the run's progress
 * from inside `seed.ts`; this is the part meant to be read. */
const out = (line = '') => {
    process.stdout.write(`${line}\n`);
};
function parseArgs(argv) {
    const overrides = {};
    const problems = [];
    let help = false;
    /* `--tickets` with no value gives `Number(undefined)` -> NaN, which would otherwise reach
     * `Array.from({ length: NaN })` and seed zero tickets while reporting success. */
    const count = (flag, value) => {
        const parsed = Number(value);
        if (value === undefined || !Number.isInteger(parsed) || parsed < 0) {
            problems.push(`${flag} needs a whole number, as in ${flag}=40`);
            return undefined;
        }
        return parsed;
    };
    for (const arg of argv) {
        const [flag, value] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
        switch (flag) {
            case '--reset':
                overrides.reset = true;
                break;
            case '--minimal':
                overrides.minimal = true;
                break;
            case '--tickets':
                overrides.ticketCount = count(flag, value) ?? overrides.ticketCount;
                break;
            case '--months':
                overrides.monthsOfHistory = count(flag, value) ?? overrides.monthsOfHistory;
                break;
            case '--seed':
                overrides.rngSeed = count(flag, value) ?? overrides.rngSeed;
                break;
            case '--help':
            case '-h':
                help = true;
                break;
            default:
                problems.push(`unrecognised option ${arg}`);
        }
    }
    return { overrides, help, problems };
}
const USAGE = `
ServiceDesk Pro — database seeder

  npm run seed              populate an empty database
  npm run seed:reset        delete everything, then populate
  npm run seed:minimal      accounts, categories and the SLA policy only

Options
  --reset                   replace existing data instead of refusing
  --minimal                 skip assets, articles and ticket history
  --tickets=<n>             how many tickets to build (default ${env.SEED_TICKET_COUNT})
  --months=<n>              how far back the history reaches (default ${env.SEED_MONTHS_OF_HISTORY})
  --seed=<n>                change the random seed; the same value gives the same data
  -h, --help                show this
`.trim();
function summarise(label, value) {
    return `  ${label.padEnd(16)}${String(value).padStart(5)}`;
}
async function main() {
    const { overrides, help, problems } = parseArgs(process.argv.slice(2));
    if (help) {
        out(USAGE);
        return;
    }
    if (problems.length > 0) {
        out(`Cannot seed: ${problems.join('; ')}.`);
        out();
        out(USAGE);
        process.exitCode = 1;
        return;
    }
    /* Refused before the connection opens, so a production URI is never even dialled. */
    if (env.isProduction) {
        out('Refusing to seed: NODE_ENV is production.');
        out('These accounts share one published password and must not exist in a real database.');
        process.exitCode = 1;
        return;
    }
    const options = optionsFromEnv(overrides);
    const db = await connectDb();
    try {
        if (db.ephemeral) {
            out(`Refusing to seed: the database is in-memory (${db.target}) and is discarded on exit.`);
            out('Point MONGO_URI at a real MongoDB, and set USE_IN_MEMORY_DB=false so it cannot fall back.');
            process.exitCode = 1;
            return;
        }
        /* Indexes before data. The compound and text indexes are what make the seeded search
         * and filter screens work; building them afterwards would leave the first person to
         * open the ticket list waiting on a collection scan. */
        await syncIndexes();
        out();
        out(`Seeding ${db.target} (${db.kind})`);
        if (options.minimal)
            out('Minimal run — no assets, articles or tickets.');
        out();
        const result = await runSeed(options);
        out('Written');
        out(summarise('users', result.counts.users));
        out(summarise('categories', result.counts.categories));
        out(summarise('assets', result.counts.assets));
        out(summarise('articles', result.counts.articles));
        out(summarise('tickets', result.counts.tickets));
        out(summarise('comments', result.counts.comments));
        out(summarise('notifications', result.counts.notifications));
        out();
        out(`Finished in ${(result.durationMs / 1000).toFixed(1)}s`);
        out();
        out('Sign in with');
        for (const login of result.logins) {
            out(`  ${login.role.padEnd(11)} ${login.email.padEnd(30)} ${login.name}`);
        }
        out();
        out(`  password     ${options.password}`);
        out();
        out('  Development credentials. Change them before this database is ever exposed.');
        out();
    }
    catch (error) {
        /* The message, not the stack. Every throw the seeder can reach a person with — a
         * populated database without `--reset`, a missing category, a bcrypt failure — is
         * already a sentence written for this moment. A stack trace here would bury it. */
        out();
        out(`Seeding failed: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack && env.LOG_LEVEL === 'debug') {
            out(error.stack);
        }
        process.exitCode = 1;
    }
    finally {
        await disconnectDb();
    }
}
void main();
