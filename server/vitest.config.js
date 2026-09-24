import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dirname = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
    resolve: {
        alias: {
            '@shared': path.resolve(dirname, '../shared/src'),
            '@': path.resolve(dirname, './src'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        // Tests assert on behaviour, not on log output; a full pino stream per test
        // makes a failure impossible to read.
        // `UPLOAD_DIR` is set here rather than in a test file because
        // `upload.middleware.ts` reads `env.uploadDir` and creates the directory at
        // module load, which happens before any test body runs. Without this, the
        // upload suite would write into the real `uploads/` directory.
        env: {
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            LOG_PRETTY: 'false',
            UPLOAD_DIR: 'uploads-test',
        },
        include: ['src/**/*.{test,spec}.js'],
        exclude: ['node_modules', 'dist'],
        // Integration specs boot an in-memory MongoDB; give them room.
        testTimeout: 60_000,
        hookTimeout: 120_000,
        // The SLA engine and scoring suites are pure and parallel-safe; the
        // integration suites share one in-memory Mongo instance, so they are
        // pinned to a single fork by `sequence.concurrent: false`.
        pool: 'forks',
        poolOptions: { forks: { singleFork: true } },
        sequence: { concurrent: false },
        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage',
            include: ['src/core/**', 'src/modules/**/*.service.js', 'src/ai/**'],
            exclude: ['src/**/*.test.js', 'src/seed/**'],
            thresholds: {
                // The pure business-logic core is the part that must stay covered.
                'src/core/**': { statements: 80, branches: 70, functions: 80, lines: 80 },
            },
        },
    },
});
