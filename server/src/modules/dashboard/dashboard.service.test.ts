/**
 * ServiceDesk Pro — dashboard service integration tests.
 *
 * The properties worth protecting:
 *
 *  - the numbers obey the ticket read scope, so an employee's dashboard describes an
 *    employee's tickets and its at-risk panel cannot name someone else's,
 *  - `technicianLoad` is other people's workload and stays empty without
 *    `analytics:view`,
 *  - the charts are zero-filled over the full key set, so a quiet day is a column at
 *    zero rather than a gap,
 *  - a ticket is bucketed into the *business* day it arrived in, not the UTC one —
 *    the two disagree for the first five and a half hours of every Indian working day,
 *  - "average resolution" is business hours: overnight does not count,
 *  - the SLA percentage is decided by the engine, so it agrees with the badge on the
 *    ticket rows the same page links to.
 *
 * `createdAt` and `resolvedAt` are rewritten through the raw driver in places.
 * Mongoose writes `createdAt` from the real system clock whatever the injectable clock
 * says, and `versioned()` would bump `version` on a normal update — the driver goes
 * under both, which is the only way to place a ticket on a specific day of a fixed
 * clock's calendar.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PRIORITIES,
  Priority,
  Role,
  TICKET_STATUSES,
  TicketStatus,
  UserStatus,
} from '@shared/enums';
import { PRIORITY_META, TICKET_STATUS_META } from '@shared/labels';
import type { ActorContext } from '@/core/actor';
import { resolvePermissions } from '@/core/authz/permissions';
import { FixedClock } from '@/core/clock';
import { Category, Ticket, User, toObjectId } from '@/models';
import type { UserDoc } from '@/models/user.model';
import { clearDb, startDb, stopDb } from '@/test/db';
import { getDashboard } from '@/modules/dashboard/dashboard.service';
import * as tickets from '@/modules/tickets/ticket.service';
import type { HydratedDocument } from 'mongoose';

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

/** 16:30 on Tuesday 10 March in Asia/Kolkata — the default policy's timezone. */
const clock = new FixedClock('2026-03-10T11:00:00.000Z');
const NOW = clock.now();

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

async function makeCategory(name = 'Network', color = '#0ea5e9') {
  return Category.create({ name, slug: name.toLowerCase(), color, defaultPriority: Priority.MEDIUM });
}

interface RaiseOptions {
  title?: string;
  priority?: Priority;
  /** Business instant the ticket should count as having arrived at. */
  createdAt?: string;
}

/** A ticket raised by `requester`, through the real service so its SLA is real. */
async function raise(
  requester: UserRecord,
  categoryId: string,
  options: RaiseOptions = {}
): Promise<string> {
  const ticket = await tickets.create(
    {
      title: options.title ?? 'Wi-Fi drops in the east wing',
      description: 'It disconnects every few minutes and reconnects on its own.',
      categoryId,
      ...(options.priority ? { priority: options.priority } : {}),
    } as never,
    actorFor(requester)
  );
  if (options.createdAt) await patchRaw(ticket.id, { createdAt: new Date(options.createdAt) });
  return ticket.id;
}

/**
 * A write that goes under Mongoose: no `versioned()` bump, no `timestamps` override,
 * and dotted paths reach inside the SLA snapshot.
 */
async function patchRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  await Ticket.collection.updateOne({ _id: toObjectId(id) }, { $set: fields });
}

async function versionOf(id: string): Promise<number> {
  const found = await Ticket.findById(id).select('version');
  return found?.version ?? 0;
}

/** Assign, then resolve, then optionally move the resolution onto another day. */
async function resolveTicket(
  id: string,
  staff: UserRecord,
  options: { resolvedAt?: string } = {}
): Promise<void> {
  const actor = actorFor(staff);
  await tickets.assign(id, { assigneeId: staff._id.toString(), version: await versionOf(id) }, actor);
  await tickets.changeStatus(
    id,
    {
      status: TicketStatus.RESOLVED,
      version: await versionOf(id),
      resolutionNote: 'Replaced the access point.',
    } as never,
    actor
  );
  if (options.resolvedAt) await patchRaw(id, { resolvedAt: new Date(options.resolvedAt) });
}

/** Push a resolution deadline into the past, so the engine calls the target breached. */
async function overdue(id: string, dueAt = '2026-03-09T06:00:00.000Z'): Promise<void> {
  await patchRaw(id, { 'sla.resolution.dueAt': new Date(dueAt) });
}

/* ─────────────────────────────────── scope ──────────────────────────────────── */

describe('dashboard scope', () => {
  it('counts only the caller’s own tickets for an employee', async () => {
    const [category, mine, theirs, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Bo Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    const categoryId = category._id.toString();

    await raise(mine, categoryId, { title: 'Mine one' });
    await raise(mine, categoryId, { title: 'Mine two' });
    await raise(theirs, categoryId, { title: 'Theirs' });

    const own = await getDashboard(actorFor(mine));
    const total = own.byStatus.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(2);
    expect(own.kpis[0]).toMatchObject({ label: 'Open tickets', value: 2, changePercent: null });

    const desk = await getDashboard(actorFor(tech));
    expect(desk.byStatus.reduce((sum, row) => sum + row.count, 0)).toBe(3);
  });

  it('keeps someone else’s breached ticket out of the at-risk panel', async () => {
    const [category, mine, theirs, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Bo Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    const categoryId = category._id.toString();

    const ours = await raise(mine, categoryId, { title: 'Ours is late' });
    const other = await raise(theirs, categoryId, { title: 'Theirs is late' });
    await Promise.all([overdue(ours), overdue(other)]);

    const own = await getDashboard(actorFor(mine));
    expect(own.atRisk.map((row) => row.title)).toEqual(['Ours is late']);

    const desk = await getDashboard(actorFor(tech));
    expect(desk.atRisk.map((row) => row.title).sort()).toEqual(['Ours is late', 'Theirs is late']);
  });

  it('fills technicianLoad only for a caller holding analytics:view', async () => {
    const [category, employee, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    await raise(employee, category._id.toString());

    expect((await getDashboard(actorFor(employee))).technicianLoad).toEqual([]);
    expect((await getDashboard(actorFor(tech))).technicianLoad).toHaveLength(1);
  });
});

/* ─────────────────────────────────── charts ─────────────────────────────────── */

describe('dashboard charts', () => {
  it('zero-fills every status and priority, labelled from the shared meta', async () => {
    const [category, employee, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    const id = await raise(employee, category._id.toString(), { priority: Priority.URGENT });
    await resolveTicket(id, tech);

    const view = await getDashboard(actorFor(tech));

    expect(view.byStatus.map((row) => row.key)).toEqual(TICKET_STATUSES);
    expect(view.byPriority.map((row) => row.key)).toEqual(PRIORITIES);
    expect(view.byStatus).toContainEqual({
      key: TicketStatus.RESOLVED,
      label: TICKET_STATUS_META[TicketStatus.RESOLVED].label,
      count: 1,
    });
    /* The point of the zero-fill: a status nothing is in is still a column. */
    expect(view.byStatus.find((row) => row.key === TicketStatus.CLOSED)).toEqual({
      key: TicketStatus.CLOSED,
      label: TICKET_STATUS_META[TicketStatus.CLOSED].label,
      count: 0,
    });
    expect(view.byPriority).toContainEqual({
      key: Priority.URGENT,
      label: PRIORITY_META[Priority.URGENT].label,
      count: 1,
    });
  });

  it('names and colours the busiest categories, heaviest first', async () => {
    const [network, hardware, employee, tech] = await Promise.all([
      makeCategory('Network', '#0ea5e9'),
      makeCategory('Hardware', '#f97316'),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);

    await raise(employee, hardware._id.toString(), { title: 'Laptop fan' });
    await raise(employee, network._id.toString(), { title: 'Wi-Fi one' });
    await raise(employee, network._id.toString(), { title: 'Wi-Fi two' });

    const view = await getDashboard(actorFor(tech));

    expect(view.byCategory).toEqual([
      { key: network._id.toString(), label: 'Network', count: 2, color: '#0ea5e9' },
      { key: hardware._id.toString(), label: 'Hardware', count: 1, color: '#f97316' },
    ]);
  });
});

/* ──────────────────────────────── volume series ─────────────────────────────── */

describe('volume series', () => {
  it('spans fourteen business days, oldest first, ending today', async () => {
    const [category, employee] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
    ]);
    await raise(employee, category._id.toString(), { createdAt: '2026-03-10T05:00:00.000Z' });

    const { volume } = await getDashboard(actorFor(employee));

    expect(volume).toHaveLength(14);
    expect(volume[0]?.date).toBe('2026-02-25');
    expect(volume.at(-1)).toEqual({ date: '2026-03-10', created: 1, resolved: 0 });
    /* Every other day is present and empty, which is what makes the chart readable. */
    expect(volume.filter((point) => point.created === 0)).toHaveLength(13);
  });

  it('buckets a ticket into the business day, not the UTC one', async () => {
    const [category, employee] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
    ]);
    /* 19:00 UTC is half past midnight in Asia/Kolkata: the 8th locally, the 7th in UTC.
     * Bucketing on UTC would file the first five and a half hours of every Indian
     * working day under the day before. */
    await raise(employee, category._id.toString(), { createdAt: '2026-03-07T19:00:00.000Z' });

    const { volume } = await getDashboard(actorFor(employee));
    const on = (date: string): number => volume.find((point) => point.date === date)?.created ?? -1;

    expect(on('2026-03-08')).toBe(1);
    expect(on('2026-03-07')).toBe(0);
  });

  it('counts a resolution on the day it was resolved, not the day it arrived', async () => {
    const [category, employee, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    const id = await raise(employee, category._id.toString(), {
      createdAt: '2026-03-04T05:00:00.000Z',
    });
    await resolveTicket(id, tech, { resolvedAt: '2026-03-06T05:00:00.000Z' });

    const { volume } = await getDashboard(actorFor(tech));
    const point = (date: string) => volume.find((entry) => entry.date === date);

    expect(point('2026-03-04')).toEqual({ date: '2026-03-04', created: 1, resolved: 0 });
    expect(point('2026-03-06')).toEqual({ date: '2026-03-06', created: 0, resolved: 1 });
  });
});

/* ──────────────────────────────────── KPIs ──────────────────────────────────── */

describe('KPIs', () => {
  it('compares resolutions against the previous seven days', async () => {
    const [category, employee, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    const categoryId = category._id.toString();

    const thisWeek = await Promise.all([
      raise(employee, categoryId, { title: 'One' }),
      raise(employee, categoryId, { title: 'Two' }),
    ]);
    const lastWeek = await raise(employee, categoryId, { title: 'Three' });

    for (const id of thisWeek) await resolveTicket(id, tech, { resolvedAt: '2026-03-08T06:00:00.000Z' });
    await resolveTicket(lastWeek, tech, { resolvedAt: '2026-02-27T06:00:00.000Z' });

    const { kpis } = await getDashboard(actorFor(tech));
    const resolved = kpis.find((kpi) => kpi.label === 'Resolved (7 days)');

    expect(resolved).toMatchObject({ value: 2, changePercent: 100, higherIsBetter: true, format: 'number' });
    /* Nothing is open any more, so the snapshot KPI has to say zero rather than three. */
    expect(kpis.find((kpi) => kpi.label === 'Open tickets')?.value).toBe(0);
  });

  it('reads SLA compliance from the engine, not from the cached state', async () => {
    const [category, employee, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    const categoryId = category._id.toString();

    const onTime = await raise(employee, categoryId, { title: 'Handled' });
    const late = await raise(employee, categoryId, { title: 'Missed' });
    /* The deadline moves before the resolve, so `markTargetMet` records the breach the
     * same way a real overdue ticket would. */
    await overdue(late);
    await resolveTicket(onTime, tech);
    await resolveTicket(late, tech);

    const { kpis } = await getDashboard(actorFor(tech));

    expect(kpis.find((kpi) => kpi.label === 'SLA compliance')).toEqual({
      label: 'SLA compliance',
      value: 50,
      /* No baseline: nothing was resolved in the week before. */
      changePercent: null,
      higherIsBetter: true,
      format: 'percent',
    });
  });

  it('measures average resolution in business hours, so overnight does not count', async () => {
    const [category, employee, tech] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
    ]);
    const id = await raise(employee, category._id.toString());
    await resolveTicket(id, tech);

    /* Clock started one minute after Monday's closing bell and stopped at 09:30 on
     * Tuesday: fifteen wall-clock hours, thirty business minutes. */
    await patchRaw(id, {
      'sla.resolution.startedAt': new Date('2026-03-09T12:31:00.000Z'),
      'sla.resolution.metAt': new Date('2026-03-10T04:00:00.000Z'),
      resolvedAt: new Date('2026-03-10T04:00:00.000Z'),
    });

    const { kpis } = await getDashboard(actorFor(tech));

    expect(kpis.find((kpi) => kpi.label === 'Avg resolution')).toMatchObject({
      value: 0.5,
      higherIsBetter: false,
      format: 'hours',
    });
  });
});

/* ───────────────────────────────── who is busy ──────────────────────────────── */

describe('technician load', () => {
  it('reports open work, overdue work and the idle', async () => {
    const [category, employee, busy, idle] = await Promise.all([
      makeCategory(),
      makeUser('Ada Employee', Role.EMPLOYEE),
      makeUser('Cy Tech', Role.TECHNICIAN),
      makeUser('Di Tech', Role.TECHNICIAN),
    ]);
    const categoryId = category._id.toString();
    const busyActor = actorFor(busy);

    const late = await raise(employee, categoryId, { title: 'Late one' });
    const fine = await raise(employee, categoryId, { title: 'Fine one' });
    const done = await raise(employee, categoryId, { title: 'Done one' });

    for (const id of [late, fine]) {
      await tickets.assign(id, { assigneeId: busy._id.toString(), version: await versionOf(id) }, busyActor);
    }
    await overdue(late);
    await resolveTicket(done, busy, { resolvedAt: '2026-03-09T06:00:00.000Z' });

    const { technicianLoad } = await getDashboard(busyActor);

    expect(technicianLoad).toHaveLength(2);
    expect(technicianLoad[0]).toMatchObject({
      open: 2,
      breached: 1,
      resolvedLast7Days: 1,
    });
    expect(technicianLoad[0]?.technician).toMatchObject({ name: 'Cy Tech', role: Role.TECHNICIAN });
    expect(technicianLoad[0]?.avgResolutionHours).toBeGreaterThanOrEqual(0);

    /* Present with zeros rather than absent: "who is free" is most of the reason to
     * look at this board, and a null average is not a zero one. */
    expect(technicianLoad[1]).toEqual({
      technician: {
        id: idle._id.toString(),
        name: 'Di Tech',
        email: 'di.tech@example.com',
        role: Role.TECHNICIAN,
      },
      open: 0,
      resolvedLast7Days: 0,
      breached: 0,
      avgResolutionHours: null,
    });
  });
});
