/**
 * ServiceDesk Pro — upload validation, driven over real HTTP.
 *
 * The only suite here that goes through Express with supertest instead of calling a
 * service directly, and it does so because it has to: multer parses the multipart
 * body and writes the bytes to disk *inside* the request. None of that runs when a
 * test calls `tickets.create()` with an `ActorContext`, so the three-layer check in
 * `upload.middleware.ts` — streamed size limit, MIME allow-list, and the extension
 * cross-check — is invisible to every other test in this repo. It also happens to
 * guard the one input that is entirely attacker-chosen, which is a poor thing to
 * leave untested.
 *
 * Every rejection additionally asserts that the upload directory holds no more files
 * afterwards. Multer writes to disk before any validation of ours runs, so a refused
 * request that slipped past `cleanupOnFailure()` would leave a file that nothing in
 * the database references — and those are invisible until the disk fills.
 */

import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '@/app';
import { env } from '@/config/env';
import { resetRateLimits } from '@/middleware/rate-limit';
import { clearDb, startDb, stopDb } from '@/test/db';

let app: Express;
let token: string;
let categoryId: string;

/** A PNG's first eight bytes. Nothing reads them; it keeps the fixtures honest. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function countUploads(): number {
  return fs.existsSync(env.uploadDir) ? fs.readdirSync(env.uploadDir).length : 0;
}

/**
 * Posts a ticket with whatever files are handed over. The text fields are always
 * valid, so any 4xx is the upload layer's verdict and not the body schema's.
 */
function postTicket(files: readonly { name: string; type: string; body: Buffer | string }[]) {
  const pending = request(app)
    .post('/api/tickets')
    .set('Authorization', `Bearer ${token}`)
    .field('title', 'Laptop will not wake from sleep')
    .field('description', 'It powers on but the screen stays black until a hard reset.')
    .field('categoryId', categoryId);
  for (const file of files) {
    pending.attach('files', Buffer.from(file.body), { filename: file.name, contentType: file.type });
  }
  return pending;
}

beforeAll(async () => {
  await startDb();
  await clearDb();
  app = createApp();

  /* The first account registered becomes the admin — see `auth.service.ts`. That is
   * what makes a category creatable here without reaching past the API to set a role. */
  const registered = await request(app).post('/api/auth/register').send({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'DevPassword123',
  });
  expect(registered.status).toBe(201);
  token = registered.body.data.accessToken;

  const category = await request(app)
    .post('/api/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Hardware' });
  expect(category.status).toBe(201);
  categoryId = category.body.data.id;
});

/* The upload bucket allows 60 per window and this suite is well under that, but a
 * shared limiter across files is exactly the kind of coupling that produces a 429
 * nobody can explain. */
beforeEach(resetRateLimits);
afterAll(stopDb);

describe('a file has to get past all three layers', () => {
  it('accepts one that agrees with itself', async () => {
    const response = await postTicket([
      { name: 'screenshot.png', type: 'image/png', body: PNG_MAGIC },
    ]);
    expect(response.status).toBe(201);
    expect(response.body.data.attachmentCount).toBe(1);
    expect(response.body.data.attachments).toHaveLength(1);

    /* The name offered back is the one the user chose; the generated disk name stays
     * server-side, or anyone could start guessing at sibling paths. */
    expect(response.body.data.attachments[0].filename).toBe('screenshot.png');
    expect(response.body.data.attachments[0]).not.toHaveProperty('storedName');
  });

  it('refuses a type that is not on the allow-list', async () => {
    const before = countUploads();
    const response = await postTicket([
      { name: 'setup.exe', type: 'application/x-msdownload', body: 'MZ' },
    ]);
    expect(response.status).toBe(415);
    expect(countUploads()).toBe(before);
  });

  it('refuses a permitted type wearing the wrong extension', async () => {
    /* `payload.png` declaring itself an executable, and `report.pdf.exe` — the two
     * cases that defeat a naive check of either field on its own. */
    const before = countUploads();
    const disguised = await postTicket([
      { name: 'report.pdf.exe', type: 'application/pdf', body: '%PDF-1.7' },
    ]);
    expect(disguised.status).toBe(400);

    const mislabelled = await postTicket([
      { name: 'payload.png', type: 'text/csv', body: 'a,b\n1,2\n' },
    ]);
    expect(mislabelled.status).toBe(400);
    expect(countUploads()).toBe(before);
  });

  it('refuses a file with no extension at all', async () => {
    const before = countUploads();
    const response = await postTicket([{ name: 'README', type: 'text/plain', body: 'hello' }]);
    expect(response.status).toBe(400);
    expect(countUploads()).toBe(before);
  });
});

describe('the limits multer enforces while streaming', () => {
  it('refuses a file over the size limit', async () => {
    const before = countUploads();
    const oversized = Buffer.alloc(env.maxUploadBytes + 1024, 0x41);
    const response = await postTicket([
      { name: 'huge.txt', type: 'text/plain', body: oversized },
    ]);
    expect(response.status).toBe(413);

    /* The interesting half: multer aborts mid-stream, so the partial file is already
     * on disk when the error is raised. */
    expect(countUploads()).toBe(before);
  });

  it('refuses more than five files in one request', async () => {
    const before = countUploads();
    const six = Array.from({ length: 6 }, (_unused, index) => ({
      name: `note-${index}.txt`,
      type: 'text/plain',
      body: `file ${index}`,
    }));
    const response = await postTicket(six);
    expect(response.status).toBe(400);
    expect(countUploads()).toBe(before);
  });

  it('leaves nothing behind when a later layer rejects the request', async () => {
    /* A file that passes every upload check, on a request the *body* schema refuses.
     * The upload has already been written by then, and only the `finish` hook in
     * `cleanupOnFailure()` removes it. */
    const before = countUploads();
    const response = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'no')
      .field('description', 'too short')
      .field('categoryId', categoryId)
      .attach('files', PNG_MAGIC, { filename: 'fine.png', contentType: 'image/png' });
    /* 400 from `validate()`, and the code proves it was the body schema that objected
     * and not the upload layer -- otherwise this test would pass for the wrong reason. */
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');

    /* `cleanupOnFailure()` unlinks on the response's `finish` event, which fires after
     * supertest has already resolved. */
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(countUploads()).toBe(before);
  });
});
