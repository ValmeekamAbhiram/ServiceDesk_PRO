/**
 * ServiceDesk Pro — asset routes over HTTP.
 *
 * The service suite proves the scope filter narrows correctly. This one proves the
 * route is actually wired to it, which is a separate claim: a correct service behind a
 * missing `requirePermission()` is an open endpoint, and nothing in a service test
 * would notice.
 *
 * It is also the only test of `requirePermission()` in the repo, and that middleware
 * is the second of the three authorization layers — every admin-only route in the
 * application depends on it. Assets are a good place to exercise it because they are
 * the one resource where the three roles genuinely differ: an employee reads their own
 * row, a technician reads every row, and only an administrator writes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { AssetType, Role } from '@shared/enums';
import { createApp } from '@/app';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let adminToken: string;
let techToken: string;
let employeeToken: string;
let employeeId: string;

const PASSWORD = 'DevPassword123';

async function registerUser(name: string, email: string): Promise<{ token: string; id: string }> {
  const response = await request(app).post('/api/auth/register').send({ name, email, password: PASSWORD });
  expect(response.status).toBe(201);
  return { token: response.body.data.accessToken, id: response.body.data.user.id };
}

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  /* The first account registered becomes ADMIN; everyone after is an EMPLOYEE. */
  adminToken = (await registerUser('Ada Lovelace', 'ada@example.com')).token;
  const employee = await registerUser('Grace Hopper', 'grace@example.com');
  employeeToken = employee.token;
  employeeId = employee.id;

  /* Promoted through the admin endpoint, and the token from registration is kept:
   * `authenticate()` reloads the user on every request, so a role change is live on the
   * next call without a re-login. `user.routes.test.ts` asserts that property directly. */
  const tech = await registerUser('Alan Turing', 'alan@example.com');
  const promoted = await request(app)
    .patch(`/api/users/${tech.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ role: Role.TECHNICIAN });
  expect(promoted.status).toBe(200);
  techToken = tech.token;
});

beforeEach(resetRateLimits);
afterAll(stopDb);

function post(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/assets').set('Authorization', `Bearer ${token}`).send(body);
}

describe('only an administrator may change the inventory', () => {
  it('refuses an employee and a technician, and accepts an administrator', async () => {
    const laptop = { name: 'ThinkPad X1', type: AssetType.LAPTOP };

    expect((await post(employeeToken, laptop)).status).toBe(403);
    /* A technician reads the whole inventory but does not maintain it — straight from
     * `ROLE_PERMISSIONS`, where `ASSET_MANAGE` is in the ADMIN set alone. */
    expect((await post(techToken, laptop)).status).toBe(403);

    const created = await post(adminToken, laptop);
    expect(created.status).toBe(201);
    expect(created.body.data.tag).toMatch(/^AST-\d{6}$/);
    expect(created.headers.location).toBe(`/api/assets/${created.body.data.id}`);
  });

  it('refuses an anonymous caller before it looks at permissions', async () => {
    expect((await request(app).get('/api/assets')).status).toBe(401);
    expect((await request(app).post('/api/assets').send({ name: 'x', type: 'LAPTOP' })).status).toBe(401);
  });
});

describe('the read scope survives the trip through Express', () => {
  it('shows an employee their own row and hides the rest', async () => {
    const hers = await post(adminToken, {
      name: 'ThinkPad X1',
      type: AssetType.LAPTOP,
      assignedToId: employeeId,
    });
    expect(hers.status).toBe(201);
    const spare = await post(adminToken, { name: 'Spare monitor', type: AssetType.MONITOR });
    expect(spare.status).toBe(201);

    const mine = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.meta.total).toBe(1);
    expect(mine.body.data.items[0].name).toBe('ThinkPad X1');

    /* The unassigned monitor exists and is not hers: 404, never 403. */
    const forbidden = await request(app)
      .get(`/api/assets/${spare.body.data.id}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(forbidden.status).toBe(404);

    /* A technician reads both, which is what makes the 404 above a scope decision
     * rather than a missing row. Asserted by id rather than by count: the users have to
     * survive between tests in this file, so `clearDb` cannot run between them and
     * earlier tests have left rows behind. */
    const staffView = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${techToken}`);
    expect(staffView.status).toBe(200);
    const visible = new Set(staffView.body.data.items.map((row: { id: string }) => row.id));
    expect(visible.has(hers.body.data.id)).toBe(true);
    expect(visible.has(spare.body.data.id)).toBe(true);
  });
});
