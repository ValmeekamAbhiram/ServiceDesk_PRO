/**
 * ServiceDesk Pro — the health endpoint.
 *
 * Small surface, two reasons to test it. It is the only route that answers without a
 * credential, so it is the only route where a leaked secret would be readable by
 * anyone who can reach the port: the last test here walks the response and fails if
 * any value looks like one, rather than trusting `publicConfig()` to have been written
 * carefully. And it is consumed by a platform probe rather than by our own client, so
 * nothing else in the suite would notice the shape changing.
 *
 * `degraded` and not a 5xx when the database is down. A probe needs to tell "the
 * process is not listening" apart from "it is listening and cannot serve"; collapsing
 * both into a 503 throws that distinction away.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { advanceMinutes, resetClock } from '@/config/clock';
import { startDb, stopDb } from '@/test/db';
let app;
beforeAll(async () => {
    await startDb();
    app = createApp();
});
afterAll(async () => {
    resetClock();
    await stopDb();
});
const health = () => request(app).get('/api/health');
describe('GET /api/health', () => {
    it('answers without a credential', async () => {
        const response = await health();
        expect(response.status).toBe(200);
    });
    it('reports the database as up while connected', async () => {
        const body = (await health()).body.data;
        expect(body.status).toBe('ok');
        expect(body.db.status).toBe('up');
        expect(body.db.kind).toBeTruthy();
    });
    it('describes the deployment', async () => {
        const body = (await health()).body.data;
        expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(body.nodeEnv).toBe('test');
        expect(body.timezone).toEqual(expect.any(String));
        expect(body.maxUploadMb).toBeGreaterThan(0);
        expect(['gemini', 'anthropic', 'heuristic']).toContain(body.aiProvider);
    });
    it('reports simulated time, so a probe sees the clock the rest of the app sees', async () => {
        const before = new Date((await health()).body.data.time).getTime();
        advanceMinutes(120);
        try {
            const after = new Date((await health()).body.data.time).getTime();
            /* Two hours, less whatever real time passed between the two requests. */
            expect(after - before).toBeGreaterThan(119 * 60_000);
        }
        finally {
            resetClock();
        }
    });
    it('never exposes a secret', async () => {
        const response = await health();
        const serialised = JSON.stringify(response.body);
        /* The actual configured values, not the key names — a test that only checked for
         * the string "JWT_SECRET" would pass while the secret itself was in the body. */
        for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SEED_PASSWORD', 'MONGO_URI']) {
            const value = process.env[key];
            if (value && value.length >= 6)
                expect(serialised).not.toContain(value);
        }
        /* And nothing shaped like a credential got in under a different name. */
        expect(serialised).not.toMatch(/secret|password|apiKey|api_key|token/i);
    });
});
