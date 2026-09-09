/**
 * ServiceDesk Pro — ticket service integration tests.
 *
 * The bias here is the same as in the auth suite: test the properties something
 * would go badly wrong without, not every line. Concretely —
 *
 *  - an employee sees their own tickets and nothing else, and cannot widen that
 *    with a query string,
 *  - the status machine only permits transitions the table lists,
 *  - `version` actually stops a stale write,
 *  - the SLA clocks start, stop and restart at the right moments,
 *  - an internal note stays internal, and does not count as a reply.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CommentVisibility,
  Priority,
  Role,
  SlaState,
  TicketStatus,
  UserStatus,
} from '@shared/enums';
import { FixedClock } from '@/core/clock';
import { resolvePermissions } from '@/core/authz/permissions';
import { Asset, Category, Ticket, User } from '@/models';
import { clearDb, startDb, stopDb } from '@/test/db';
import { listTicketsSchema, type ListTicketsInput } from '@/modules/tickets/ticket.schema';
import * as tickets from '@/modules/tickets/ticket.service';
import type { ActorContext } from '@/core/actor';
import type { UserDoc } from '@/models/user.model';
import type { HydratedDocument } from 'mongoose';

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

/** Monday 2026-01-05, 09:00 UTC — 14:30 in the default Asia/Kolkata business window. */
const clock = new FixedClock('2026-01-05T09:00:00.000Z');

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

/** The three actors every test needs, plus the category tickets are filed against. */
async function seed() {
  const [admin, tech, employee, other] = await Promise.all([
    makeUser('Root Admin', Role.ADMIN),
    makeUser('Tara Tech', Role.TECHNICIAN),
    makeUser('Asha Menon', Role.EMPLOYEE),
    makeUser('Bala Rao', Role.EMPLOYEE),
  ]);
  const category = await Category.create({
    name: 'Hardware',
    slug: 'hardware',
    defaultPriority: Priority.HIGH,
  });
  return {
    admin,
    tech,
    employee,
    other,
    category,
    categoryId: category._id.toString(),
    asAdmin: actorFor(admin),
    asTech: actorFor(tech),
    asEmployee: actorFor(employee),
    asOther: actorFor(other),
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/** Parsing rather than hand-building the object keeps the defaults in one place. */
function listQuery(overrides: Record<string, unknown> = {}): ListTicketsInput {
  return listTicketsSchema.query.parse(overrides);
}

async function raise(s: Seed, actor: ActorContext, over: Record<string, unknown> = {}) {
  return tickets.create(
    {
      title: 'Laptop will not boot',
      description: 'It shows a black screen after the vendor logo and then powers off.',
      categoryId: s.categoryId,
      ...over,
    } as never,
    actor
  );
}

describe('creating a ticket', () => {
  it('numbers tickets in sequence and files them against the requester', async () => {
    const s = await seed();
    const first = await raise(s, s.asEmployee);
    const second = await raise(s, s.asEmployee, { title: 'Second problem entirely' });

    expect(first.number).toBe('TKT-000001');
    expect(second.number).toBe('TKT-000002');
    expect(first.status).toBe(TicketStatus.OPEN);
    expect(first.requester?.id).toBe(s.employee._id.toString());
    /* A freshly saved document starts at 1 — see `versioned()` in the model helpers. */
    expect(first.version).toBe(1);
  });

  it('inherits the priority of its category when none is given', async () => {
    const s = await seed();
    const inherited = await raise(s, s.asEmployee);
    const explicit = await raise(s, s.asEmployee, { priority: Priority.LOW });

    expect(inherited.priority).toBe(Priority.HIGH);
    expect(explicit.priority).toBe(Priority.LOW);
  });

  it('starts both SLA clocks with a deadline inside business hours', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    expect(ticket.sla.response.state).toBe(SlaState.ON_TRACK);
    expect(ticket.sla.resolution.state).toBe(SlaState.ON_TRACK);
    expect(ticket.sla.breached).toBe(false);
    const responseDue = new Date(ticket.sla.response.dueAt ?? '');
    const resolutionDue = new Date(ticket.sla.resolution.dueAt ?? '');
    expect(responseDue.getTime()).toBeGreaterThan(clock.now().getTime());
    expect(resolutionDue.getTime()).toBeGreaterThan(responseDue.getTime());
    expect(ticket.sla.response.metAt).toBeNull();
  });

  it('opens the timeline with the creation event and offers the legal next steps', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    expect(ticket.statusHistory).toHaveLength(1);
    expect(ticket.statusHistory[0]).toMatchObject({ from: null, to: TicketStatus.OPEN });
    expect(ticket.allowedTransitions).toEqual([
      TicketStatus.IN_PROGRESS,
      TicketStatus.ON_HOLD,
      TicketStatus.RESOLVED,
    ]);
  });

  it('rejects an unknown category as a form error rather than a 404', async () => {
    const s = await seed();
    await Category.updateOne({ _id: s.category._id }, { $set: { active: false } });

    await expect(raise(s, s.asEmployee)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('who can see which tickets', () => {
  it('hides another employee\u2019s ticket behind a 404, not a 403', async () => {
    const s = await seed();
    const mine = await raise(s, s.asEmployee);

    /* 404 rather than 403 on purpose: a 403 confirms the ticket exists, which is
     * itself a leak when ticket ids are guessable. */
    await expect(tickets.getById(mine.id, s.asOther)).rejects.toMatchObject({ statusCode: 404 });
    await expect(tickets.getById(mine.id, s.asTech)).resolves.toMatchObject({ id: mine.id });
  });

  it('lists only the requester\u2019s own tickets for an employee', async () => {
    const s = await seed();
    await raise(s, s.asEmployee);
    await raise(s, s.asOther, { title: 'Monitor flickers constantly' });

    const asEmployee = await tickets.list(listQuery(), s.asEmployee);
    const asTech = await tickets.list(listQuery(), s.asTech);

    expect(asEmployee.meta.total).toBe(1);
    expect(asEmployee.items[0]?.requester?.id).toBe(s.employee._id.toString());
    expect(asTech.meta.total).toBe(2);
  });

  it('cannot be widened by asking for somebody else\u2019s tickets', async () => {
    const s = await seed();
    const theirs = await raise(s, s.asOther);

    /* The scope filter and the query filter are intersected, never merged. If they
     * were merged this would return `theirs` — a query string as privilege escalation. */
    const page = await tickets.list(
      listQuery({ requesterId: s.other._id.toString() }),
      s.asEmployee
    );

    expect(page.meta.total).toBe(0);
    expect(page.items).toHaveLength(0);
    expect(theirs.id).toBeTruthy();
  });

  it('resolves `scope=mine` per role: assigned for staff, raised for employees', async () => {
    const s = await seed();
    const assigned = await raise(s, s.asEmployee);
    await raise(s, s.asOther, { title: 'Keyboard keys are sticking' });
    await tickets.assign(
      assigned.id,
      { assigneeId: s.tech._id.toString(), version: assigned.version },
      s.asAdmin
    );

    const forTech = await tickets.list(listQuery({ scope: 'mine' }), s.asTech);
    const forEmployee = await tickets.list(listQuery({ scope: 'mine' }), s.asEmployee);

    expect(forTech.items.map((t) => t.id)).toEqual([assigned.id]);
    expect(forEmployee.items.map((t) => t.id)).toEqual([assigned.id]);
  });
});

describe('the status machine', () => {
  it('walks the table and records every hop on the timeline', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    const started = await tickets.changeStatus(
      ticket.id,
      { status: TicketStatus.IN_PROGRESS, version: ticket.version },
      s.asTech
    );
    const held = await tickets.changeStatus(
      started.id,
      { status: TicketStatus.ON_HOLD, note: 'Waiting on the vendor.', version: started.version },
      s.asTech
    );

    expect(started.status).toBe(TicketStatus.IN_PROGRESS);
    expect(held.status).toBe(TicketStatus.ON_HOLD);
    expect(held.statusHistory).toHaveLength(3);
    expect(held.statusHistory[2]).toMatchObject({
      from: TicketStatus.IN_PROGRESS,
      to: TicketStatus.ON_HOLD,
      note: 'Waiting on the vendor.',
    });
    expect(held.statusHistory[2]?.by?.id).toBe(s.tech._id.toString());
  });

  it('refuses a transition the table does not list', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    /* OPEN → CLOSED skips the resolution, so there is no record of what fixed it. */
    await expect(
      tickets.changeStatus(
        ticket.id,
        { status: TicketStatus.CLOSED, version: ticket.version },
        s.asTech
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses a no-op transition to the status it already has', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    await expect(
      tickets.changeStatus(
        ticket.id,
        { status: TicketStatus.OPEN, version: ticket.version },
        s.asTech
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('will not resolve a ticket without saying what fixed it', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    await expect(
      tickets.changeStatus(
        ticket.id,
        { status: TicketStatus.RESOLVED, version: ticket.version },
        s.asTech
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('resolving, closing and reopening', () => {
  /** Drives a fresh ticket up to RESOLVED, which most of these tests need first. */
  async function resolved(s: Seed) {
    const ticket = await raise(s, s.asEmployee);
    return tickets.changeStatus(
      ticket.id,
      {
        status: TicketStatus.RESOLVED,
        resolutionNote: 'Replaced the failed RAM module.',
        version: ticket.version,
      },
      s.asTech
    );
  }

  it('stops the resolution clock and records the fix', async () => {
    const s = await seed();
    const ticket = await resolved(s);

    expect(ticket.status).toBe(TicketStatus.RESOLVED);
    expect(ticket.resolutionNote).toBe('Replaced the failed RAM module.');
    expect(ticket.resolvedAt).not.toBeNull();
    expect(ticket.sla.resolution.state).toBe(SlaState.MET);
    expect(ticket.sla.resolution.metAt).not.toBeNull();
  });

  it('stops the response clock too, on a ticket nobody replied to first', async () => {
    const s = await seed();
    /* `resolved()` posts no comment, so this is the fix-on-sight path. The requester has
     * plainly heard back, and a response target still ticking would drift into BREACHED
     * days later for a reply nobody was waiting for. */
    const ticket = await resolved(s);

    expect(ticket.sla.response.state).toBe(SlaState.MET);
    expect(ticket.sla.response.metAt).toBe(ticket.sla.resolution.metAt);
  });

  it('lets the requester reopen, and restarts only the resolution clock', async () => {
    const s = await seed();
    const before = await resolved(s);
    const after = await tickets.reopen(
      before.id,
      { note: 'It powered off again this morning.', version: before.version },
      s.asEmployee
    );

    expect(after.status).toBe(TicketStatus.REOPENED);
    expect(after.reopenCount).toBe(1);
    expect(after.resolvedAt).toBeNull();
    expect(after.sla.resolution.state).toBe(SlaState.ON_TRACK);
    expect(after.sla.resolution.metAt).toBeNull();
    /* "Only" the resolution clock: the response deadline is the same instant it was. */
    expect(after.sla.response.dueAt).toBe(before.sla.response.dueAt);
    /* What was tried and did not hold is the most useful line on the page. */
    expect(after.resolutionNote).toBe('Replaced the failed RAM module.');
  });

  it('refuses a reopen from an unrelated employee', async () => {
    const s = await seed();
    const ticket = await resolved(s);

    /* `asOther` cannot even see it, so the scope filter answers first. */
    await expect(
      tickets.reopen(ticket.id, { version: ticket.version }, s.asOther)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('concurrent edits', () => {
  it('rejects a write built from a stale version', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);
    await tickets.update(
      ticket.id,
      { title: 'Laptop will not boot at all', version: ticket.version },
      s.asTech
    );

    /* The second editor still holds the version they loaded, which the first write
     * has since advanced — exactly the lost-update the check exists to stop. */
    await expect(
      tickets.update(ticket.id, { priority: Priority.URGENT, version: ticket.version }, s.asTech)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('does not burn a version on an assignment that changes nothing', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);
    const techId = s.tech._id.toString();
    const assigned = await tickets.assign(
      ticket.id,
      { assigneeId: techId, version: ticket.version },
      s.asAdmin
    );
    const again = await tickets.assign(
      ticket.id,
      { assigneeId: techId, version: assigned.version },
      s.asAdmin
    );

    expect(assigned.assignee?.id).toBe(techId);
    /* Bumping `version` for a change nobody made would invalidate every other
     * editor's open form for nothing. */
    expect(again.version).toBe(assigned.version);
  });

  it('clears an assignment when handed an explicit null', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);
    const assigned = await tickets.assign(
      ticket.id,
      { assigneeId: s.tech._id.toString(), version: ticket.version },
      s.asAdmin
    );
    const cleared = await tickets.assign(
      assigned.id,
      { assigneeId: null, version: assigned.version },
      s.asAdmin
    );

    expect(cleared.assignee).toBeNull();
  });

  it('refuses to assign a ticket to somebody who is not staff', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    await expect(
      tickets.assign(
        ticket.id,
        { assigneeId: s.other._id.toString(), version: ticket.version },
        s.asAdmin
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('changing the priority', () => {
  it('reprices the deadlines from when the ticket was raised, not from now', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee, { priority: Priority.LOW });
    const escalated = await tickets.update(
      ticket.id,
      { priority: Priority.URGENT, version: ticket.version },
      s.asTech
    );

    expect(escalated.priority).toBe(Priority.URGENT);
    /* An urgent budget applied from the original start instant, so escalating cannot
     * be used to buy back time already spent. */
    const before = new Date(ticket.sla.resolution.dueAt ?? '').getTime();
    const after = new Date(escalated.sla.resolution.dueAt ?? '').getTime();
    expect(after).toBeLessThan(before);
    expect(escalated.sla.resolution.budgetMinutes).toBeLessThan(
      ticket.sla.resolution.budgetMinutes
    );
  });

  it('keeps the indexed rank in step so "most urgent first" sorts correctly', async () => {
    const s = await seed();
    await raise(s, s.asEmployee, { priority: Priority.LOW, title: 'Low priority request' });
    await raise(s, s.asEmployee, { priority: Priority.URGENT, title: 'Urgent priority request' });
    await raise(s, s.asEmployee, { priority: Priority.MEDIUM, title: 'Medium priority request' });

    const page = await tickets.list(listQuery({ sortBy: 'priority', sortOrder: 'desc' }), s.asTech);

    /* Sorting the priority *strings* would give HIGH, LOW, MEDIUM, URGENT. */
    expect(page.items.map((t) => t.priority)).toEqual([
      Priority.URGENT,
      Priority.MEDIUM,
      Priority.LOW,
    ]);
  });
});

describe('searching and filtering', () => {
  it('finds a ticket by its number, with or without the prefix', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    for (const term of ['TKT-000001', 'tkt-1', '1']) {
      const page = await tickets.list(listQuery({ q: term }), s.asTech);
      expect(page.items.map((t) => t.id), `term: ${term}`).toEqual([ticket.id]);
    }
  });

  it('filters by status and priority', async () => {
    const s = await seed();
    const open = await raise(s, s.asEmployee, { priority: Priority.URGENT });
    await raise(s, s.asEmployee, { priority: Priority.LOW, title: 'Something much less urgent' });
    await tickets.changeStatus(
      open.id,
      { status: TicketStatus.IN_PROGRESS, version: open.version },
      s.asTech
    );

    const byStatus = await tickets.list(listQuery({ status: 'IN_PROGRESS' }), s.asTech);
    const byPriority = await tickets.list(listQuery({ priority: 'LOW,URGENT' }), s.asTech);
    const unassigned = await tickets.list(listQuery({ scope: 'unassigned' }), s.asTech);

    expect(byStatus.items.map((t) => t.id)).toEqual([open.id]);
    expect(byPriority.meta.total).toBe(2);
    expect(unassigned.meta.total).toBe(2);
  });
});

describe('comments', () => {
  it('records a public reply and marks the first response', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);
    const comment = await tickets.addComment(
      ticket.id,
      { body: 'Bringing a spare charger over now.', visibility: CommentVisibility.PUBLIC },
      s.asTech
    );
    const after = await tickets.getById(ticket.id, s.asTech);

    expect(comment.isFirstResponse).toBe(true);
    expect(comment.author?.id).toBe(s.tech._id.toString());
    expect(comment.authorLabel).toBe(s.tech.name);
    expect(after.commentCount).toBe(1);
    expect(after.firstResponseAt).not.toBeNull();
    expect(after.sla.response.state).toBe(SlaState.MET);
  });

  it('does not let an internal note stop the response clock', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);
    const note = await tickets.addComment(
      ticket.id,
      { body: 'Vendor RMA is already open under case 4471.', visibility: CommentVisibility.INTERNAL },
      s.asTech
    );
    const after = await tickets.getById(ticket.id, s.asTech);

    /* An internal note is not a reply to anyone. */
    expect(note.isFirstResponse).toBe(false);
    expect(after.firstResponseAt).toBeNull();
    expect(after.sla.response.state).toBe(SlaState.ON_TRACK);
  });

  it('does not let the requester answer their own ticket', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);
    const comment = await tickets.addComment(
      ticket.id,
      { body: 'Adding a photograph of the error screen.', visibility: CommentVisibility.PUBLIC },
      s.asEmployee
    );
    const after = await tickets.getById(ticket.id, s.asEmployee);

    expect(comment.isFirstResponse).toBe(false);
    expect(after.firstResponseAt).toBeNull();
  });

  it('hides internal notes from the requester and shows them to staff', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);
    await tickets.addComment(
      ticket.id,
      { body: 'Public: engineer assigned.', visibility: CommentVisibility.PUBLIC },
      s.asTech
    );
    await tickets.addComment(
      ticket.id,
      { body: 'Internal: this user has broken two chargers already.', visibility: CommentVisibility.INTERNAL },
      s.asTech
    );

    const forRequester = await tickets.listComments(ticket.id, {}, s.asEmployee);
    const forStaff = await tickets.listComments(ticket.id, {}, s.asTech);

    expect(forRequester.items.map((c) => c.visibility)).toEqual([CommentVisibility.PUBLIC]);
    expect(forStaff.meta.total).toBe(2);
  });

  it('refuses an internal note from somebody without the permission', async () => {
    const s = await seed();
    const ticket = await raise(s, s.asEmployee);

    await expect(
      tickets.addComment(
        ticket.id,
        { body: 'Trying to write an internal note.', visibility: CommentVisibility.INTERNAL },
        s.asEmployee
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('the denormalised counters', () => {
  it('tracks open tickets per requester, assignee and asset', async () => {
    const s = await seed();
    const asset = await Asset.create({ tag: 'LT-0001', name: 'Dell Latitude 5440' });
    const ticket = await raise(s, s.asEmployee, { assetId: asset._id.toString() });
    await tickets.assign(
      ticket.id,
      { assigneeId: s.tech._id.toString(), version: ticket.version },
      s.asAdmin
    );

    const opened = await Promise.all([
      User.findById(s.employee._id),
      User.findById(s.tech._id),
      Asset.findById(asset._id),
    ]);
    expect(opened[0]?.openTicketCount).toBe(1);
    expect(opened[1]?.assignedTicketCount).toBe(1);
    expect(opened[2]?.openTicketCount).toBe(1);
    expect(opened[2]?.ticketCount).toBe(1);

    const current = await tickets.getById(ticket.id, s.asTech);
    const resolvedTicket = await tickets.changeStatus(
      ticket.id,
      {
        status: TicketStatus.RESOLVED,
        resolutionNote: 'Reseated the battery connector.',
        version: current.version,
      },
      s.asTech
    );
    await tickets.changeStatus(
      resolvedTicket.id,
      { status: TicketStatus.CLOSED, version: resolvedTicket.version },
      s.asTech
    );

    const closed = await Promise.all([
      User.findById(s.employee._id),
      User.findById(s.tech._id),
      Asset.findById(asset._id),
    ]);
    /* RESOLVED already leaves the open set, and CLOSED must not decrement twice. */
    expect(closed[0]?.openTicketCount).toBe(0);
    expect(closed[1]?.assignedTicketCount).toBe(0);
    expect(closed[2]?.openTicketCount).toBe(0);
    /* A lifetime total, so it never comes back down. */
    expect(closed[2]?.ticketCount).toBe(1);
  });

  it('counts tickets per category, and moves the count when the category changes', async () => {
    const s = await seed();
    const software = await Category.create({
      name: 'Software & Applications',
      slug: 'software',
      defaultPriority: Priority.MEDIUM,
    });

    await raise(s, s.asEmployee);
    const misfiled = await raise(s, s.asEmployee);
    expect((await Category.findById(s.category._id))?.ticketCount).toBe(2);
    expect((await Category.findById(software._id))?.ticketCount).toBe(0);

    await tickets.update(
      misfiled.id,
      { categoryId: software._id.toString(), version: misfiled.version } as never,
      s.asTech
    );

    /* A lifetime total like the asset's, but unlike it this one has to come *down* when a
     * ticket is refiled — otherwise the two categories together claim more tickets than
     * exist, and the admin list overstates a category nobody uses any more. */
    expect((await Category.findById(s.category._id))?.ticketCount).toBe(1);
    expect((await Category.findById(software._id))?.ticketCount).toBe(1);
  });

  it('leaves both category counts alone when the ticket is refiled into a retired category', async () => {
    const s = await seed();
    const retired = await Category.create({
      name: 'Desk Phones',
      slug: 'telephony',
      defaultPriority: Priority.LOW,
      active: false,
    });
    const ticket = await raise(s, s.asEmployee);

    await expect(
      tickets.update(
        ticket.id,
        { categoryId: retired._id.toString(), version: ticket.version } as never,
        s.asTech
      )
    ).rejects.toThrow();

    expect((await Category.findById(s.category._id))?.ticketCount).toBe(1);
    expect((await Category.findById(retired._id))?.ticketCount).toBe(0);
  });
});
