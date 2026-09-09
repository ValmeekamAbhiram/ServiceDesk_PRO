/**
 * ServiceDesk Pro — the suggestion endpoint over HTTP.
 *
 * The service tests cover what the suggestion says. These cover the things only the
 * route can get wrong: it is behind authentication, it takes the text in a body
 * rather than a query string, the shorter title minimum really is enforced (this is
 * called while somebody types, so a 400 on a half-written title would mean silence
 * until one exact keystroke), and unknown keys are stripped — a client cannot smuggle
 * a `categoryId` in and have it echoed back as though the server had decided it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Priority } from '@shared/enums';
import { Category } from '@/models';
import { createApp } from '@/app';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let employeeToken: string;

const PASSWORD = 'DevPassword123';
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  /* The first account registered becomes ADMIN; everyone after is an EMPLOYEE. */
  await request(app)
    .post('/api/auth/register')
    .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: PASSWORD });

  const employee = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Ed Employee', email: 'ed@example.com', password: PASSWORD });
  expect(employee.status).toBe(201);
  employeeToken = employee.body.data.accessToken;

  await Category.create({
    name: 'Network',
    slug: 'network',
    keywords: ['vpn', 'wifi'],
    defaultPriority: Priority.HIGH,
    sortOrder: 1,
  });
});

beforeEach(resetRateLimits);
afterAll(stopDb);

describe('POST /api/suggestions/ticket', () => {
  it('answers an employee with a suggestion they can disagree with', async () => {
    const response = await request(app)
      .post('/api/suggestions/ticket')
      .set(authed(employeeToken))
      .send({ title: 'VPN keeps dropping', description: 'Every few minutes on calls.' });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual([
      'categoryId',
      'categoryName',
      'confidence',
      'priority',
      'reason',
      'relatedArticles',
      'source',
    ]);
    expect(response.body.data.categoryName).toBe('Network');
    expect(response.body.data.priority).toBe(Priority.HIGH);
    expect(response.body.data.source).toBe('heuristic');
    expect(typeof response.body.data.reason).toBe('string');
  });

  it('suggests on a title too short to create a ticket with', async () => {
    // `POST /api/tickets` wants five characters; this wants three, on purpose.
    const response = await request(app)
      .post('/api/suggestions/ticket')
      .set(authed(employeeToken))
      .send({ title: 'vpn' });

    expect(response.status).toBe(200);
    expect(response.body.data.categoryName).toBe('Network');
  });

  it('rejects a title of one character', async () => {
    const response = await request(app)
      .post('/api/suggestions/ticket')
      .set(authed(employeeToken))
      .send({ title: 'v' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('ignores a category the client tries to supply', async () => {
    const response = await request(app)
      .post('/api/suggestions/ticket')
      .set(authed(employeeToken))
      .send({ title: 'office plants need water', categoryId: 'not-a-real-id', priority: 'URGENT' });

    expect(response.status).toBe(200);
    /* Stripped by `validate()`, so the answer is the server's own and nothing echoes. */
    expect(response.body.data.categoryId).toBeNull();
    expect(response.body.data.priority).toBe(Priority.MEDIUM);
  });

  it('is behind authentication', async () => {
    const response = await request(app)
      .post('/api/suggestions/ticket')
      .send({ title: 'vpn is down' });

    expect(response.status).toBe(401);
  });
});
