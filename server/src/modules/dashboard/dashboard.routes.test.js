/**
 * ServiceDesk Pro — dashboard over HTTP.
 *
 * Three things this proves that the service tests cannot:
 *
 *  - the route is reachable by an employee. A dashboard that 403s for most of the
 *    company would be a dashboard nobody could put on the home page,
 *  - `technicianLoad` arrives empty for that employee and populated for staff, so the
 *    permission check is wired to the response and not just to the service,
 *  - it is behind authentication at all.
 *
 * The shape assertions are deliberately about the envelope — `data` with the seven
 * documented keys — because the client renders straight off it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Role } from '@shared/enums';
import { createApp } from '@/app';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';
let app;
let adminToken;
let employeeToken;
let technicianToken;
const PASSWORD = 'DevPassword123';
async function registerUser(name, email) {
    const response = await request(app)
        .post('/api/auth/register')
        .send({ name, email, password: PASSWORD });
    expect(response.status).toBe(201);
    return { token: response.body.data.accessToken, id: response.body.data.user.id };
}
const authed = (token) => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => {
    await startDb();
    await clearDb();
    app = createApp();
    /* The first account registered becomes ADMIN; everyone after is an EMPLOYEE. */
    const admin = await registerUser('Ada Lovelace', 'ada@example.com');
    adminToken = admin.token;
    const employee = await registerUser('Ed Employee', 'ed@example.com');
    employeeToken = employee.token;
    const technician = await registerUser('Tia Tech', 'tia@example.com');
    technicianToken = technician.token;
    const promoted = await request(app)
        .patch(`/api/users/${technician.id}`)
        .set(authed(adminToken))
        .send({ role: Role.TECHNICIAN });
    expect(promoted.status).toBe(200);
});
beforeEach(resetRateLimits);
afterAll(stopDb);
describe('GET /api/dashboard', () => {
    it('answers an employee with a dashboard of their own and no technician board', async () => {
        const response = await request(app).get('/api/dashboard').set(authed(employeeToken));
        expect(response.status).toBe(200);
        expect(Object.keys(response.body.data).sort()).toEqual([
            'atRisk',
            'byCategory',
            'byPriority',
            'byStatus',
            'kpis',
            'technicianLoad',
            'volume',
        ]);
        expect(response.body.data.technicianLoad).toEqual([]);
        expect(response.body.data.kpis).toHaveLength(4);
        expect(response.body.data.volume).toHaveLength(14);
    });
    it('gives staff the technician board', async () => {
        const response = await request(app).get('/api/dashboard').set(authed(technicianToken));
        expect(response.status).toBe(200);
        /* Ada is an admin and Tia a technician: both count as staff. */
        expect(response.body.data.technicianLoad).toHaveLength(2);
    });
    it('refuses an anonymous request', async () => {
        const response = await request(app).get('/api/dashboard');
        expect(response.status).toBe(401);
    });
});
