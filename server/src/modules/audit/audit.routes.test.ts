/**
 * ServiceDesk Pro — the audit trail over HTTP.
 *
 * The brief's rule is one sentence — "audit logs should not be editable by normal
 * users" — but there are two halves to keeping it, and both are tested here:
 *
 *  - **Nobody without `audit:read` can see the trail.** It carries IP addresses,
 *    email addresses and the before/after values of every administrative change, so a
 *    technician reading it would learn things the rest of the product never shows them.
 *  - **Nobody at all can edit it, administrators included.** The append-only rule is
 *    enforced in the schema rather than by leaving the routes out, so the guarantee
 *    holds for a service written next year that decides it needs to correct a row.
 *
 * The rest is about the trail being *useful*: an entry has to name a real person, say
 * what changed, and survive that person being renamed afterwards.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { AuditAction, AuditEntity, Role } from '@shared/enums';
import { createApp } from '@/app';
import { AuditLog } from '@/models';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let adminToken: string;
let adminId: string;
let technicianToken: string;
let employeeToken: string;
let employeeId: string;

const PASSWORD = 'DevPassword123';

async function registerUser(name: string, email: string) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD });
  expect(response.status).toBe(201);
  return { token: response.body.data.accessToken as string, id: response.body.data.user.id as string };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function trail(query = '') {
  return request(app).get(`/api/audit${query}`).set(authed(adminToken));
}

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  const admin = await registerUser('Ada Lovelace', 'ada@example.com');
  adminToken = admin.token;
  adminId = admin.id;

  const employee = await registerUser('Ed Employee', 'ed@example.com');
  employeeToken = employee.token;
  employeeId = employee.id;

  const technician = await registerUser('Tara Tech', 'tara@example.com');
  const promoted = await request(app)
    .patch(`/api/users/${technician.id}`)
    .set(authed(adminToken))
    .send({ role: Role.TECHNICIAN });
  expect(promoted.status).toBe(200);
  technicianToken = technician.token;
});

beforeEach(resetRateLimits);
afterAll(stopDb);

describe('who may read the trail', () => {
  it('lets an administrator read it', async () => {
    const response = await trail();
    expect(response.status).toBe(200);
    expect(response.body.data.items.length).toBeGreaterThan(0);
  });

  it('refuses a technician, who can see every ticket but not who changed what', async () => {
    expect((await request(app).get('/api/audit').set(authed(technicianToken))).status).toBe(403);
  });

  it('refuses an employee', async () => {
    expect((await request(app).get('/api/audit').set(authed(employeeToken))).status).toBe(403);
  });

  it('refuses a caller with no token at all', async () => {
    expect((await request(app).get('/api/audit')).status).toBe(401);
  });
});

describe('the trail is append-only', () => {
  it('offers no way to write to it over HTTP', async () => {
    const first = (await trail()).body.data.items[0];

    for (const attempt of [
      request(app).post('/api/audit').set(authed(adminToken)).send({ summary: 'Invented' }),
      request(app).patch(`/api/audit/${first.id}`).set(authed(adminToken)).send({ summary: 'Edited' }),
      request(app).delete(`/api/audit/${first.id}`).set(authed(adminToken)),
    ]) {
      const response = await attempt;
      expect(response.status).toBe(404);
    }
  });

  it('refuses an update made directly against the model', async () => {
    const row = await AuditLog.findOne().sort({ createdAt: -1 });
    expect(row).not.toBeNull();

    /* Not the routes' doing: the schema's pre-hooks throw, so a service written later
     * that reaches for `updateOne` fails loudly rather than quietly rewriting history. */
    await expect(
      AuditLog.updateOne({ _id: row!._id }, { $set: { summary: 'Something else' } })
    ).rejects.toThrow();
    await expect(AuditLog.deleteOne({ _id: row!._id })).rejects.toThrow();

    const after = await AuditLog.findById(row!._id).lean();
    expect(after?.summary).toBe(row!.summary);
  });
});

describe('what an entry says', () => {
  it('records a sign-in against the person who signed in', async () => {
    await request(app).post('/api/auth/login').send({ email: 'ed@example.com', password: PASSWORD });

    const response = await trail(`?action=${AuditAction.LOGIN}&actorId=${employeeId}`);
    expect(response.status).toBe(200);

    const [entry] = response.body.data.items;
    expect(entry.action).toBe(AuditAction.LOGIN);
    expect(entry.actor).toMatchObject({ id: employeeId, name: 'Ed Employee' });
    expect(entry.automated).toBe(false);
    /* The request id ties the entry back to the server log for the same request. */
    expect(entry.requestId).toEqual(expect.any(String));
  });

  it('does not record a failed sign-in', async () => {
    const before = await AuditLog.countDocuments({ action: AuditAction.LOGIN });

    const rejected = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ed@example.com', password: 'WrongPassword123' });
    expect(rejected.status).toBe(401);

    /* An unauthenticated caller must not have a write path into a collection an
     * administrator reads — an unlimited one is a way to fill a disk. */
    expect(await AuditLog.countDocuments({ action: AuditAction.LOGIN })).toBe(before);
  });
});

describe('what a change looks like in the trail', () => {
  it('names both ends of a role change and files it under ROLE_CHANGED', async () => {
    const victor = await registerUser('Vic Torres', 'vic@example.com');
    const promoted = await request(app)
      .patch(`/api/users/${victor.id}`)
      .set(authed(adminToken))
      .send({ role: Role.TECHNICIAN, jobTitle: 'Support Engineer' });
    expect(promoted.status).toBe(200);

    const response = await trail(`?entityType=${AuditEntity.USER}&entityId=${victor.id}`);
    const entry = response.body.data.items.find(
      (row: { action: string }) => row.action === AuditAction.ROLE_CHANGED
    );

    expect(entry).toBeDefined();
    expect(entry.summary).toContain('EMPLOYEE');
    expect(entry.summary).toContain('TECHNICIAN');
    expect(entry.changes.role).toEqual({ from: Role.EMPLOYEE, to: Role.TECHNICIAN });
    /* One entry for the whole request: the job title moved in the same edit and is
     * beside the role, not in a second row that reads like a second decision. */
    expect(entry.changes.jobTitle).toEqual({ from: null, to: 'Support Engineer' });
    expect(entry.actor.id).toBe(adminId);
  });

  it('leaves out a field nobody actually changed', async () => {
    const noop = await registerUser('Nora Noop', 'nora@example.com');
    const response = await request(app)
      .patch(`/api/users/${noop.id}`)
      .set(authed(adminToken))
      .send({ name: 'Nora Noop', jobTitle: 'Analyst' });
    expect(response.status).toBe(200);

    const entry = (await trail(`?entityId=${noop.id}&action=${AuditAction.USER_UPDATED}`)).body.data
      .items[0];
    expect(entry.changes).toEqual({ jobTitle: { from: null, to: 'Analyst' } });
  });

  it('keeps naming the person who acted after they are renamed', async () => {
    const ghost = await registerUser('Original Name', 'ghost@example.com');
    await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: PASSWORD });

    await request(app)
      .patch(`/api/users/${ghost.id}`)
      .set(authed(adminToken))
      .send({ name: 'Renamed Afterwards' });

    /* Denormalised, not populated: the entry is evidence of what was true when it was
     * written, so a later rename must not rewrite the name attached to a past action. */
    const entry = (await trail(`?actorId=${ghost.id}&action=${AuditAction.LOGIN}`)).body.data.items[0];
    expect(entry.actorName).toBe('Original Name');
    expect(entry.actor.name).toBe('Original Name');
  });
});

describe('secrets never reach the trail', () => {
  it('records a password change as an event with no values attached', async () => {
    const target = await registerUser('Pat Password', 'pat@example.com');

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set(authed(target.token))
      .send({ currentPassword: PASSWORD, newPassword: 'AnotherDevPass456' });
    expect(changed.status).toBe(200);

    const entry = (await trail(`?action=${AuditAction.PASSWORD_RESET}&actorId=${target.id}`)).body
      .data.items[0];
    expect(entry).toBeDefined();
    expect(entry.changes).toBeNull();
  });

  it('holds no password, hash or token anywhere in the collection', async () => {
    const everything = JSON.stringify(await AuditLog.find().lean());

    for (const secret of [PASSWORD, 'AnotherDevPass456', '$2b$', 'eyJ']) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe('filters', () => {
  it('narrows by action, and says so in the total', async () => {
    const response = await trail(`?action=${AuditAction.LOGIN}`);
    const items: { action: string }[] = response.body.data.items;

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((row) => row.action === AuditAction.LOGIN)).toBe(true);
    expect(response.body.data.meta.total).toBe(
      await AuditLog.countDocuments({ action: AuditAction.LOGIN })
    );
  });

  it('treats `to` as the whole of that day', async () => {
    const today = new Date().toISOString().slice(0, 10);

    /* Everything in this file was written within the last few seconds — well after
     * midnight — so a naive `$lte` on the date boundary would return nothing. */
    const response = await trail(`?from=${today}&to=${today}`);
    expect(response.status).toBe(200);
    expect(response.body.data.items.length).toBeGreaterThan(0);
  });

  it('returns the newest entry first', async () => {
    const items: { createdAt: string }[] = (await trail()).body.data.items;
    const times = items.map((row) => Date.parse(row.createdAt));

    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('rejects a filter that is not a known action', async () => {
    expect((await trail('?action=NOT_AN_ACTION')).status).toBe(400);
  });
});
