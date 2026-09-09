/**
 * ServiceDesk Pro — the SLA policy over HTTP.
 *
 * The interesting question here is not "does a PATCH save": it is *what a change
 * reaches*. The policy has two halves that behave differently, and the difference is
 * a deliberate design decision rather than an accident of where the data lives:
 *
 *  - business hours and the at-risk threshold are read live, so widening the working
 *    day moves the countdown on tickets that are already open;
 *  - the per-priority budgets are snapshotted onto a ticket when it is raised, so
 *    shortening one does not retroactively breach yesterday's tickets.
 *
 * A demo that got that backwards would look broken either way round, so both halves
 * are asserted. The rest is the guard and the audit entry.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { AuditAction, AuditEntity, Priority, Role } from '@shared/enums';
import { createApp } from '@/app';
import { Ticket } from '@/models';
import { resetRateLimits } from '@/middleware/rate-limit';
import { invalidateSlaPolicyCache } from '@/modules/sla/sla-policy.service';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let adminToken: string;
let technicianToken: string;
let employeeToken: string;
let categoryId: string;

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

function patchPolicy(token: string, body: Record<string, unknown>) {
  return request(app).patch('/api/sla-policy').set(authed(token)).send(body);
}

async function raiseTicket(): Promise<string> {
  const response = await request(app)
    .post('/api/tickets')
    .set(authed(employeeToken))
    .send({ title: 'Laptop will not boot', description: 'It stops at the logo screen.', categoryId, priority: Priority.HIGH });
  expect(response.status).toBe(201);
  return response.body.data.id;
}

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  const admin = await registerUser('Ada Lovelace', 'ada@example.com');
  adminToken = admin.token;

  const employee = await registerUser('Ed Employee', 'ed@example.com');
  employeeToken = employee.token;

  const technician = await registerUser('Tara Tech', 'tara@example.com');
  expect(
    (
      await request(app)
        .patch(`/api/users/${technician.id}`)
        .set(authed(adminToken))
        .send({ role: Role.TECHNICIAN })
    ).status
  ).toBe(200);
  technicianToken = technician.token;

  const category = await request(app)
    .post('/api/categories')
    .set(authed(adminToken))
    .send({ name: 'Hardware' });
  expect(category.status).toBe(201);
  categoryId = category.body.data.id;
});

beforeEach(() => {
  resetRateLimits();
  /* The policy is cached in process. Every test here writes to it, so a stale cache
   * would make the *next* test read the previous one's values. */
  invalidateSlaPolicyCache();
});

afterAll(stopDb);

describe('who may change the policy', () => {
  it('lets any signed-in user read it — it is the desk\'s published commitment', async () => {
    for (const token of [adminToken, technicianToken, employeeToken]) {
      const response = await request(app).get('/api/sla-policy').set(authed(token));
      expect(response.status).toBe(200);
      expect(response.body.data.targets[Priority.URGENT].responseMinutes).toBeGreaterThan(0);
    }
  });

  it('refuses a technician and an employee the write', async () => {
    expect((await patchPolicy(technicianToken, { atRiskThresholdPercent: 60 })).status).toBe(403);
    expect((await patchPolicy(employeeToken, { atRiskThresholdPercent: 60 })).status).toBe(403);
  });

  it('refuses an unsigned caller', async () => {
    expect((await request(app).patch('/api/sla-policy').send({ atRiskThresholdPercent: 60 })).status).toBe(401);
  });

  it('offers no way to delete the one policy that exists', async () => {
    expect((await request(app).delete('/api/sla-policy').set(authed(adminToken))).status).toBe(404);
  });
});

describe('validation', () => {
  it('refuses a business day that ends before it starts', async () => {
    const response = await patchPolicy(adminToken, {
      businessHours: { startMinute: 1080, endMinute: 540 },
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.error.fields)).toContain('endMinute');
  });

  it('refuses a timezone no runtime knows', async () => {
    expect(
      (await patchPolicy(adminToken, { businessHours: { timezone: 'Mars/Olympus_Mons' } })).status
    ).toBe(400);
  });

  it('refuses a threshold of 0 or 100, either of which makes at-risk meaningless', async () => {
    expect((await patchPolicy(adminToken, { atRiskThresholdPercent: 0 })).status).toBe(400);
    expect((await patchPolicy(adminToken, { atRiskThresholdPercent: 100 })).status).toBe(400);
  });

  it('refuses a budget of zero minutes', async () => {
    expect(
      (await patchPolicy(adminToken, { targets: { [Priority.LOW]: { responseMinutes: 0 } } })).status
    ).toBe(400);
  });

  it('refuses an empty body rather than writing a no-op', async () => {
    expect((await patchPolicy(adminToken, {})).status).toBe(400);
  });
});

describe('what a change reaches', () => {
  it('leaves the deadline on a ticket that was already raised', async () => {
    const ticketId = await raiseTicket();
    const before = await Ticket.findById(ticketId).lean();

    const changed = await patchPolicy(adminToken, {
      targets: { [Priority.HIGH]: { responseMinutes: 5, resolutionMinutes: 30 } },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.data.targets[Priority.HIGH].responseMinutes).toBe(5);

    /* The budget was a commitment made when the ticket was raised. Rewriting it now
     * would breach yesterday's tickets retroactively, which is not a thing a desk gets
     * to do to itself by editing a settings page. */
    const after = await Ticket.findById(ticketId).lean();
    expect(after?.sla.response.dueAt?.toISOString()).toBe(before?.sla.response.dueAt?.toISOString());
    expect(after?.sla.response.budgetMinutes).toBe(before?.sla.response.budgetMinutes);
  });

  it('applies the new budget to the next ticket raised', async () => {
    const ticketId = await raiseTicket();
    const raised = await Ticket.findById(ticketId).lean();

    expect(raised?.sla.response.budgetMinutes).toBe(5);
    expect(raised?.sla.resolution.budgetMinutes).toBe(30);
  });
});

describe('the change is visible afterwards', () => {
  it('serves the new values to the very next reader', async () => {
    expect((await patchPolicy(adminToken, { atRiskThresholdPercent: 62 })).status).toBe(200);

    /* The cache is invalidated by the writer, so this passes without the
     * `invalidateSlaPolicyCache()` in `beforeEach` — which only exists to isolate the
     * tests from each other's writes. */
    const read = await request(app).get('/api/sla-policy').set(authed(employeeToken));
    expect(read.body.data.atRiskThresholdPercent).toBe(62);
  });

  it('re-renders the business-hours label from the saved window', async () => {
    const response = await patchPolicy(adminToken, {
      businessHours: { startMinute: 480, endMinute: 1200, workingDays: [1, 2, 3, 4, 5, 6] },
    });

    expect(response.status).toBe(200);
    expect(response.body.data.businessHours.label).toContain('08:00');
    expect(response.body.data.businessHours.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('writes one audit entry naming both ends of the change', async () => {
    expect((await patchPolicy(adminToken, { atRiskThresholdPercent: 71 })).status).toBe(200);

    const trail = await request(app)
      .get(`/api/audit?action=${AuditAction.SETTINGS_UPDATED}&entityType=${AuditEntity.SLA_POLICY}`)
      .set(authed(adminToken));
    expect(trail.status).toBe(200);

    const [entry] = trail.body.data.items;
    expect(entry.changes.atRiskThresholdPercent).toEqual({ from: 62, to: 71 });
    expect(entry.actor.name).toBe('Ada Lovelace');
  });

  it('flattens a budget change into something a person can read', async () => {
    expect(
      (
        await patchPolicy(adminToken, {
          targets: { [Priority.URGENT]: { responseMinutes: 10, resolutionMinutes: 120 } },
        })
      ).status
    ).toBe(200);

    const trail = await request(app)
      .get(`/api/audit?entityType=${AuditEntity.SLA_POLICY}`)
      .set(authed(adminToken));
    const [entry] = trail.body.data.items;

    /* Recording the nested object itself would put `[object Object] → [object Object]`
     * in the table, which tells a reader nothing. The key keeps its path so the row
     * reads as a change to the policy's URGENT budget rather than to something called
     * "URGENT". */
    expect(entry.changes['targets.URGENT']).toEqual({ from: '15/240 min', to: '10/120 min' });
  });
});
