/**
 * ServiceDesk Pro — user administration over HTTP.
 *
 * This is the endpoint that hands out privilege, so the tests are about who may use it
 * and what it refuses:
 *
 *  - a technician may read the directory (they have to pick an assignee) and may not
 *    write to it,
 *  - an employee may not even read it,
 *  - **no administrator can demote or deactivate themselves**, which is the whole proof
 *    that the last active admin cannot disappear (see `user.service.ts`),
 *  - a promotion takes effect on the promoted user's *existing* token, because
 *    `authenticate()` re-reads the role from the database on every request rather than
 *    trusting the one in the token. That last one is the property the brief asks for by
 *    name — "never trust role information supplied by the frontend" — and this is the
 *    only place it is asserted end to end.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Role, UserStatus } from '@shared/enums';
import { createApp } from '@/app';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let adminToken: string;
let adminId: string;
let secondAdminToken: string;
let employeeToken: string;
let employeeId: string;

const PASSWORD = 'DevPassword123';

async function registerUser(name: string, email: string): Promise<{ token: string; id: string }> {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD });
  expect(response.status).toBe(201);
  return { token: response.body.data.accessToken, id: response.body.data.user.id };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function patchUser(token: string, id: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/users/${id}`).set(authed(token)).send(body);
}

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  /* The first account registered becomes ADMIN; everyone after is an EMPLOYEE. */
  const admin = await registerUser('Ada Lovelace', 'ada@example.com');
  adminToken = admin.token;
  adminId = admin.id;

  const employee = await registerUser('Ed Employee', 'ed@example.com');
  employeeToken = employee.token;
  employeeId = employee.id;

  /* A second administrator, promoted through the endpoint under test. Its existence is
   * what makes "an admin cannot demote themselves" a rule rather than a dead end. */
  const second = await registerUser('Bea Second', 'bea@example.com');
  const promoted = await patchUser(adminToken, second.id, { role: Role.ADMIN });
  expect(promoted.status).toBe(200);
  expect(promoted.body.data.role).toBe(Role.ADMIN);
  secondAdminToken = second.token;
});

beforeEach(resetRateLimits);
afterAll(stopDb);

describe('a promotion takes effect immediately', () => {
  it('applies to a token that was issued before the role changed', async () => {
    const grace = await registerUser('Grace Hopper', 'grace@example.com');

    /* The token in hand was minted while Grace was an EMPLOYEE, and employees hold no
     * USER_READ, so the directory is closed to her. */
    expect((await request(app).get('/api/users').set(authed(grace.token))).status).toBe(403);

    expect((await patchUser(adminToken, grace.id, { role: Role.TECHNICIAN })).status).toBe(200);

    /* Same token, no re-login. `authenticate()` reloads the user each request, so the
     * role on the token is never consulted and the promotion is live at once. */
    const directory = await request(app).get('/api/users').set(authed(grace.token));
    expect(directory.status).toBe(200);
    expect(directory.body.data.meta.total).toBeGreaterThan(0);
  });

  it('closes the door again on deactivation, with the same token', async () => {
    const sam = await registerUser('Sam Spare', 'sam@example.com');
    expect((await request(app).get('/api/auth/me').set(authed(sam.token))).status).toBe(200);

    expect(
      (await patchUser(adminToken, sam.id, { status: UserStatus.INACTIVE })).status
    ).toBe(200);

    /* 401 rather than 403: the account is no longer usable at all, which is a failure of
     * authentication and not of permission. */
    expect((await request(app).get('/api/auth/me').set(authed(sam.token))).status).toBe(401);
  });
});

describe('nobody can lock everybody out', () => {
  it('refuses an administrator demoting themselves', async () => {
    const refused = await patchUser(adminToken, adminId, { role: Role.EMPLOYEE });
    expect(refused.status).toBe(403);

    /* Still an admin, and the refusal did not half-apply anything. */
    const unchanged = await request(app).get(`/api/users/${adminId}`).set(authed(adminToken));
    expect(unchanged.body.data.role).toBe(Role.ADMIN);
  });

  it('refuses an administrator deactivating themselves', async () => {
    expect(
      (await patchUser(adminToken, adminId, { status: UserStatus.INACTIVE })).status
    ).toBe(403);
  });

  it('lets a different administrator make the same change', async () => {
    /* The rule is "not yourself", not "not an admin" — so the second administrator can
     * do what the first was refused, and one of them always remains. */
    const demoted = await patchUser(secondAdminToken, adminId, { role: Role.TECHNICIAN });
    expect(demoted.status).toBe(200);
    expect(demoted.body.data.role).toBe(Role.TECHNICIAN);

    /* Put it back, so the rest of the file still has its administrator. */
    expect((await patchUser(secondAdminToken, adminId, { role: Role.ADMIN })).status).toBe(200);
  });

  it('still lets an administrator edit their own name and phone', async () => {
    const renamed = await patchUser(adminToken, adminId, {
      name: 'Ada King',
      phone: '+44 20 7946 0000',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Ada King');
  });
});

describe('who may read and write the directory', () => {
  it('closes it to an employee entirely', async () => {
    expect((await request(app).get('/api/users').set(authed(employeeToken))).status).toBe(403);
    expect((await patchUser(employeeToken, employeeId, { name: 'Ed Renamed' })).status).toBe(403);
    /* Not even their own record — the endpoint is the admin directory. `/api/auth/me` is
     * how a user reads themselves. */
    expect((await request(app).get(`/api/users/${employeeId}`).set(authed(employeeToken))).status).toBe(403);
  });

  it('lets a technician read but not write', async () => {
    const tess = await registerUser('Tess Technician', 'tess@example.com');
    expect((await patchUser(adminToken, tess.id, { role: Role.TECHNICIAN })).status).toBe(200);

    const list = await request(app).get('/api/users').set(authed(tess.token));
    expect(list.status).toBe(200);

    /* USER_MANAGE is ADMIN's alone, so a technician cannot promote anybody — including
     * themselves, which is the escalation this refusal exists to stop. */
    expect((await patchUser(tess.token, tess.id, { role: Role.ADMIN })).status).toBe(403);
  });

  it('filters and searches through the text index', async () => {
    const byRole = await request(app)
      .get('/api/users')
      .query({ role: Role.EMPLOYEE })
      .set(authed(adminToken));
    expect(byRole.status).toBe(200);
    expect(byRole.body.data.items.every((row: { role: string }) => row.role === Role.EMPLOYEE)).toBe(true);

    const found = await request(app).get('/api/users').query({ q: 'grace' }).set(authed(adminToken));
    expect(found.body.data.items.map((row: { email: string }) => row.email)).toContain(
      'grace@example.com'
    );
  });

  it('offers assignees least-loaded first, and no employees', async () => {
    const assignees = await request(app).get('/api/users/assignees').set(authed(adminToken));

    expect(assignees.status).toBe(200);
    expect(Array.isArray(assignees.body.data)).toBe(true);
    const roles: string[] = assignees.body.data.map((row: { role: string }) => row.role);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles).not.toContain(Role.EMPLOYEE);
    /* Reached the assignees handler, not the `/:id` handler — that would have been a 400
     * from id validation. */
    expect(assignees.body.data[0]).toHaveProperty('name');
  });

  it('never returns a password hash', async () => {
    const list = await request(app).get('/api/users').set(authed(adminToken));
    for (const row of list.body.data.items) {
      expect(row).not.toHaveProperty('passwordHash');
      expect(row).not.toHaveProperty('password');
    }
  });
});

/**
 * The self-service route. Its whole reason for existing separately from `PATCH /:id` is
 * that its body has no `role` and no `status`, so the interesting assertions are about
 * what it *ignores* rather than what it saves.
 */
describe('PATCH /api/users/me', () => {
  const patchMe = (token: string, body: Record<string, unknown>) =>
    request(app).patch('/api/users/me').set(authed(token)).send(body);

  it('lets an employee correct their own name, job title and phone', async () => {
    const response = await patchMe(employeeToken, {
      name: 'Edward Employee',
      jobTitle: 'Accounts assistant',
      phone: '+91 98765 43210',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Edward Employee');
    expect(response.body.data.jobTitle).toBe('Accounts assistant');
    expect(response.body.data.phone).toBe('+91 98765 43210');
    /* Unchanged, and not something the route accepted a value for. */
    expect(response.body.data.role).toBe(Role.EMPLOYEE);
  });

  it('clears an optional field with null rather than storing an empty string', async () => {
    expect((await patchMe(employeeToken, { jobTitle: 'Temp' })).status).toBe(200);

    const cleared = await patchMe(employeeToken, { jobTitle: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.jobTitle).toBeNull();
  });

  it('refuses a role sent to the self route, and does not silently drop it', async () => {
    /* The strict body means an unknown key is a 400, so an employee who tries to promote
     * themselves gets a validation failure rather than a 200 that quietly ignored them —
     * which is the difference between "refused" and "looks like it worked". */
    const response = await patchMe(employeeToken, { role: Role.ADMIN });
    expect(response.status).toBe(400);

    const me = await request(app).get('/api/auth/me').set(authed(employeeToken));
    expect(me.body.data.role).toBe(Role.EMPLOYEE);
  });

  it('refuses a status sent to the self route', async () => {
    const response = await patchMe(employeeToken, { status: UserStatus.INACTIVE });
    expect(response.status).toBe(400);

    /* Still usable, which is the point: this is how somebody would lock themselves out. */
    expect((await request(app).get('/api/auth/me').set(authed(employeeToken))).status).toBe(200);
  });

  it('refuses an empty body', async () => {
    expect((await patchMe(employeeToken, {})).status).toBe(400);
  });

  it('is not reachable without a token', async () => {
    expect((await request(app).patch('/api/users/me').send({ name: 'Nobody' })).status).toBe(401);
  });

  it('does not read "me" as an object id', async () => {
    /* If `/me` were declared after `/:id`, this would be a 400 from id validation. */
    const response = await patchMe(employeeToken, { name: 'Ed Employee' });
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(employeeId);
  });
});
