/**
 * ServiceDesk Pro — knowledge base routes over HTTP.
 *
 * The service suite proves the review boundary holds when the service is called
 * directly. This one proves the routes are wired to it, which is a different claim: the
 * publish rule is enforced by *which route* you can reach, so a `POST /:id/publish`
 * missing its `requirePermission()` would hand every technician the reviewer's job, and
 * no service test would notice.
 *
 * The three claims worth an HTTP round trip:
 *
 *  - an employee cannot write an article, a technician can,
 *  - a technician cannot publish one — not by calling the publish route, and not by
 *    smuggling a status into the create body either,
 *  - `GET /search` reaches the search handler rather than the `/:id` handler, which is
 *    a route-ordering bug that a service test cannot see at all.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ArticleStatus, Role } from '@shared/enums';
import { createApp } from '@/app';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let adminToken: string;
let techToken: string;
let employeeToken: string;

const PASSWORD = 'DevPassword123';

const DRAFT = {
  title: 'Reconnecting the office VPN',
  summary: 'What to try when the VPN client refuses to connect from home.',
  body: 'Open the client, choose the office profile, and sign in with your work account.',
};

async function registerUser(name: string, email: string): Promise<{ token: string; id: string }> {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD });
  expect(response.status).toBe(201);
  return { token: response.body.data.accessToken, id: response.body.data.user.id };
}

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  /* The first account registered becomes ADMIN; everyone after is an EMPLOYEE. */
  adminToken = (await registerUser('Ada Lovelace', 'ada@example.com')).token;
  employeeToken = (await registerUser('Ed Employee', 'ed@example.com')).token;

  /* Promoted through `PATCH /api/users/:id`, keeping the token from registration —
   * a role change is effective on the next request, not on the next login. */
  const tech = await registerUser('Grace Hopper', 'grace@example.com');
  const promoted = await request(app)
    .patch(`/api/users/${tech.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ role: Role.TECHNICIAN });
  expect(promoted.status).toBe(200);
  techToken = tech.token;
});

beforeEach(resetRateLimits);
afterAll(stopDb);

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('writing and publishing are separate permissions', () => {
  it('lets a technician write a draft but not publish it', async () => {
    expect((await request(app).post('/api/articles').set(authed(employeeToken)).send(DRAFT)).status).toBe(403);

    const created = await request(app).post('/api/articles').set(authed(techToken)).send(DRAFT);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe(ArticleStatus.DRAFT);
    expect(created.headers.location).toBe(`/api/articles/${created.body.data.id}`);

    const id = created.body.data.id;
    const version = created.body.data.version;

    /* The author holds ARTICLE_WRITE and reaches PATCH, but ARTICLE_PUBLISH gates this
     * route and only ADMIN holds it. */
    const selfPublish = await request(app)
      .post(`/api/articles/${id}/publish`)
      .set(authed(techToken))
      .send({ version });
    expect(selfPublish.status).toBe(403);

    const approved = await request(app)
      .post(`/api/articles/${id}/publish`)
      .set(authed(adminToken))
      .send({ version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe(ArticleStatus.PUBLISHED);
  });

  it('ignores a status smuggled into the create body', async () => {
    /* `status` is not in the schema, and `validate()` strips unknown keys rather than
     * rejecting them, so the request succeeds — as a draft. This test exists to prove
     * the field is dropped rather than honoured. */
    const created = await request(app)
      .post('/api/articles')
      .set(authed(techToken))
      .send({ ...DRAFT, title: 'Smuggled status', status: ArticleStatus.PUBLISHED, viewCount: 500 });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe(ArticleStatus.DRAFT);
    expect(created.body.data.viewCount).toBe(0);
    expect(created.body.data.publishedAt).toBeNull();
  });

  it('refuses an anonymous caller before it looks at permissions', async () => {
    expect((await request(app).get('/api/articles')).status).toBe(401);
    expect((await request(app).post('/api/articles').send(DRAFT)).status).toBe(401);
  });
});

describe('route ordering', () => {
  it('sends GET /search to the search handler, not the id handler', async () => {
    const created = await request(app)
      .post('/api/articles')
      .set(authed(techToken))
      .send({ ...DRAFT, title: 'Clearing a stuck printer queue' });
    await request(app)
      .post(`/api/articles/${created.body.data.id}/publish`)
      .set(authed(adminToken))
      .send({ version: created.body.data.version });

    const hits = await request(app)
      .get('/api/articles/search')
      .query({ q: 'printer' })
      .set(authed(employeeToken));

    /* An id-route match would have failed `objectIdField` and answered 400. A 200 with
     * an array under `data` is only reachable through the search handler. */
    expect(hits.status).toBe(200);
    expect(Array.isArray(hits.body.data)).toBe(true);
    expect(hits.body.data[0].title).toBe('Clearing a stuck printer queue');
    expect(hits.body.data[0]).not.toHaveProperty('body');
  });
});
