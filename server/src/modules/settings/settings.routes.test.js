/**
 * ServiceDesk Pro — system settings and the Time Machine over HTTP.
 *
 * The Time Machine is the most dangerous control in the product: everything
 * downstream of `actor.clock` believes it, so a jump changes every countdown, every
 * "raised 3 hours ago", and what the background SLA sweep decides has breached. The
 * brief's rule about it is blunt — "never expose destructive demo controls to ordinary
 * users" — and it is kept by three independent gates. These tests exercise two of them
 * (the settings flag and the permission); the third is `DEMO_MODE` in the environment,
 * which `config/env.ts` forces off in production and which no test can turn on there.
 *
 * The settings half is smaller but has one rule worth pinning down: a stored flag can
 * switch a feature **off** but can never switch one **on** that the deployment did not
 * enable. That is an AND, and getting it backwards would let an admin screen re-enable
 * something an operator deliberately disabled.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditAction, Role } from '@shared/enums';
import { createApp } from '@/app';
import { clockState, resetClock } from '@/config/clock';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';
let app;
let adminToken;
let adminRefreshToken;
let technicianToken;
let employeeToken;
let employeeRefreshToken;
const PASSWORD = 'DevPassword123';
async function registerUser(name, email) {
    const response = await request(app)
        .post('/api/auth/register')
        .send({ name, email, password: PASSWORD });
    expect(response.status).toBe(201);
    return {
        token: response.body.data.accessToken,
        refreshToken: response.body.data.refreshToken,
        id: response.body.data.user.id,
    };
}
/**
 * A jump longer than the access-token lifetime expires the token in hand — see the
 * test that pins that down. The client's axios layer repairs it silently on the next
 * 401; here it has to be done by hand, so every test that jumps and then keeps working
 * calls this.
 */
async function reauthenticateAdmin() {
    const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: adminRefreshToken });
    expect(response.status).toBe(200);
    adminToken = response.body.data.accessToken;
    adminRefreshToken = response.body.data.refreshToken;
}
function authed(token) {
    return { Authorization: `Bearer ${token}` };
}
function patchSettings(token, body) {
    return request(app).patch('/api/settings').set(authed(token)).send(body);
}
function advanceClock(token, minutes) {
    return request(app).post('/api/demo/clock/advance').set(authed(token)).send({ minutes });
}
beforeAll(async () => {
    await startDb();
    await clearDb();
    app = createApp();
    const admin = await registerUser('Ada Lovelace', 'ada@example.com');
    adminToken = admin.token;
    adminRefreshToken = admin.refreshToken;
    const employee = await registerUser('Ed Employee', 'ed@example.com');
    employeeToken = employee.token;
    employeeRefreshToken = employee.refreshToken;
    const technician = await registerUser('Tara Tech', 'tara@example.com');
    expect((await request(app)
        .patch(`/api/users/${technician.id}`)
        .set(authed(adminToken))
        .send({ role: Role.TECHNICIAN })).status).toBe(200);
    technicianToken = technician.token;
});
beforeEach(async () => {
    resetRateLimits();
    /* The demo clock is process state, not database state, so `clearDb()` does not touch
     * it. A test that leaves it four hours ahead would make every later suite in the same
     * fork compute deadlines from a shifted now — and would expire its own token. */
    resetClock();
    await reauthenticateAdmin();
    await patchSettings(adminToken, { demoModeRequested: true });
});
afterAll(() => {
    resetClock();
    return stopDb();
});
describe('settings', () => {
    it('lets any signed-in user read them — the header needs the organisation name', async () => {
        for (const token of [adminToken, technicianToken, employeeToken]) {
            const response = await request(app).get('/api/settings').set(authed(token));
            expect(response.status).toBe(200);
            expect(response.body.data.organizationName).toEqual(expect.any(String));
        }
    });
    it('refuses the write to anyone without settings:manage', async () => {
        expect((await patchSettings(technicianToken, { organizationName: 'Hijacked' })).status).toBe(403);
        expect((await patchSettings(employeeToken, { organizationName: 'Hijacked' })).status).toBe(403);
    });
    it('leaves fields the caller did not send alone', async () => {
        const before = (await request(app).get('/api/settings').set(authed(adminToken))).body.data;
        const response = await patchSettings(adminToken, { organizationName: 'Northwind Labs' });
        expect(response.status).toBe(200);
        expect(response.body.data.organizationName).toBe('Northwind Labs');
        /* A client that only knows about one field must not be able to blank the others. */
        expect(response.body.data.supportEmail).toBe(before.supportEmail);
    });
    it('rejects an empty body and an invalid support address', async () => {
        expect((await patchSettings(adminToken, {})).status).toBe(400);
        expect((await patchSettings(adminToken, { supportEmail: 'not-an-address' })).status).toBe(400);
    });
    it('records the change in the audit trail', async () => {
        expect((await patchSettings(adminToken, { organizationName: 'Northwind Industries' })).status).toBe(200);
        const trail = await request(app)
            .get(`/api/audit?action=${AuditAction.SETTINGS_UPDATED}&entityType=SETTINGS`)
            .set(authed(adminToken));
        const [entry] = trail.body.data.items;
        expect(entry.changes.organizationName).toEqual({
            from: 'Northwind Labs',
            to: 'Northwind Industries',
        });
    });
    /**
     * Both halves of each feature flag are sent, and that is what makes the admin form
     * honest: shown only the effective value, it could not tell "an administrator turned
     * this off" from "this deployment was never built with it", and its toggle would look
     * broken in the second case. The stored twin is what the form edits; the AND is what
     * it reports.
     */
    it('sends the stored flag as well as the effective one', async () => {
        const off = await patchSettings(adminToken, { aiSuggestionsEnabled: false });
        expect(off.status).toBe(200);
        expect(off.body.data.aiSuggestionsRequested).toBe(false);
        expect(off.body.data.aiSuggestionsEnabled).toBe(false);
        const on = await patchSettings(adminToken, { aiSuggestionsEnabled: true });
        /* `AI_ENABLED` defaults on under test, so the AND is true again here. The other
         * combination — requested true, effective false — is only reachable by an operator
         * setting `AI_ENABLED=false`, and it is exactly what the form's warning is for. */
        expect(on.body.data.aiSuggestionsRequested).toBe(true);
        expect(on.body.data.aiSuggestionsEnabled).toBe(true);
    });
});
describe('the Time Machine is closed to ordinary users', () => {
    it('refuses a technician and an employee, on the read as well as the write', async () => {
        for (const token of [technicianToken, employeeToken]) {
            expect((await request(app).get('/api/demo/clock').set(authed(token))).status).toBe(403);
            expect((await advanceClock(token, 60)).status).toBe(403);
            expect((await request(app).post('/api/demo/clock/reset').set(authed(token))).status).toBe(403);
        }
    });
    it('refuses an unsigned caller', async () => {
        expect((await request(app).post('/api/demo/clock/advance').send({ minutes: 60 })).status).toBe(401);
    });
    it('closes for administrators too once demo mode is switched off', async () => {
        expect((await patchSettings(adminToken, { demoModeRequested: false })).status).toBe(200);
        const refused = await advanceClock(adminToken, 60);
        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe('DEMO_DISABLED');
        /* And the clock did not move on the way to being refused. */
        expect((await request(app).get('/api/demo/clock').set(authed(adminToken))).body.data.offsetMs).toBe(0);
    });
    /**
     * The trap this guards: switching demo mode off closes every Time Machine route,
     * `reset` included. If a live offset survived that, the whole application would go on
     * reading a shifted clock — SLA deadlines measured hours from now — with no route left
     * to put it back. So closing the door has to bring the clock home with it.
     */
    it('returns the clock to real time when demo mode is switched off under it', async () => {
        expect((await advanceClock(adminToken, 480)).status).toBe(200);
        await reauthenticateAdmin();
        expect((await patchSettings(adminToken, { demoModeRequested: false })).status).toBe(200);
        /* Read the process clock directly rather than through `GET /api/demo/clock`: that
         * route is now closed, which is the whole point, and re-opening it to look would
         * also need another refresh — the reset moved the clock *backwards*, so the token
         * minted eight hours ahead is no longer valid either. */
        expect(clockState().offsetMs).toBe(0);
        expect(clockState().offsetLabel).toBe('real time');
    });
    it('says so in the audit trail when it brings the clock home', async () => {
        await advanceClock(adminToken, 120);
        await reauthenticateAdmin();
        await patchSettings(adminToken, { demoModeRequested: false });
        /* The reset wound time back under the session, so sign in again to read the trail. */
        await reauthenticateAdmin();
        const trail = await request(app)
            .get(`/api/audit?action=${AuditAction.SETTINGS_UPDATED}`)
            .set(authed(adminToken));
        expect(trail.status).toBe(200);
        expect(trail.body.data.items[0].summary).toContain('returned the clock to real time');
    });
});
describe('what a jump does', () => {
    it('moves the simulated clock without touching real time', async () => {
        const response = await advanceClock(adminToken, 240);
        expect(response.status).toBe(200);
        expect(response.body.data.offsetMs).toBe(240 * 60_000);
        expect(response.body.data.offsetLabel).toBe('+4h');
        const simulated = Date.parse(response.body.data.simulatedTime);
        const real = Date.parse(response.body.data.realTime);
        expect(simulated - real).toBeGreaterThan(239 * 60_000);
    });
    it('accumulates, and resets back to real time', async () => {
        await advanceClock(adminToken, 60);
        await reauthenticateAdmin();
        const second = await advanceClock(adminToken, 30);
        expect(second.body.data.offsetMs).toBe(90 * 60_000);
        await reauthenticateAdmin();
        const reset = await request(app).post('/api/demo/clock/reset').set(authed(adminToken));
        expect(reset.status).toBe(200);
        expect(reset.body.data.offsetMs).toBe(0);
        expect(reset.body.data.offsetLabel).toBe('real time');
    });
    it('refuses a jump of zero and one beyond a fortnight', async () => {
        expect((await advanceClock(adminToken, 0)).status).toBe(400);
        expect((await advanceClock(adminToken, 20_161)).status).toBe(400);
        expect((await advanceClock(adminToken, -20_161)).status).toBe(400);
        /* Winding back is allowed — it is how an over-eager jump is undone. */
        expect((await advanceClock(adminToken, -15)).status).toBe(200);
    });
    it('does not rewrite a timestamp that was already stored', async () => {
        const category = await request(app)
            .post('/api/categories')
            .set(authed(adminToken))
            .send({ name: 'Network' });
        const ticket = await request(app)
            .post('/api/tickets')
            .set(authed(employeeToken))
            .send({
            title: 'Wi-Fi drops every ten minutes',
            description: 'It reconnects on its own but the call ends.',
            categoryId: category.body.data.id,
        });
        expect(ticket.status).toBe(201);
        const raisedAt = ticket.body.data.createdAt;
        await advanceClock(adminToken, 1440);
        /* The employee's token was minted a moment ago and the clock is now a day ahead of
         * it, so it has to be renewed the same way the client would. */
        const renewed = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: employeeRefreshToken });
        expect(renewed.status).toBe(200);
        employeeToken = renewed.body.data.accessToken;
        /* The clock shifts what `now()` *reads*. A ticket raised a moment ago still says so
         * after a one-day jump — which is exactly what makes the deadline move without the
         * history becoming a lie. */
        const after = await request(app)
            .get(`/api/tickets/${ticket.body.data.id}`)
            .set(authed(employeeToken));
        expect(after.body.data.createdAt).toBe(raisedAt);
    });
    it('records the jump in the audit trail, as an offset', async () => {
        await advanceClock(adminToken, 120);
        await reauthenticateAdmin();
        const trail = await request(app)
            .get(`/api/audit?action=${AuditAction.DEMO_CLOCK_CHANGED}`)
            .set(authed(adminToken));
        const [entry] = trail.body.data.items;
        expect(entry.summary).toContain('forward');
        expect(entry.changes.clockOffset).toEqual({ from: 'real time', to: '+2h' });
        expect(entry.actor.name).toBe('Ada Lovelace');
    });
});
describe('a jump and the session it was made from', () => {
    it('expires the token in hand, and the refresh flow issues a working one', async () => {
        /* Not a bug, and worth pinning down because it looks like one the first time it
         * happens. Expiry is judged against the injected clock — `verifyAccessToken()`
         * passes `clockTimestamp` — so a jump longer than the access-token lifetime moves
         * "now" past the `exp` of a token minted before the button was pressed.
         *
         * The alternative, exempting token verification from the demo clock, would mean a
         * session that outlives its own expiry for as long as the demo runs. Keeping one
         * clock for the whole request is the safer half of the trade, and the client's
         * axios layer turns the 401 into a refresh nobody sees. */
        const jumped = await advanceClock(adminToken, 600);
        expect(jumped.status).toBe(200);
        const stale = await request(app).get('/api/settings').set(authed(adminToken));
        expect(stale.status).toBe(401);
        expect(stale.body.error.code).toBe('TOKEN_EXPIRED');
        await reauthenticateAdmin();
        const renewed = await request(app).get('/api/settings').set(authed(adminToken));
        expect(renewed.status).toBe(200);
    });
});
