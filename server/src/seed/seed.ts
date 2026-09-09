/**
 * ServiceDesk Pro — the seeder.
 *
 * ## Why this drives the services instead of writing documents
 *
 * The tempting way to seed a helpdesk is `Ticket.insertMany([...])` with hand-computed
 * fields. It is faster and it is wrong, for a reason that shows up immediately on the
 * dashboard: a ticket's SLA deadline is not a timestamp plus four hours. It is the
 * result of walking a business-hours calendar in `Asia/Kolkata`, skipping weekends and
 * evenings, from a start instant that may itself be out of hours. Recomputing that here
 * would mean a second implementation of the engine — and the moment the two disagree,
 * the seeded data quietly stops matching what the running application would produce.
 *
 * So every ticket in the seed is created by `ticketService.create()`, assigned by
 * `assign()`, replied to by `addComment()` and resolved by `changeStatus()`, exactly as
 * a person would. Status history, ticket numbers, first-response times, the four
 * denormalised counters and both SLA verdicts are therefore real rather than asserted.
 *
 * ## What the clock does
 *
 * Services read "now" from `actor.clock`, never `Date.now()` — so handing each step a
 * `FixedClock` positioned in the past is all it takes to build three months of history.
 * The one thing that escapes it is Mongoose's own `timestamps: true`, which writes
 * `createdAt` from the host clock. `backdate()` below corrects that through the raw
 * driver, and it has to: the dashboard's fourteen-day volume chart reads `createdAt`,
 * so without it every seeded ticket would stack up on today.
 *
 * ## What it does not do
 *
 * No audit rows and no attachments. Both are written from request-scoped middleware
 * rather than from the services, and inventing plausible-looking audit entries for
 * writes that no user actually made would put fiction in the one collection whose value
 * is that it is not fiction.
 */

import bcrypt from 'bcryptjs';
import {
  ArticleStatus,
  AssetStatus,
  AssetType,
  CommentVisibility,
  Priority,
  Role,
  TicketStatus,
  UserStatus,
} from '@shared/enums';
import { DAY_MS } from '@shared/utils';
import { env } from '@/config/env';
import { moduleLogger } from '@/config/logger';
import { clockAt, FixedClock, type Clock } from '@/core/clock';
import { resolvePermissions } from '@/core/authz/permissions';
import type { ActorContext, AuthenticatedUser } from '@/core/actor';
import {
  ASSET_SEQUENCE,
  Asset,
  Attachment,
  AuditLog,
  Category,
  Counter,
  KnowledgeArticle,
  Notification,
  Session,
  SlaPolicy,
  SystemSettings,
  TICKET_SEQUENCE,
  Ticket,
  TicketComment,
  User,
  resetSequence,
  toObjectId,
  type CategoryDoc,
  type SlaPolicyDoc,
  type UserDoc,
} from '@/models';
import { getSlaPolicy, invalidateSlaPolicyCache } from '@/modules/sla/sla-policy.service';
import {
  getSystemSettings,
  invalidateSystemSettingsCache,
} from '@/modules/settings/settings.service';
import * as assetService from '@/modules/assets/asset.service';
import * as articleService from '@/modules/articles/article.service';
import * as ticketService from '@/modules/tickets/ticket.service';
import { ARTICLES, ASSETS, CATEGORIES, PEOPLE, TICKET_TEMPLATES } from '@/seed/data';
import { DEFAULT_SEED, Rng } from '@/seed/random';

const log = moduleLogger('seed');

/* ──────────────────────────────── the contract ─────────────────────────────── */

export interface SeedOptions {
  /** Wipe every collection first. Without it, a populated database is left alone. */
  reset: boolean;
  /** People, categories and the SLA policy only — no history to read. */
  minimal: boolean;
  ticketCount: number;
  assetCount: number;
  userCount: number;
  monthsOfHistory: number;
  /** Shared by every seeded account. Printed at the end, never logged. */
  password: string;
  /** Same value, same database. See `random.ts`. */
  rngSeed: number;
}

export function optionsFromEnv(overrides: Partial<SeedOptions> = {}): SeedOptions {
  return {
    reset: false,
    minimal: false,
    ticketCount: env.SEED_TICKET_COUNT,
    assetCount: env.SEED_ASSET_COUNT,
    userCount: env.SEED_USER_COUNT,
    monthsOfHistory: env.SEED_MONTHS_OF_HISTORY,
    password: env.SEED_PASSWORD,
    rngSeed: DEFAULT_SEED,
    ...overrides,
  };
}

export interface SeedCounts {
  users: number;
  categories: number;
  assets: number;
  articles: number;
  tickets: number;
  comments: number;
  notifications: number;
}

export interface SeedResult {
  counts: SeedCounts;
  /** The three documented demo accounts, in the order they should be printed. */
  logins: { role: Role; name: string; email: string }[];
  /** Wall-clock milliseconds the run took. */
  durationMs: number;
}

/* ───────────────────────────────── plumbing ────────────────────────────────── */

/**
 * Build an actor for a seeded user at a chosen instant.
 *
 * `permissions` comes from `resolvePermissions(role)` — the same derivation the
 * authentication middleware uses — rather than from a list written out here, so a
 * technician in the seed can do exactly what a technician can do at runtime and no more.
 * That matters more than it looks: if the seeder held wider permissions than the role,
 * it could produce states the application cannot reach, and a screen that renders them
 * would look correct while being untestable through the UI.
 */
function actorFor(user: SeedUser, clock: Clock): ActorContext {
  const authenticated: AuthenticatedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: UserStatus.ACTIVE,
    permissions: resolvePermissions(user.role),
    sessionId: null,
  };
  return {
    user: authenticated,
    requestId: 'seed',
    clock,
    ip: null,
    userAgent: null,
    /* False, and the choice is not cosmetic. `automated` marks work whose actor is a
     * background job rather than a person, and the notification service reads it to
     * decide whether to store an `actorId` at all. The seeder is not acting as itself
     * here -- it is replaying what fourteen named people did -- so flagging these writes
     * as automated would blank the actor on every notification row and gain nothing.
     * The system actor in `core/actor.ts` is what `automated: true` is for. */
    automated: false,
  };
}

interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

function toSeedUser(doc: UserDoc): SeedUser {
  return { id: String(doc._id), name: doc.name, email: doc.email, role: doc.role };
}

/**
 * Rewrite `createdAt`/`updatedAt` on a document that the services just wrote.
 *
 * Through `Model.collection`, deliberately. Mongoose's own `timestamps: true` sets these
 * from the host clock on every `save()`, and it does so *after* any middleware — so
 * there is no hook that could set them to a historical instant. The raw driver skips the
 * ODM entirely, which is the only way to make a ticket that says it was raised in June.
 *
 * Nothing else in the codebase writes through `.collection`, and nothing else should:
 * it bypasses validation, casting and the version key. It is acceptable here because the
 * two fields involved are metadata Mongoose owns rather than application state, and
 * because the alternative is a fleet of tickets all dated today.
 */
interface RawCollection {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
}

/* Structural, not `Collection<Document>` from the `mongodb` package. Mongoose bundles its
 * own copy of the driver, so the two `Collection` types are nominally different and a
 * `Model.collection` will not satisfy an import from the top-level one. Naming the three
 * methods actually used sidesteps that without a cast. */
function raw(model: { collection: unknown }): RawCollection {
  return model.collection as RawCollection;
}

async function backdate(
  model: { collection: unknown },
  id: unknown,
  createdAt: Date,
  updatedAt: Date = createdAt
): Promise<void> {
  await raw(model).updateOne({ _id: id }, { $set: { createdAt, updatedAt } });
}

/** Whole months before `from`, preserving the time of day. */
function monthsBefore(from: Date, months: number): Date {
  const out = new Date(from);
  out.setMonth(out.getMonth() - months);
  return out;
}

function monthsAfter(from: Date, months: number): Date {
  const out = new Date(from);
  out.setMonth(out.getMonth() + months);
  return out;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* ───────────────────────────────── wiping ──────────────────────────────────── */

/**
 * Empty every collection and rewind both sequences.
 *
 * `deleteMany({})` rather than `dropDatabase()`: dropping would take the indexes with it,
 * and the text indexes on tickets and articles are what make search work — a seeded
 * database where `?q=` returns nothing looks exactly like a broken feature. The
 * sequences are reset so a fresh run starts at `TKT-0001` again, which matters only for
 * how the data reads, but reads badly if it starts at 361.
 *
 * `Counter` is included in the list and then explicitly reset, because the two calls do
 * different things: the delete removes counters for anything not listed here, and
 * `resetSequence` recreates the two that must exist at zero.
 */
async function wipe(): Promise<void> {
  /* The audit log is append-only, and its schema middleware makes `deleteMany` throw. That
   * guard is there to stop the application — and anyone who reaches it — from editing
   * history, and it should stay. But `--reset` claims to empty the database, and a reset
   * that silently left the audit trail of the previous dataset behind would leave rows
   * pointing at ticket ids that no longer exist. So this one collection is cleared through
   * the driver, which the middleware does not see. It is the only deliberate bypass in the
   * codebase, it lives in a script that refuses to run in production, and nothing else
   * should copy it. */
  await raw(AuditLog).deleteMany({});

  await Promise.all([
    Attachment.deleteMany({}),
    Notification.deleteMany({}),
    TicketComment.deleteMany({}),
    Ticket.deleteMany({}),
    Asset.deleteMany({}),
    KnowledgeArticle.deleteMany({}),
    Category.deleteMany({}),
    Session.deleteMany({}),
    SlaPolicy.deleteMany({}),
    SystemSettings.deleteMany({}),
    User.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  await Promise.all([resetSequence(TICKET_SEQUENCE, 0), resetSequence(ASSET_SEQUENCE, 0)]);

  /* Both singletons are cached in process. Deleting the documents without clearing the
   * caches would leave this run holding a policy whose `_id` no longer exists — and the
   * first ticket created would attach an SLA from a deleted policy. */
  invalidateSlaPolicyCache();
  invalidateSystemSettingsCache();

  log.info('Existing data removed');
}

/* ────────────────────────────────── people ─────────────────────────────────── */

/**
 * One bcrypt hash, reused for every seeded account.
 *
 * Hashing fourteen times at the configured cost would add a few seconds for no benefit:
 * the password is identical, published in the console output, and documented as
 * development-only. Sharing a salt across accounts would be a real weakness if these
 * were real credentials — which is exactly why `run.ts` refuses to seed in production
 * and prints the password in plain sight rather than pretending it is a secret.
 */
async function seedUsers(options: SeedOptions): Promise<SeedUser[]> {
  const passwordHash = await bcrypt.hash(options.password, env.BCRYPT_ROUNDS);
  const wanted = PEOPLE.slice(0, Math.max(3, options.userCount));

  const docs = await User.insertMany(
    wanted.map((person) => ({
      name: person.name,
      email: person.email,
      passwordHash,
      role: person.role,
      status: UserStatus.ACTIVE,
      jobTitle: person.jobTitle,
      phone: person.phone,
      /* Never set: a seeded account has not signed in, and pretending otherwise would
       * put a login that never happened on the admin screen. */
      lastLoginAt: null,
      passwordChangedAt: null,
    }))
  );

  log.info({ users: docs.length }, 'Users created');
  return docs.map((doc) => toSeedUser(doc as unknown as UserDoc));
}

/* ─────────────────────────── categories and policy ─────────────────────────── */

/**
 * Written straight to the model rather than through `categoryService`.
 *
 * The service is a thin wrapper over the same insert here — it exists to map DTOs and to
 * reject a duplicate slug — and going around it lets the seed set `sortOrder` and the
 * retired flag in one pass. This is reference data with no lifecycle, so there is no
 * behaviour to lose.
 */
async function seedCategories(): Promise<Map<string, CategoryDoc>> {
  const docs = await Category.insertMany(
    CATEGORIES.map((category) => ({
      name: category.name,
      slug: category.slug,
      description: category.description,
      color: category.color,
      defaultPriority: category.defaultPriority,
      keywords: category.keywords,
      sortOrder: category.sortOrder,
      active: category.inactive !== true,
    }))
  );

  const bySlug = new Map<string, CategoryDoc>();
  for (const doc of docs) bySlug.set(doc.slug, doc as unknown as CategoryDoc);

  log.info({ categories: docs.length }, 'Categories created');
  return bySlug;
}

/**
 * Bring both singletons into existence and stamp the seed marker.
 *
 * Neither accessor needs help creating its document — each upserts from the schema
 * defaults on first read, which is why a completely unseeded database still has working
 * SLAs. Calling them here is about ordering: the first ticket created below reads the
 * policy, and having it appear as a side effect of that read would mean the policy's
 * `createdAt` sat *after* the oldest ticket that used it.
 *
 * `organizationName` is left at its schema default. Overriding it here would put the
 * demo's fictional company name beyond an administrator's reach on a real deployment.
 */
async function seedSingletons(now: Date): Promise<void> {
  await getSlaPolicy();
  const settings = await getSystemSettings();

  /* `updateOne` and not `settings.save()`: the accessor's return type is the plain
   * document interface, so the hydrated `save()` is not visible to the compiler, and a
   * cast to reach it would be a cast for the sake of two boolean fields. */
  await SystemSettings.updateOne({ _id: settings._id }, { $set: { seeded: true, seededAt: now } });
  invalidateSystemSettingsCache();

  log.info('SLA policy and system settings ready');
}

/* ─────────────────────────────────── assets ────────────────────────────────── */

/** Generated spares, so `SEED_ASSET_COUNT` can be raised without inventing more prose. */
const SPARE_SHAPES: readonly { type: AssetType; name: string; manufacturer: string; model: string }[] = [
  { type: AssetType.LAPTOP, name: 'Pool laptop', manufacturer: 'Lenovo', model: 'ThinkPad L14 G4' },
  { type: AssetType.MONITOR, name: 'Pool monitor', manufacturer: 'Dell', model: 'P2422H' },
  { type: AssetType.DESKTOP, name: 'Pool desktop', manufacturer: 'Dell', model: 'OptiPlex 7010 SFF' },
  { type: AssetType.PHONE, name: 'Pool handset', manufacturer: 'Apple', model: 'iPhone SE' },
  { type: AssetType.OTHER, name: 'Pool dock', manufacturer: 'Dell', model: 'WD19S' },
];

/**
 * Created through `assetService.create()`, which is what allocates the `AST-nnnn` tag from
 * the atomic counter. Reproducing that here would mean a second tag format to keep in
 * step with the first.
 *
 * `warrantyMonths` is relative to the run, not absolute, so the warranty radar on the
 * dashboard has something expiring soon however long after this was written the seed runs.
 */
interface AssetIndex {
  count: number;
  /** User id -> the asset they hold. Empty for anyone without one. */
  byHolder: Map<string, string>;
  /** Printers, displays, switches: kit a ticket can be about that belongs to nobody. */
  shared: string[];
}

async function seedAssets(
  admin: ActorContext,
  people: readonly SeedUser[],
  options: SeedOptions,
  rng: Rng,
  now: Date
): Promise<AssetIndex> {
  const ids: string[] = [];
  const byHolder = new Map<string, string>();
  const shared: string[] = [];

  for (const spec of ASSETS) {
    const holder = spec.holder !== null ? people[spec.holder] : undefined;
    const asset = await assetService.create(
      {
        name: spec.name,
        type: spec.type,
        status: spec.status,
        manufacturer: spec.manufacturer,
        model: spec.model,
        location: spec.location,
        /* Only ever set on an asset that is genuinely in use: a machine on the shelf
         * assigned to somebody is a contradiction the asset list would display. */
        assignedToId: spec.status === AssetStatus.IN_USE && holder ? holder.id : null,
        serialNumber: `SN-${slugify(spec.name).toUpperCase().slice(0, 12)}-${rng.int(1000, 9999)}`,
        purchaseDate: spec.purchaseMonthsAgo === null ? null : monthsBefore(now, spec.purchaseMonthsAgo),
        purchaseCost: spec.purchaseCost,
        warrantyExpiryDate: spec.warrantyMonths === null ? null : monthsAfter(now, spec.warrantyMonths),
        notes: null,
      },
      admin
    );
    ids.push(asset.id);
    if (holder) byHolder.set(holder.id, asset.id);
    /* Retired and in-stock kit is excluded: a ticket about a decommissioned handset or a
     * laptop still in its box is not a ticket anybody would recognise. */
    else if (spec.status === AssetStatus.IN_USE || spec.status === AssetStatus.IN_REPAIR) {
      shared.push(asset.id);
    }
  }

  /* Top up to the configured count. Anything past the named estate is stock. */
  for (let i = ids.length; i < options.assetCount; i += 1) {
    const shape = SPARE_SHAPES[i % SPARE_SHAPES.length]!;
    const asset = await assetService.create(
      {
        name: `${shape.name} ${String(i - ASSETS.length + 1).padStart(2, '0')}`,
        type: shape.type,
        status: AssetStatus.IN_STOCK,
        manufacturer: shape.manufacturer,
        model: shape.model,
        location: 'Bengaluru / IT store',
        assignedToId: null,
        serialNumber: `SN-POOL-${String(i).padStart(4, '0')}`,
        purchaseDate: monthsBefore(now, rng.int(1, 30)),
        purchaseCost: rng.int(12, 190) * 1_000,
        warrantyExpiryDate: monthsAfter(now, rng.int(-6, 30)),
        notes: null,
      },
      admin
    );
    ids.push(asset.id);
  }

  log.info({ assets: ids.length }, 'Assets created');
  return { count: ids.length, byHolder, shared };
}

/* ──────────────────────────────── knowledge base ───────────────────────────── */

/**
 * Authored by a technician, published by the admin — which is the review boundary the
 * knowledge base exists to enforce, executed rather than described. `ARTICLE_WRITE`
 * creates the draft; `ARTICLE_PUBLISH`, which only an admin holds, is a second call by a
 * second actor. The one article left as a draft proves it works: an employee signing in
 * finds four articles, an admin finds five.
 *
 * `viewCount` is written directly afterwards. There is no service path to it on purpose —
 * the counter is incremented by reading an article, so the only honest way to reach 412
 * views through the API would be to fetch the same page 412 times.
 */
async function seedArticles(
  admin: ActorContext,
  author: ActorContext,
  categories: Map<string, CategoryDoc>,
  now: Date
): Promise<number> {
  let created = 0;

  for (const [index, spec] of ARTICLES.entries()) {
    /* Oldest first, spread over the last two months, so "recently updated" has an order. */
    const writtenAt = new Date(now.getTime() - (ARTICLES.length - index) * 9 * DAY_MS);
    const category = spec.category ? categories.get(spec.category) : undefined;

    const draft = await articleService.create(
      {
        title: spec.title,
        summary: spec.summary,
        body: spec.body,
        categoryId: category ? String(category._id) : null,
        tags: spec.tags,
      },
      { ...author, clock: clockAt(writtenAt) }
    );

    if (spec.draft !== true) {
      await articleService.setPublished(draft.id, true, { ...admin, clock: clockAt(writtenAt) }, draft.version);
    }

    await KnowledgeArticle.updateOne({ _id: toObjectId(draft.id) }, { $set: { viewCount: spec.views } });
    await backdate(KnowledgeArticle, toObjectId(draft.id), writtenAt);
    created += 1;
  }

  log.info({ articles: created }, 'Knowledge articles created');
  return created;
}

/* ────────────────────────────────── tickets ────────────────────────────────── */

/**
 * The shape of a finished ticket. Not a status alone: `RESOLVED_LATE` and `RESOLVED`
 * follow the same path with different delays, and the distinction is what puts both a
 * healthy and a breached bar on the dashboard.
 */
type Outcome =
  | 'OPEN_UNTOUCHED'
  | 'OPEN_ANSWERED'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CLOSED_LATE'
  | 'REOPENED';

/**
 * Age decides the outcome, which is the one rule that makes the seeded queue read like a
 * real one. A ticket raised this morning has not been closed yet; a ticket from ten weeks
 * ago almost certainly has. Drawing the outcome uniformly instead would leave a third of
 * a three-month backlog sitting OPEN, and the dashboard would describe a desk in crisis.
 */
function outcomeFor(ageDays: number, rng: Rng): Outcome {
  if (ageDays < 2) {
    return rng.weighted([
      ['OPEN_UNTOUCHED', 4],
      ['OPEN_ANSWERED', 3],
      ['IN_PROGRESS', 3],
      ['RESOLVED', 1],
    ]);
  }
  if (ageDays < 7) {
    return rng.weighted([
      ['OPEN_ANSWERED', 2],
      ['IN_PROGRESS', 4],
      ['ON_HOLD', 2],
      ['RESOLVED', 4],
      ['CLOSED', 2],
      ['CLOSED_LATE', 1],
    ]);
  }
  if (ageDays < 21) {
    return rng.weighted([
      ['IN_PROGRESS', 1],
      ['ON_HOLD', 1],
      ['RESOLVED', 3],
      ['CLOSED', 8],
      ['CLOSED_LATE', 2],
      ['REOPENED', 1],
    ]);
  }
  return rng.weighted([
    ['CLOSED', 12],
    ['CLOSED_LATE', 3],
    ['RESOLVED', 1],
    ['REOPENED', 1],
  ]);
}

/**
 * How long the first reply took, as business minutes from creation.
 *
 * Scaled to the priority's own response target rather than drawn from a fixed range, which
 * is the difference between a desk that mostly hits its SLA and one that misses half of
 * them. A flat four-to-a-hundred-and-eighty minutes looks reasonable until you notice the
 * URGENT target is fifteen minutes and the HIGH one is sixty: two thirds of the queue
 * breaches on arrival, the dashboard's compliance figure reads 50%, and every screen that
 * shows an SLA badge shows the same red.
 *
 * `late` overshoots on purpose. Some real tickets are answered late, the BREACHED state
 * has to be reachable for the badge and the at-risk list to be worth building, and a
 * dataset where nothing ever slipped would be its own kind of lie.
 */
function responseDelayMinutes(targetMinutes: number, late: boolean, rng: Rng): number {
  if (late) return targetMinutes + rng.int(targetMinutes, targetMinutes * 5);
  /* Comfortably inside the target most of the time; a quarter of them close to the wire,
   * so AT_RISK is something the monitor will actually find. */
  const fraction = rng.chance(0.25) ? rng.int(70, 95) / 100 : rng.int(10, 55) / 100;
  return Math.max(2, Math.round(targetMinutes * fraction));
}

/**
 * Re-read the ticket's version.
 *
 * `addComment` returns the comment, not the ticket — but it saves the ticket, because a
 * first public reply stamps `firstRespondedAt` and every reply moves the comment count. So
 * the version has moved on, and the next `changeStatus` carrying the version from before
 * the comment is rejected as a conflict. That rejection is correct: the seeder is subject
 * to the same optimistic-concurrency check as a browser, and a browser re-reads the ticket
 * after posting a reply for exactly this reason. This is that read.
 */
async function currentVersion(ticketId: string): Promise<number> {
  const doc = await Ticket.findById(toObjectId(ticketId)).select('version').lean();
  if (!doc) throw new Error(`Seeded ticket ${ticketId} disappeared mid-build.`);
  return doc.version;
}

interface TicketBuild {
  comments: number;
  /** The instant of the last thing that happened, for backdating and read state. */
  lastEventAt: Date;
}

/**
 * Build one ticket end to end.
 *
 * The clock is advanced between steps rather than replaced, so the ordering within a
 * ticket cannot come out wrong: every timestamp on it is derived from the one before.
 * Each write goes through the service that a person's request would reach, which is why
 * `version` has to be threaded from one call to the next — the seeder is subject to the
 * same optimistic-concurrency check as the UI, and passing a stale version here would
 * fail exactly as it would in a browser.
 */
async function buildTicket(
  template: (typeof TICKET_TEMPLATES)[number],
  requester: SeedUser,
  technician: SeedUser,
  categoryId: string,
  assetId: string | null,
  createdAt: Date,
  outcome: Outcome,
  /** Who performs the assignment — the administrator triaging, or the technician self-picking. */
  assigner: SeedUser,
  policy: SlaPolicyDoc,
  rng: Rng
): Promise<TicketBuild> {
  const clock = new FixedClock(createdAt);
  const requesterActor = actorFor(requester, clock);
  const techActor = actorFor(technician, clock);
  const assignerActor = actorFor(assigner, clock);
  let comments = 0;

  const created = await ticketService.create(
    {
      title: template.title,
      description: template.description,
      categoryId,
      /* Omitted so the category's default applies, unless the template overrides it —
       * which is the same path a reporter who leaves the picker alone takes. */
      ...(template.priority ? { priority: template.priority } : {}),
      ...(assetId ? { assetId } : {}),
    },
    requesterActor
  );
  const ticketId = created.id;
  let version = created.version;

  await backdate(Ticket, toObjectId(ticketId), createdAt);

  if (outcome === 'OPEN_UNTOUCHED') {
    /* Nobody has picked it up. Unassigned and unanswered is a real state, and the queue
     * needs some of it or "unassigned" filters look broken. */
    return { comments, lastEventAt: createdAt };
  }

  /* The response clock starts at creation, so the time spent unassigned counts against the
   * same target the reply is measured against. A fixed "two to ninety minutes to pick it
   * up" would spend six whole URGENT budgets before the technician typed a word, so the
   * budget is drawn once and split: part of it waiting in the queue, the rest writing. */
  const late = outcome === 'CLOSED_LATE';
  const responseMinutes = responseDelayMinutes(
    policy.targets[created.priority].responseMinutes,
    late,
    rng
  );
  const pickupMinutes = Math.max(1, Math.round((responseMinutes * rng.int(30, 60)) / 100));

  /* Assignment first, then the reply — the order a technician actually works in, and the
   * order that makes the assignment notification arrive before the comment one. */
  clock.advanceMinutes(pickupMinutes);
  const assigned = await ticketService.assign(
    ticketId,
    { assigneeId: technician.id, version },
    assignerActor
  );
  version = assigned.version;
  let lastEventAt = clock.now();

  clock.advanceMinutes(Math.max(1, responseMinutes - pickupMinutes));
  const firstReply = await ticketService.addComment(
    ticketId,
    { body: template.replies[0] ?? 'Looking into this now.', visibility: CommentVisibility.PUBLIC },
    techActor
  );
  comments += 1;
  version = await currentVersion(ticketId);
  lastEventAt = clock.now();
  await backdate(TicketComment, toObjectId(firstReply.id), lastEventAt);

  if (template.notes?.[0]) {
    clock.advanceMinutes(rng.int(5, 60));
    const note = await ticketService.addComment(
      ticketId,
      { body: template.notes[0], visibility: CommentVisibility.INTERNAL },
      techActor
    );
    comments += 1;
    version = await currentVersion(ticketId);
    lastEventAt = clock.now();
    await backdate(TicketComment, toObjectId(note.id), lastEventAt);
  }

  if (outcome === 'OPEN_ANSWERED') {
    await backdate(Ticket, toObjectId(ticketId), createdAt, lastEventAt);
    return { comments, lastEventAt };
  }

  clock.advanceMinutes(rng.int(10, 240));
  const working = await ticketService.changeStatus(
    ticketId,
    { status: TicketStatus.IN_PROGRESS, version },
    techActor
  );
  version = working.version;
  lastEventAt = clock.now();

  if (outcome === 'IN_PROGRESS') {
    await backdate(Ticket, toObjectId(ticketId), createdAt, lastEventAt);
    return { comments, lastEventAt };
  }

  if (outcome === 'ON_HOLD') {
    clock.advanceMinutes(rng.int(60, 900));
    const held = await ticketService.changeStatus(
      ticketId,
      {
        status: TicketStatus.ON_HOLD,
        note: 'Waiting on the requester to confirm a convenient time.',
        version,
      },
      techActor
    );
    version = held.version;
    lastEventAt = clock.now();
    await backdate(Ticket, toObjectId(ticketId), createdAt, lastEventAt);
    return { comments, lastEventAt };
  }

  /* A second public reply on the way to a fix, when the template has one. */
  if (template.replies[1]) {
    clock.advanceMinutes(rng.int(20, 600));
    const followUp = await ticketService.addComment(
      ticketId,
      { body: template.replies[1], visibility: CommentVisibility.PUBLIC },
      techActor
    );
    comments += 1;
    version = await currentVersion(ticketId);
    lastEventAt = clock.now();
    await backdate(TicketComment, toObjectId(followUp.id), lastEventAt);
  }

  clock.advanceMinutes(late ? rng.int(1_200, 6_000) : rng.int(30, 900));
  const resolved = await ticketService.changeStatus(
    ticketId,
    { status: TicketStatus.RESOLVED, resolutionNote: template.resolution, version },
    techActor
  );
  version = resolved.version;
  lastEventAt = clock.now();

  if (outcome === 'RESOLVED') {
    await backdate(Ticket, toObjectId(ticketId), createdAt, lastEventAt);
    return { comments, lastEventAt };
  }

  if (outcome === 'REOPENED') {
    /* The requester's own route back, not a staff transition — so this call is made as
     * the requester, which is the only way `reopen()` is reachable for an employee. */
    clock.advanceMinutes(rng.int(240, 2_880));
    const reopened = await ticketService.reopen(
      ticketId,
      { note: 'This has come back today, exactly as before.', version },
      { ...requesterActor, clock }
    );
    version = reopened.version;
    lastEventAt = clock.now();
    await backdate(Ticket, toObjectId(ticketId), createdAt, lastEventAt);
    return { comments, lastEventAt };
  }

  /* CLOSED and CLOSED_LATE: the requester confirmed, or the auto-close window passed. */
  clock.advanceMinutes(rng.int(60, 4_320));
  await ticketService.changeStatus(ticketId, { status: TicketStatus.CLOSED, version }, techActor);
  lastEventAt = clock.now();
  await backdate(Ticket, toObjectId(ticketId), createdAt, lastEventAt);
  return { comments, lastEventAt };
}

/**
 * Notifications are a side effect of the lifecycle above, not something the seeder writes,
 * so they arrive with whatever the historical clock made of them. Two consequences have to
 * be dealt with once per ticket rather than at the end.
 *
 * **Their `createdAt` is real.** Mongoose set it from the host clock, same as everything
 * else. The filter below finds the rows this ticket just produced — safe because seeding is
 * a single sequential process and every earlier ticket's rows have already been moved into
 * the past — and pulls them back to when the event actually happened.
 *
 * **Their `expiresAt` is honest, and that deletes most of them.** The service sets a 60-day
 * TTL from `actor.clock`, so a notification about a ticket from ten weeks ago expired three
 * weeks before the seed ran, and MongoDB's TTL monitor would remove it a minute after this
 * finished — leaving a bell that emptied itself while nobody was looking. Deleting them here
 * instead makes the seed's own summary count true, and matches the state a deployment that
 * really had been running since June would be in.
 */
async function settleNotifications(watermark: Date, eventAt: Date, now: Date): Promise<void> {
  /* Anything older than this is something the recipient would long since have seen. Four
   * days leaves the demo accounts with a believable handful of unread items rather than a
   * badge reading 300. */
  const readBefore = new Date(now.getTime() - 4 * DAY_MS);
  const read = eventAt < readBefore;

  await raw(Notification).updateMany(
    { createdAt: { $gte: watermark } },
    {
      $set: {
        createdAt: eventAt,
        updatedAt: eventAt,
        read,
        readAt: read ? new Date(eventAt.getTime() + 30 * 60_000) : null,
      },
    }
  );
}

interface TicketTotals {
  tickets: number;
  comments: number;
}

/**
 * Drive `options.ticketCount` tickets through the lifecycle above.
 *
 * Templates are shuffled once and then cycled, rather than picked at random each time, so
 * every one of the eighteen appears before any repeats — a random pick over 120 draws
 * leaves two or three templates unused and one appearing eleven times.
 *
 * Requesters and technicians are weighted rather than uniform. `Priya Nair` is the
 * documented employee login and gets a quarter of the tickets so that signing in as her
 * shows a history instead of two rows; the technicians are deliberately uneven so the
 * dashboard's workload panel has something to say.
 */
async function seedTickets(
  people: readonly SeedUser[],
  categories: Map<string, CategoryDoc>,
  assets: AssetIndex,
  options: SeedOptions,
  rng: Rng,
  now: Date
): Promise<TicketTotals> {
  const employees = people.filter((person) => person.role === Role.EMPLOYEE);
  /* Technicians only, not "everyone who is not an employee".
   *
   * The wider filter reads as a synonym and is not one: it puts the administrator at the
   * head of the list, and since the weights below favour the first name, Ada would end up
   * carrying more tickets than anybody on the team. The workload chart would then show the
   * person who configures the system as its busiest engineer. */
  const technicians = people.filter((person) => person.role === Role.TECHNICIAN);
  const admin = people.find((person) => person.role === Role.ADMIN);
  if (employees.length === 0 || technicians.length === 0 || !admin) {
    throw new Error('Seeding tickets needs an administrator, a technician and an employee.');
  }

  /* The demo employee first, then everyone else evenly — plus the administrator, at a low
   * weight.
   *
   * Ada is staff, but she also has a laptop and a printer like everyone else, and she is
   * the first login the seeder prints. Leaving her out of the requester pool gave her an
   * empty "my tickets" page and an empty notification bell, because nothing in the app
   * notifies an administrator about work they did not raise and are not assigned. Both
   * screens are built and correct; with no rows they read as broken. A dozen tickets of her
   * own is what makes them legible. */
  const requesterWeights = [
    ...employees.map((person, index) => [person, index === 0 ? employees.length : 1] as const),
    [admin, 2] as const,
  ];
  /* Ravi is the documented technician login, so he carries the most — and the tail is
   * uneven on purpose, because a workload chart with four equal bars says nothing. */
  const technicianWeights = technicians.map(
    (person, index) => [person, Math.max(1, technicians.length - index)] as const
  );

  /* Read once. `getSlaPolicy()` caches in process, so re-reading per ticket would be free
   * — but passing it down makes it obvious that every ticket in the run was measured
   * against the same policy, which is the whole reason the SLA numbers are comparable. */
  const policy = await getSlaPolicy();

  const windowStart = monthsBefore(now, options.monthsOfHistory);
  const order = rng.shuffle([...TICKET_TEMPLATES]);
  let comments = 0;
  let built = 0;

  /* Chronological, because the counters are cumulative: `openTicketCount` on a user is
   * adjusted by `$inc` as tickets open and close, so building out of order would still
   * arrive at the right total but would make the log unreadable if it ever went wrong. */
  const instants = Array.from({ length: options.ticketCount }, () =>
    rng.businessInstant(windowStart, now, 1.6)
  ).sort((a, b) => a.getTime() - b.getTime());

  for (const [index, createdAt] of instants.entries()) {
    const template = order[index % order.length]!;
    const category = categories.get(template.category);
    if (!category) throw new Error(`Template references unknown category "${template.category}".`);

    const requester = rng.weighted(requesterWeights);
    const technician = rng.weighted(technicianWeights);
    /* Who performs the assignment, which is not a detail: `assign()` sends no notification
     * to a technician who assigned a ticket to themselves, because there is nobody to tell.
     * A seed where every technician picked up their own work therefore leaves both staff
     * logins with an empty bell and an unread badge of zero — the notification feature
     * present, wired up, and impossible to demonstrate. Most tickets are triaged by the
     * administrator, which is how a four-person desk actually runs. */
    const triagedByAdmin = rng.chance(0.7);
    const ageDays = (now.getTime() - createdAt.getTime()) / DAY_MS;
    const outcome = outcomeFor(ageDays, rng);

    const assetId =
      template.linkAsset === 'requester'
        ? assets.byHolder.get(requester.id) ?? null
        : template.linkAsset === 'shared' && assets.shared.length > 0
          ? rng.pick(assets.shared)
          : null;

    const watermark = new Date();
    const result = await buildTicket(
      template,
      requester,
      technician,
      String(category._id),
      assetId,
      createdAt,
      outcome,
      triagedByAdmin ? admin : technician,
      policy,
      rng
    );
    await settleNotifications(watermark, result.lastEventAt, now);

    comments += result.comments;
    built += 1;
    if (built % 25 === 0) log.info({ built, of: options.ticketCount }, 'Tickets building');
  }

  log.info({ tickets: built, comments }, 'Tickets created');
  return { tickets: built, comments };
}

/* ──────────────────────────────── orchestration ────────────────────────────── */

/**
 * Seed the database and report exactly what was written.
 *
 * The guard is here rather than in the CLI on purpose. `runSeed` is callable from a test,
 * a script or a future admin route, and a function that quietly doubles a database's
 * contents because its caller forgot to check first is a bad function. Without `reset` it
 * refuses a populated database and says how to proceed; with `reset` it wipes first.
 */
export async function runSeed(options: SeedOptions): Promise<SeedResult> {
  const startedAt = Date.now();
  const now = new Date();

  if (options.reset) {
    await wipe();
  } else {
    const existing = await User.countDocuments({});
    if (existing > 0) {
      throw new Error(
        `Database already holds ${existing} user${existing === 1 ? '' : 's'}. ` +
          'Re-run with --reset to replace its contents.'
      );
    }
  }

  const rng = new Rng(options.rngSeed);
  const users = await seedUsers(options);
  const categories = await seedCategories();
  await seedSingletons(now);

  /* By role, not by index. `seedUsers` happens to put the admin first today, and a
   * reordering of `PEOPLE` would otherwise turn the admin actor into an employee and fail
   * a hundred lines later inside a permission check. */
  const adminUser = users.find((user) => user.role === Role.ADMIN);
  const technicianUser = users.find((user) => user.role === Role.TECHNICIAN);
  if (!adminUser || !technicianUser) {
    throw new Error('Seeded users must include an administrator and a technician.');
  }

  const admin = actorFor(adminUser, clockAt(now));
  const technician = actorFor(technicianUser, clockAt(now));

  let assets: AssetIndex = { count: 0, byHolder: new Map(), shared: [] };
  let articles = 0;
  let totals: TicketTotals = { tickets: 0, comments: 0 };

  if (!options.minimal) {
    assets = await seedAssets(admin, users, options, rng, now);
    articles = await seedArticles(admin, technician, categories, now);
    totals = await seedTickets(users, categories, assets, options, rng, now);
  }

  /* Notifications whose TTL has already passed.
   *
   * `settleNotifications` backdated each row to the event that produced it, and the service
   * stamped `expiresAt` sixty days after that same instant — so every notification about a
   * ticket older than two months is already expired. MongoDB's TTL monitor sweeps about once
   * a minute, which means the bell would look healthy for sixty seconds after seeding and
   * then quietly empty itself. Deleting them here makes the count below true, and makes the
   * unread badge show a number that will still be there tomorrow. */
  const expired = await Notification.deleteMany({ expiresAt: { $lte: now } });
  if (expired.deletedCount > 0) {
    log.info({ removed: expired.deletedCount }, 'Expired notifications removed');
  }

  const counts: SeedCounts = {
    users: users.length,
    categories: categories.size,
    assets: assets.count,
    articles,
    tickets: totals.tickets,
    comments: totals.comments,
    notifications: await Notification.countDocuments({}),
  };

  const logins = [Role.ADMIN, Role.TECHNICIAN, Role.EMPLOYEE].flatMap((role) => {
    const user = users.find((candidate) => candidate.role === role);
    return user ? [{ role, name: user.name, email: user.email }] : [];
  });

  const durationMs = Date.now() - startedAt;
  log.info({ ...counts, durationMs }, 'Seed complete');
  return { counts, logins, durationMs };
}
