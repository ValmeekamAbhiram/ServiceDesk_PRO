/**
 * ServiceDesk Pro — the notification endpoints over HTTP.
 *
 * `notification.service.test.ts` covers who gets notified and what a notification
 * says. What only the route can get wrong is here: it is behind authentication, the
 * response is the `NotificationListDto` shape the bell menu renders, `/read-all` is
 * reachable rather than swallowed by the id route, and — the important one — a
 * notification id belonging to somebody else is a 404 over HTTP too, not just at the
 * service boundary.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { NotificationType, TicketStatus } from '@shared/enums';
import { Category } from '@/models';
import { createApp } from '@/app';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let adminToken: string;
let employeeToken: string;
let categoryId: string;

const PASSWORD = 'DevPassword123';
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  /* The first account registered becomes ADMIN; everyone after is an EMPLOYEE. */
  const admin = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Ada Admin', email: 'ada@example.com', password: PASSWORD });
  adminToken = admin.body.data.accessToken;

  const employee = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Ed Employee', email: 'ed@example.com', password: PASSWORD });
  employeeToken = employee.body.data.accessToken;

  const category = await Category.create({ name: 'Network', slug: 'network', sortOrder: 1 });
  categoryId = category._id.toString();
});

beforeEach(resetRateLimits);
afterAll(stopDb);

/** Raise a ticket as the employee, then have the admin move it — one notification. */
async function notifyTheEmployee(): Promise<void> {
  const created = await request(app)
    .post('/api/tickets')
    .set(authed(employeeToken))
    .send({ title: 'Wi-Fi keeps dropping', description: 'Every few minutes.', categoryId });
  expect(created.status).toBe(201);

  const moved = await request(app)
    .patch(`/api/tickets/${created.body.data.id}/status`)
    .set(authed(adminToken))
    .send({ status: TicketStatus.IN_PROGRESS, version: created.body.data.version });
  expect(moved.status).toBe(200);
}

describe('GET /api/notifications', () => {
  it('answers the bell menu shape, newest first', async () => {
    await notifyTheEmployee();

    const response = await request(app).get('/api/notifications').set(authed(employeeToken));

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual(['items', 'meta', 'unreadCount']);
    expect(response.body.data.unreadCount).toBe(1);
    const [first] = response.body.data.items;
    expect(Object.keys(first).sort()).toEqual([
      'body',
      'createdAt',
      'id',
      'link',
      'read',
      'title',
      'type',
    ]);
    expect(first.type).toBe(NotificationType.TICKET_STATUS_CHANGED);
    expect(first.read).toBe(false);
  });

  it('shows an admin nothing that was addressed to the employee', async () => {
    const response = await request(app).get('/api/notifications').set(authed(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.unreadCount).toBe(0);
  });

  it('refuses an anonymous caller', async () => {
    const response = await request(app).get('/api/notifications');
    expect(response.status).toBe(401);
  });
});

describe('marking them read', () => {
  it('marks one read and returns it', async () => {
    const menu = await request(app).get('/api/notifications').set(authed(employeeToken));
    const target = menu.body.data.items[0];

    const response = await request(app)
      .post(`/api/notifications/${target.id}/read`)
      .set(authed(employeeToken));

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(target.id);
    expect(response.body.data.read).toBe(true);
  });

  it('answers 404 for a notification belonging to somebody else', async () => {
    await notifyTheEmployee();
    const menu = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set(authed(employeeToken));
    const target = menu.body.data.items[0];

    const response = await request(app)
      .post(`/api/notifications/${target.id}/read`)
      .set(authed(adminToken));

    expect(response.status).toBe(404);
    /* Still unread for the person it belongs to. */
    const after = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set(authed(employeeToken));
    expect(after.body.data.items.some((row: { id: string }) => row.id === target.id)).toBe(true);
  });

  it('reaches /read-all rather than the id route, and answers with the refreshed menu', async () => {
    const response = await request(app).post('/api/notifications/read-all').set(authed(employeeToken));

    expect(response.status).toBe(200);
    expect(response.body.data.unreadCount).toBe(0);
    expect(response.body.data.items.every((row: { read: boolean }) => row.read)).toBe(true);
  });

  it('rejects a malformed id with a validation error, not a 404', async () => {
    const response = await request(app).post('/api/notifications/not-an-id/read').set(authed(employeeToken));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
