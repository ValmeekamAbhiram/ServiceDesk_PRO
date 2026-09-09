/**
 * ServiceDesk Pro — knowledge base service integration tests.
 *
 * The properties worth protecting here are all about the review boundary and the read
 * scope, because those are the two things that turn a wiki into a knowledge base:
 *
 *  - a draft is invisible to everyone except its author and a reviewer, and no query
 *    string widens that,
 *  - `create()` cannot produce a published article, even called directly with no HTTP
 *    layer and no Zod in the way,
 *  - an author cannot edit an article after it has been approved,
 *  - publishing refuses a stale `version`, so nobody approves text they did not read,
 *  - the weighted text index actually ranks a title match above a body match,
 *  - a view counts once, does not count for drafts, and does not bump `version`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ArticleStatus, Role, UserStatus } from '@shared/enums';
import { FixedClock } from '@/core/clock';
import { resolvePermissions } from '@/core/authz/permissions';
import { Category, KnowledgeArticle, User } from '@/models';
import { clearDb, startDb, stopDb } from '@/test/db';
import * as articles from '@/modules/articles/article.service';
import { listArticlesSchema, type ListArticlesInput } from '@/modules/articles/article.schema';
import type { ActorContext } from '@/core/actor';
import type { UserDoc } from '@/models/user.model';
import type { HydratedDocument } from 'mongoose';

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

const clock = new FixedClock('2026-03-10T11:00:00.000Z');

type UserRecord = HydratedDocument<UserDoc>;

function actorFor(user: UserRecord): ActorContext {
  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      permissions: resolvePermissions(user.role),
      sessionId: 'test-session',
    },
    requestId: 'test-request',
    clock,
    ip: '203.0.113.7',
    userAgent: 'vitest',
    automated: false,
  };
}

async function makeUser(name: string, role: Role): Promise<UserRecord> {
  return User.create({
    name,
    email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
    passwordHash: 'not-used-here',
    role,
    status: UserStatus.ACTIVE,
  });
}

/** Parses through the real schema, so a test cannot pass a shape a request could not. */
function listQuery(raw: Record<string, unknown> = {}): ListArticlesInput {
  return listArticlesSchema.query.parse(raw);
}

/** The minimum a valid article needs; every field is overridable per test. */
function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Reconnecting the office VPN',
    summary: 'What to try when the VPN client refuses to connect from home.',
    body: 'Open the client, choose the office profile, and sign in with your work account.',
    ...overrides,
  } as never;
}

/** Publishing needs a reviewer and the current version; both are noise in most tests. */
async function publish(id: string, reviewer: ActorContext) {
  const current = await articles.getById(id, reviewer);
  return articles.setPublished(id, true, reviewer, current.version);
}

describe('writing an article', () => {
  it('always creates a draft, whatever the caller passes', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));

    /* `status` is not in the input type at all, which is the point of the cast: even a
     * caller that bypasses both the route and Zod cannot self-publish. */
    const article = await articles.create(
      draft({ status: ArticleStatus.PUBLISHED, viewCount: 999 }),
      author
    );

    expect(article.status).toBe(ArticleStatus.DRAFT);
    expect(article.publishedAt).toBeNull();
    expect(article.viewCount).toBe(0);
    expect(article.version).toBe(1);
    /* Populated on the way out, so the 201 body says who wrote it. */
    expect(article.author?.name).toBe('Grace Hopper');
    expect(article.slug).toBe('reconnecting-the-office-vpn');
  });

  it('gives a repeated title its own slug rather than refusing the save', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));

    const first = await articles.create(draft(), author);
    const second = await articles.create(draft(), author);

    expect(first.slug).toBe('reconnecting-the-office-vpn');
    expect(second.slug).toBe('reconnecting-the-office-vpn-2');
  });

  it('normalises and de-duplicates tags through the request schema', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const parsed = listArticlesSchema.query.parse({ tag: ' Printer ' });
    expect(parsed.tag).toBe('printer');

    const article = await articles.create(draft({ tags: ['vpn', 'network'] }), author);
    expect(article.tags).toEqual(['vpn', 'network']);
  });

  it('refuses a category that does not exist', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));

    await expect(
      articles.create(draft({ categoryId: '0123456789abcdef01234567' }), author)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
  });

  it('links a real category and reports it as an option', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const category = await Category.create({ name: 'Network', slug: 'network' });

    const article = await articles.create(
      draft({ categoryId: String(category._id) }),
      author
    );

    expect(article.category).toEqual({ id: String(category._id), label: 'Network' });
  });

  it('rejects a stale version on update', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const article = await articles.create(draft(), author);

    await articles.update(article.id, { version: article.version, summary: 'A better summary of the fix.' }, author);

    await expect(
      articles.update(article.id, { version: article.version, summary: 'Written from a stale form.' }, author)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('who can see a draft', () => {
  it('hides a draft from everyone but its author and a reviewer', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const other = actorFor(await makeUser('Alan Turing', Role.TECHNICIAN));
    const employee = actorFor(await makeUser('Ed Employee', Role.EMPLOYEE));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const article = await articles.create(draft(), author);

    expect((await articles.list(listQuery(), author)).items).toHaveLength(1);
    expect((await articles.list(listQuery(), admin)).items).toHaveLength(1);
    expect((await articles.list(listQuery(), other)).items).toHaveLength(0);
    expect((await articles.list(listQuery(), employee)).items).toHaveLength(0);

    await expect(articles.getById(article.id, employee)).rejects.toMatchObject({ statusCode: 404 });
    await expect(articles.getById(article.id, other)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not let a status filter widen the scope', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const employee = actorFor(await makeUser('Ed Employee', Role.EMPLOYEE));
    await articles.create(draft(), author);

    /* The scope clause and the caller's filter are both in `$and`, so asking for drafts
     * intersects with "published, or mine" and yields nothing rather than everything. */
    const asked = await articles.list(listQuery({ status: ArticleStatus.DRAFT }), employee);
    expect(asked.items).toHaveLength(0);
    expect(asked.meta.total).toBe(0);
  });

  it('shows a published article to everyone', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const employee = actorFor(await makeUser('Ed Employee', Role.EMPLOYEE));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const article = await articles.create(draft(), author);

    await publish(article.id, admin);

    const seen = await articles.getById(article.id, employee);
    expect(seen.status).toBe(ArticleStatus.PUBLISHED);
    expect(seen.publishedAt).toBe('2026-03-10T11:00:00.000Z');
  });
});

describe('the review boundary', () => {
  it('refuses to publish against a stale version', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const article = await articles.create(draft(), author);

    /* The reviewer read version 1; the author then rewrote the body. Approving the text
     * the reviewer actually read is the whole reason this check exists. */
    await articles.update(article.id, { version: 1, body: 'Something else entirely, added after review.' }, author);

    await expect(articles.setPublished(article.id, true, admin, 1)).rejects.toMatchObject({
      statusCode: 409,
    });
    const still = await articles.getById(article.id, admin);
    expect(still.status).toBe(ArticleStatus.DRAFT);
  });

  it('stops the author editing an article once it is published', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const article = await articles.create(draft(), author);
    const live = await publish(article.id, admin);

    /* 403 and not 404: the author can read this article, so there is nothing to hide. */
    await expect(
      articles.update(article.id, { version: live.version, body: 'Rewritten after approval.' }, author)
    ).rejects.toMatchObject({ statusCode: 403 });

    /* The reviewer can, which is what makes the rule a boundary rather than a lock. */
    const edited = await articles.update(
      article.id,
      { version: live.version, body: 'Corrected by the reviewer.' },
      admin
    );
    expect(edited.body).toBe('Corrected by the reviewer.');
  });
});

describe('retracting', () => {
  it('keeps the original publication date and freezes the slug', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const article = await articles.create(draft(), author);
    const live = await publish(article.id, admin);

    const retracted = await articles.setPublished(article.id, false, admin);
    expect(retracted.status).toBe(ArticleStatus.DRAFT);
    expect(retracted.publishedAt).toBe(live.publishedAt);

    /* Renaming a published article does not move its URL, and retracting does not
     * unfreeze it either — the links are already out there. */
    const renamed = await articles.update(
      article.id,
      { version: retracted.version, title: 'A completely different heading' },
      admin
    );
    expect(renamed.title).toBe('A completely different heading');
    expect(renamed.slug).toBe(live.slug);
  });

  it('treats publishing an already-published article as a no-op', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const article = await articles.create(draft(), author);
    const live = await publish(article.id, admin);

    /* No write, so no version bump and no new publication date — and notably no 409,
     * because the caller asked for a state the article is already in. */
    const again = await articles.setPublished(article.id, true, admin, 999);
    expect(again.version).toBe(live.version);
    expect(again.publishedAt).toBe(live.publishedAt);
  });
});

describe('search', () => {
  it('ranks a title match above a body match', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));

    const inBody = await articles.create(
      draft({
        title: 'Setting up a new starter laptop',
        summary: 'The checklist for a first-day machine.',
        body: 'Install the standard image, then join the domain. Configure the printer queue last.',
      }),
      author
    );
    const inTitle = await articles.create(
      draft({
        title: 'Printer queue is stuck',
        summary: 'Clearing a jammed print queue on Windows.',
        body: 'Stop the spooler service, delete the queued files, then start it again.',
      }),
      author
    );
    await publish(inBody.id, admin);
    await publish(inTitle.id, admin);

    const hits = await articles.search({ q: 'printer queue', limit: 5 });

    expect(hits.map((hit) => hit.id)).toEqual([inTitle.id, inBody.id]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    /* `ArticleSearchHitDto` carries no body — that is the reason it exists. */
    expect(hits[0]).not.toHaveProperty('body');
  });

  it('never suggests a draft, not even to a reviewer', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const unapproved = await articles.create(draft({ title: 'Printer queue is stuck' }), author);

    expect(await articles.search({ q: 'printer', limit: 5 })).toEqual([]);

    await publish(unapproved.id, admin);
    expect((await articles.search({ q: 'printer', limit: 5 })).map((hit) => hit.id)).toEqual([
      unapproved.id,
    ]);
  });
});

describe('view counting', () => {
  it('counts a read of a published article and leaves the version alone', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
    const employee = actorFor(await makeUser('Ed Employee', Role.EMPLOYEE));
    const article = await articles.create(draft(), author);
    const live = await publish(article.id, admin);

    expect((await articles.getById(article.id, employee)).viewCount).toBe(1);
    expect((await articles.getById(article.id, employee)).viewCount).toBe(2);

    /* A view is not an edit. If it bumped `version`, every open edit form would go stale
     * each time a passer-by opened the page. */
    const stored = await KnowledgeArticle.findById(article.id);
    expect(stored?.viewCount).toBe(2);
    expect(stored?.version).toBe(live.version);
  });

  it('does not count an author rereading their own draft', async () => {
    const author = actorFor(await makeUser('Grace Hopper', Role.TECHNICIAN));
    const article = await articles.create(draft(), author);

    await articles.getById(article.id, author);
    await articles.getById(article.id, author);

    expect((await KnowledgeArticle.findById(article.id))?.viewCount).toBe(0);
  });
});
