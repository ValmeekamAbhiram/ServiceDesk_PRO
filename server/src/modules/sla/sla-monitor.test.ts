/**
 * ServiceDesk Pro — SLA monitor integration tests.
 *
 * The monitor's job is small and its failure modes are all quiet ones, which is
 * exactly why it needs tests: nothing about a missed escalation looks broken. The
 * five properties asserted here are the ones the rest of the application relies on.
 *
 *  - A threshold is crossed **once**. A sweep every sixty seconds means a monitor
 *    that renotified would send a technician 480 emails over a working day.
 *  - A sweep is **not an edit**. `version` must not move, or every open form in
 *    every browser would start failing its optimistic-concurrency check a minute
 *    after it was opened.
 *  - The right people hear about it: the assignee, or every admin when the ticket
 *    is sitting unassigned in the queue.
 *  - A resolved ticket is **never** swept, because resolving it stopped both clocks.
 *  - The live countdown is told, so an open ticket page does not need to poll.
 *
 * The times are chosen against the default policy: business hours Asia/Kolkata
 * 09:00–18:00 Mon–Fri, at-risk at 75%, and HIGH priority budgeted 60 response /
 * 480 resolution business minutes. A ticket raised 09:30 IST Monday therefore owes
 * a first response by 10:30 (at risk from 10:15) and a resolution by 17:30 (at risk
 * from 15:30). Every instant below is written in UTC, which is IST − 5:30.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Priority, Role, SlaState, TicketStatus, UserStatus } from '@shared/enums';
import { NotificationType } from '@shared/enums';
import { ServerEvent } from '@shared/socket';
import { FixedClock } from '@/core/clock';
import { resolvePermissions } from '@/core/authz/permissions';
import { systemUser, type ActorContext } from '@/core/actor';
import { Category, Notification, Ticket, User } from '@/models';
import { setRealtimeChannel } from '@/realtime/emit';
import { clearDb, startDb, stopDb } from '@/test/db';
import * as tickets from '@/modules/tickets/ticket.service';
import { sweepSlaStates } from '@/modules/sla/sla-monitor';
import type { UserDoc } from '@/models/user.model';
import type { HydratedDocument } from 'mongoose';
import type { Namespace } from 'socket.io';

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

/** Monday 2026-01-05, 09:30 IST. Both clocks start here. */
const RAISED_AT = '2026-01-05T04:00:00.000Z';

const AT_RISK_RESPONSE = '2026-01-05T04:50:00.000Z'; // 10:20 IST — past 75% of 60m
const BREACHED_RESPONSE = '2026-01-05T05:30:00.000Z'; // 11:00 IST — past 10:30
const AT_RISK_RESOLUTION = '2026-01-05T10:15:00.000Z'; // 15:45 IST — past 75% of 480m
const BREACHED_RESOLUTION = '2026-01-05T12:15:00.000Z'; // 17:45 IST — past 17:30

type UserRecord = HydratedDocument<UserDoc>;

let emitted: { event: string; payload: unknown }[] = [];

/**
 * A namespace stub, so the emission can be observed without a port.
 *
 * `emit.ts` calls `channel.to(rooms).emit(event, payload)` and nothing else, so this
 * is the whole surface the monitor uses. Installed per test and torn down after, or
 * a live channel would leak into the next file.
 */
beforeEach(() => {
  emitted = [];
  setRealtimeChannel({
    to: () => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    }),
  } as unknown as Namespace);
});

afterEach(() => setRealtimeChannel(null));

async function makeUser(
  name: string,
  role: Role,
  status: UserStatus = UserStatus.ACTIVE
): Promise<UserRecord> {
  return User.create({
    name,
    email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
    passwordHash: 'not-used-here',
    role,
    status,
  });
}

function actorFor(user: UserRecord, at: string): ActorContext {
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
    clock: new FixedClock(at),
    ip: '203.0.113.7',
    userAgent: 'vitest',
    automated: false,
  };
}

/** What `startSlaMonitor()` passes in, with the clock pinned instead of real. */
function sweepActorAt(at: string): ActorContext {
  return {
    user: systemUser(resolvePermissions(Role.ADMIN)),
    requestId: `sla-sweep-${at}`,
    clock: new FixedClock(at),
    ip: null,
    userAgent: null,
    automated: true,
  };
}

const sweepAt = (at: string) => sweepSlaStates(sweepActorAt(at));

/**
 * Only the sweep's own emissions. Raising a ticket emits `ticket:created` and a
 * notification of its own, so the raw list is never empty by the time a sweep runs.
 */
const slaEvents = () => emitted.filter((e) => e.event === ServerEvent.TICKET_SLA_CHANGED);

/**
 * One HIGH-priority ticket raised at 09:30 IST Monday by an employee, plus the staff
 * the notifications can land on. `raise` goes through the real ticket service so the
 * SLA subdocument is built the way production builds it.
 */
async function seed(options: { admins?: number; inactiveAdmin?: boolean } = {}) {
  const [tech, employee] = await Promise.all([
    makeUser('Tara Tech', Role.TECHNICIAN),
    makeUser('Asha Menon', Role.EMPLOYEE),
  ]);
  const admins: UserRecord[] = [];
  for (let i = 0; i < (options.admins ?? 1); i += 1) {
    admins.push(await makeUser(`Admin ${i}`, Role.ADMIN));
  }
  if (options.inactiveAdmin) {
    admins.push(await makeUser('Gone Admin', Role.ADMIN, UserStatus.INACTIVE));
  }

  const category = await Category.create({
    name: 'Hardware',
    slug: 'hardware',
    defaultPriority: Priority.HIGH,
  });

  const asEmployee = actorFor(employee, RAISED_AT);
  const ticket = await tickets.create(
    {
      title: 'Laptop will not boot',
      description: 'Black screen after the vendor logo, then it powers off again.',
      categoryId: category._id.toString(),
      priority: Priority.HIGH,
    } as never,
    asEmployee
  );

  return { tech, employee, admins, category, ticket, asEmployee };
}

/** The two persisted states, read back from the database rather than from memory. */
async function statesOf(id: string) {
  const row = await Ticket.findById(id).lean();
  return {
    response: row?.sla.response.state,
    resolution: row?.sla.resolution.state,
    version: row?.version,
    status: row?.status,
  };
}

describe('sweeping SLA states', () => {
  it('leaves a ticket alone while both clocks are comfortable', async () => {
    const s = await seed();

    const summary = await sweepAt('2026-01-05T04:10:00.000Z');

    expect(summary.scanned).toBe(1);
    expect(summary.changed).toBe(0);
    await expect(statesOf(s.ticket.id)).resolves.toMatchObject({
      response: SlaState.ON_TRACK,
      resolution: SlaState.ON_TRACK,
    });
    expect(slaEvents()).toHaveLength(0);
  });

  it('moves a response clock to at risk, and does not do it twice', async () => {
    const s = await seed();

    const first = await sweepAt(AT_RISK_RESPONSE);
    expect(first).toMatchObject({ scanned: 1, changed: 1, atRisk: 1, breached: 0 });
    await expect(statesOf(s.ticket.id)).resolves.toMatchObject({
      response: SlaState.AT_RISK,
      resolution: SlaState.ON_TRACK,
    });

    /* The interval fires again a minute later with nothing new to say. */
    const second = await sweepAt(AT_RISK_RESPONSE);
    expect(second).toMatchObject({ scanned: 1, changed: 0, atRisk: 0, breached: 0 });
    await expect(Notification.countDocuments()).resolves.toBe(1);
  });

  it('breaches a response clock and then stays quiet about it', async () => {
    const s = await seed();

    await sweepAt(AT_RISK_RESPONSE);
    const breach = await sweepAt(BREACHED_RESPONSE);

    expect(breach).toMatchObject({ changed: 1, atRisk: 0, breached: 1 });
    await expect(statesOf(s.ticket.id)).resolves.toMatchObject({
      response: SlaState.BREACHED,
      resolution: SlaState.ON_TRACK,
    });

    /* Three more sweeps across the rest of the working day: the response clock has
     * had its say, so the only thing left to report is the resolution clock. */
    expect((await sweepAt('2026-01-05T06:00:00.000Z')).changed).toBe(0);
    expect((await sweepAt(AT_RISK_RESOLUTION)).atRisk).toBe(1);
    expect((await sweepAt(BREACHED_RESOLUTION)).breached).toBe(1);
    expect((await sweepAt('2026-01-09T12:00:00.000Z')).changed).toBe(0);

    await expect(statesOf(s.ticket.id)).resolves.toMatchObject({
      response: SlaState.BREACHED,
      resolution: SlaState.BREACHED,
    });
  });
});

describe('what a sweep is allowed to touch', () => {
  it('does not count as an edit', async () => {
    const s = await seed();
    const before = await statesOf(s.ticket.id);

    await sweepAt(BREACHED_RESPONSE);

    const after = await statesOf(s.ticket.id);
    expect(after.version).toBe(before.version);
    expect(after.status).toBe(before.status);
  });

  it('never sweeps a resolved ticket', async () => {
    const s = await seed();
    const asTech = actorFor(s.tech, '2026-01-05T04:30:00.000Z');
    const resolved = await tickets.changeStatus(
      s.ticket.id,
      {
        status: TicketStatus.RESOLVED,
        resolutionNote: 'Reseated the RAM; it posts again.',
        version: s.ticket.version,
      } as never,
      asTech
    );
    expect(resolved.status).toBe(TicketStatus.RESOLVED);

    /* Four days later, long past both deadlines. */
    const summary = await sweepAt('2026-01-09T12:00:00.000Z');

    expect(summary).toMatchObject({ scanned: 0, changed: 0 });
    await expect(statesOf(s.ticket.id)).resolves.toMatchObject({
      response: SlaState.MET,
      resolution: SlaState.MET,
    });
  });

  it('tells any open ticket page which states moved', async () => {
    await seed();

    await sweepAt(BREACHED_RESPONSE);

    expect(slaEvents()).toHaveLength(1);
    expect(slaEvents()[0]?.payload).toMatchObject({
      response: SlaState.BREACHED,
      resolution: SlaState.ON_TRACK,
    });
  });
});

describe('who hears about it', () => {
  it('tells the assignee, and nobody else', async () => {
    const s = await seed({ admins: 2 });
    const asAdmin = actorFor(s.admins[0]!, RAISED_AT);
    await tickets.assign(
      s.ticket.id,
      { assigneeId: s.tech._id.toString(), version: s.ticket.version },
      asAdmin
    );
    await Notification.deleteMany({});

    await sweepAt(AT_RISK_RESPONSE);

    const rows = await Notification.find().lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.recipientId)).toBe(s.tech._id.toString());
    expect(rows[0]?.type).toBe(NotificationType.SLA_AT_RISK);
    /* The requester is deliberately not on the list: an SLA state is an internal
     * fact, and "your ticket is at risk" only tells them the desk is behind. */
    expect(rows.map((row) => String(row.recipientId))).not.toContain(
      s.employee._id.toString()
    );
  });

  it('falls back to every active admin while nobody has picked it up', async () => {
    const s = await seed({ admins: 2, inactiveAdmin: true });

    await sweepAt(BREACHED_RESPONSE);

    const rows = await Notification.find().lean();
    const recipients = rows.map((row) => String(row.recipientId)).sort();
    expect(recipients).toEqual(
      [s.admins[0]!._id.toString(), s.admins[1]!._id.toString()].sort()
    );
    expect(rows.every((row) => row.type === NotificationType.SLA_BREACHED)).toBe(true);
  });

  it('attributes the notification to nobody, because nobody did it', async () => {
    await seed();

    await sweepAt(AT_RISK_RESPONSE);

    const row = await Notification.findOne().lean();
    expect(row?.actorId).toBeNull();
  });
});

describe('a ticket edited mid-sweep', () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * The interleaving `persist` guards against: the sweep read the ticket, somebody
   * saved an edit, and the write arrives holding a version that is no longer current.
   *
   * Forcing it deterministically means handing the sweep a document whose in-memory
   * `version` disagrees with its row, which is precisely what that race produces. The
   * query itself is covered by every other test in this file.
   */
  it('declines the write rather than winding the version back', async () => {
    const s = await seed();
    const stale = await Ticket.findById(s.ticket.id);
    stale!.version = 99;

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: () => ({ limit: () => Promise.resolve([stale]) }),
    } as never);

    const summary = await sweepAt(BREACHED_RESPONSE);

    expect(summary).toMatchObject({ scanned: 1, changed: 0, skipped: 1, breached: 0 });
    /* Nothing written, nobody told, and the real version untouched. */
    await expect(statesOf(s.ticket.id)).resolves.toMatchObject({
      response: SlaState.ON_TRACK,
      version: s.ticket.version,
    });
    await expect(Notification.countDocuments()).resolves.toBe(0);
    expect(slaEvents()).toHaveLength(0);
  });
});
