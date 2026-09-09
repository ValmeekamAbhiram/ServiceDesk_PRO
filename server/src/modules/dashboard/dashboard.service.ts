/**
 * ServiceDesk Pro — dashboard service.
 *
 * ## One authorization rule, imported rather than restated
 *
 * Every query starts from `ticketScopeFilter(actor)` — the same expression the ticket
 * list uses. So an employee gets a real dashboard of their own tickets rather than a
 * 403, a technician gets the whole desk, and the at-risk panel can never surface a
 * ticket its reader would get a 404 for. A second copy of that rule here is the one
 * thing that could break the promise, which is why the ticket service exports it.
 *
 * `technicianLoad` is the exception: it is other people's workload, so it is filled
 * only for a caller holding `analytics:view` — technicians and admins — and left empty
 * for everyone else, as the DTO says.
 *
 * ## Two kinds of query, and nothing that loads the collection
 *
 * Tallies (`byStatus`, `byPriority`, `byCategory`, open counts) are `$group` stages:
 * unbounded input, one row of output per key. Anything that needs business-hours
 * arithmetic or an SLA verdict cannot be done in the aggregation language at all, so
 * those come from a single `.lean()` read bounded to the last 14 days — the same rows
 * serve the volume chart, both KPI windows and the per-technician averages.
 *
 * SLA state is recomputed through `evaluateTicketSla` rather than read from the
 * cached `sla.*.state`. The cache is only as fresh as the background monitor, and a
 * dashboard that disagrees with the badge on the ticket it links to is worse than one
 * that costs a few milliseconds of arithmetic.
 *
 * ## The demo clock shows through here
 *
 * `createdAt` is written by Mongoose from the real system clock; `resolvedAt` is
 * written from `actor.clock`. Under a demo clock wound forward, the created series
 * therefore stays where real time put it while the resolved series follows the jump.
 * That is a property of the Time Machine, not a bug to paper over — the alternative
 * is a chart that lies about when work actually arrived.
 */

import type { FilterQuery, Types } from 'mongoose';
import {
  OPEN_TICKET_STATUSES,
  Permission,
  PRIORITIES,
  SlaState,
  STAFF_ROLES,
  TICKET_STATUSES,
  UserStatus,
  type Priority,
  type TicketStatus,
} from '@shared/enums';
import { PRIORITY_META, TICKET_STATUS_META } from '@shared/labels';
import type {
  CountByKeyDto,
  DashboardDto,
  KpiDto,
  TechnicianLoadDto,
  TicketListItemDto,
  TimeSeriesPointDto,
} from '@shared/types';
import { DAY_MS } from '@shared/utils';
import { can, type ActorContext } from '@/core/actor';
import {
  businessDateKey,
  businessMinutesBetween,
  evaluateTicketSla,
  recentBusinessDays,
  type SlaPolicySnapshot,
  type TicketSlaSnapshot,
} from '@/core/sla';
import { Category, Ticket, User, type TicketDoc } from '@/models';
import {
  TICKET_POPULATE,
  ticketMapContext,
  ticketScopeFilter,
} from '@/modules/tickets/ticket.service';
import {
  toTicketListItemDto,
  type TicketMapContext,
  type TicketSource,
} from '@/modules/tickets/ticket.mapper';
import { toUserRefDto, type UserRefSource } from '@/modules/users/user.mapper';

/* ──────────────────────────────── shape knobs ───────────────────────────────── */

/** Two weeks of columns: enough to see last week against this one on one screen. */
const VOLUME_DAYS = 14;

/** The KPI comparison window, and the one `resolvedLast7Days` counts over. */
const WINDOW_DAYS = 7;

/**
 * How many of the nearest deadlines the at-risk scan looks at, and how many rows the
 * panel shows. The scan is a slice rather than a filter because "at risk" is a share
 * of a *budget* — a four-hour target and a three-day one cross their thresholds at
 * different distances from the deadline, which no single Mongo comparison expresses.
 * Ordering by deadline and evaluating the front of the queue is right whenever the
 * desk has fewer than 25 open tickets due sooner than a genuinely at-risk one, and
 * this is a "needs attention" panel, not a report anyone reconciles against.
 */
const AT_RISK_SCAN = 25;
const AT_RISK_LIMIT = 5;

/** Categories are long-tailed; past the sixth the chart is illegible anyway. */
const CATEGORY_SLICE = 6;

/* ─────────────────────────────── small helpers ──────────────────────────────── */

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Percent change against the previous period, or null when there is no baseline to
 * compare against. Zero previously is not a 100% rise — it is an undefined one, and
 * the DTO says so, so the client renders nothing rather than a made-up arrow.
 */
function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

function countsFrom<K extends string>(
  counts: Map<string, number>,
  keys: readonly K[],
  labels: Record<K, { label: string }>
): CountByKeyDto[] {
  return keys.map((key) => ({
    key,
    label: labels[key]?.label ?? key,
    count: counts.get(key) ?? 0,
  }));
}

/** `{ _id, count }` rows from a `$group`, keyed by their id as a string. */
function toCountMap(rows: { _id: unknown; count: number }[]): Map<string, number> {
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

/* ────────────────────────────────── tallies ─────────────────────────────────── */

interface TallyFacet {
  status: { _id: TicketStatus; count: number }[];
  priority: { _id: Priority; count: number }[];
  category: { _id: Types.ObjectId; count: number }[];
}

/**
 * Every whole-collection count in one round trip. `$facet` runs the three groupings
 * over a single pass of the scoped tickets, and the open-ticket KPI is then a sum of
 * the status tally rather than a fourth query.
 */
async function tally(scope: FilterQuery<TicketDoc>): Promise<TallyFacet> {
  const [facet] = await Ticket.aggregate<TallyFacet>([
    { $match: scope },
    {
      $facet: {
        status: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        priority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
        category: [
          { $group: { _id: '$categoryId', count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: CATEGORY_SLICE },
        ],
      },
    },
  ]);
  return facet ?? { status: [], priority: [], category: [] };
}

/**
 * Category ids carry no label, so the busiest few are looked up by name — one query
 * for at most `CATEGORY_SLICE` ids. The colour comes from the category itself, which
 * is the only one of the three charts whose colours are data rather than semantics:
 * a status or a priority has a *meaning* the client renders, a category has a hex.
 */
async function categoryCounts(rows: TallyFacet['category']): Promise<CountByKeyDto[]> {
  if (rows.length === 0) return [];
  const found = await Category.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('name color')
    .lean();
  const byId = new Map(found.map((doc) => [String(doc._id), doc]));

  return rows.map((row) => {
    const category = byId.get(String(row._id));
    return {
      key: String(row._id),
      label: category?.name ?? 'Removed category',
      count: row.count,
      ...(category?.color ? { color: category.color } : {}),
    };
  });
}

/* ─────────────────── the bounded read behind the chart and KPIs ─────────────── */

/** Exactly the fields the maths below needs, and nothing that would need populating. */
interface RecentRow {
  assigneeId: Types.ObjectId | null;
  createdAt: Date;
  resolvedAt: Date | null;
  sla: TicketSlaSnapshot;
}

/**
 * Tickets that either arrived or were resolved inside the window. The `$or` matters:
 * a ticket raised last month and resolved this morning belongs on today's resolved
 * column, and a filter on `createdAt` alone would miss it.
 */
async function recentRows(scope: FilterQuery<TicketDoc>, from: Date): Promise<RecentRow[]> {
  const rows = await Ticket.find({
    $and: [scope, { $or: [{ createdAt: { $gte: from } }, { resolvedAt: { $gte: from } }] }],
  })
    .select('assigneeId createdAt resolvedAt sla')
    .lean();
  return rows as unknown as RecentRow[];
}

/**
 * Counts per business day, zero-filled across the whole window so the chart has a
 * column for a quiet Sunday. Rows whose `createdAt` predates the window simply fall
 * outside `keys` and are dropped here — they were fetched for their resolution.
 */
function volumeSeries(
  rows: RecentRow[],
  keys: readonly string[],
  hours: SlaPolicySnapshot['businessHours']
): TimeSeriesPointDto[] {
  const created = new Map<string, number>();
  const resolved = new Map<string, number>();
  const bump = (into: Map<string, number>, key: string): void => {
    into.set(key, (into.get(key) ?? 0) + 1);
  };

  for (const row of rows) {
    bump(created, businessDateKey(row.createdAt, hours));
    if (row.resolvedAt) bump(resolved, businessDateKey(row.resolvedAt, hours));
  }

  return keys.map((date) => ({
    date,
    created: created.get(date) ?? 0,
    resolved: resolved.get(date) ?? 0,
  }));
}

/* ──────────────────────────── KPI windows ───────────────────────────────────── */

/** One period's worth of resolved work, accumulated in a single pass over the rows. */
interface Window {
  resolved: number;
  compliant: number;
  businessMinutes: number;
}

const emptyWindow = (): Window => ({ resolved: 0, compliant: 0, businessMinutes: 0 });

/**
 * Business hours from the start of the resolution clock to the resolve — working
 * hours, not wall-clock ones, so a ticket raised at 17:55 and fixed at 09:05 the next
 * morning reads as ten minutes rather than fifteen hours.
 *
 * `startedAt` rather than `createdAt`, because a reopen restarts the clock and the
 * second attempt should not be charged for the first one's calendar time. `createdAt`
 * is the fallback for rows written before the SLA snapshot carried a start instant.
 */
function resolutionMinutes(row: RecentRow, hours: SlaPolicySnapshot['businessHours']): number {
  if (!row.resolvedAt) return 0;
  const started = row.sla.resolution.startedAt ?? row.createdAt;
  return Math.max(0, businessMinutesBetween(started, row.resolvedAt, hours));
}

/**
 * Compliance counts a ticket, not a target: breaching either the response or the
 * resolution clock costs it. That is the same `breached` flag the ticket row shows, so
 * the headline percentage and the badges underneath it can never disagree.
 */
function accumulate(into: Window, row: RecentRow, now: Date, policy: SlaPolicySnapshot): void {
  into.resolved += 1;
  if (!evaluateTicketSla(row.sla, now, policy).breached) into.compliant += 1;
  into.businessMinutes += resolutionMinutes(row, policy.businessHours);
}

/** An empty window reports 0, never a flattering 100 — the count beside it says why. */
const compliancePercent = (window: Window): number =>
  window.resolved === 0 ? 0 : round1((window.compliant / window.resolved) * 100);

const avgHours = (window: Window): number =>
  window.resolved === 0 ? 0 : round1(window.businessMinutes / window.resolved / 60);

function buildKpis(open: number, current: Window, previous: Window): KpiDto[] {
  const compliance = compliancePercent(current);
  const resolution = avgHours(current);
  return [
    {
      label: 'Open tickets',
      value: open,
      /* A snapshot has nothing to compare against: "the queue a week ago" is not
       * recoverable from the tickets themselves, and inventing it from `createdAt`
       * would ignore everything closed since. */
      changePercent: null,
      higherIsBetter: false,
      format: 'number',
    },
    {
      label: 'Resolved (7 days)',
      value: current.resolved,
      changePercent: changePercent(current.resolved, previous.resolved),
      higherIsBetter: true,
      format: 'number',
    },
    {
      label: 'SLA compliance',
      value: compliance,
      changePercent: changePercent(compliance, compliancePercent(previous)),
      higherIsBetter: true,
      format: 'percent',
    },
    {
      label: 'Avg resolution',
      value: resolution,
      changePercent: changePercent(resolution, avgHours(previous)),
      higherIsBetter: false,
      format: 'hours',
    },
  ];
}

/* ─────────────────────────── who is carrying what ───────────────────────────── */

interface LoadRow {
  _id: Types.ObjectId;
  open: number;
  breached: number;
}

/**
 * Open work per assignee, with the overdue share counted in the same pass.
 *
 * The `$cond` is a transcription of the engine's rule for an unmet target — no `metAt`
 * and a deadline that has passed — rather than a read of the cached `state`, which
 * only the background monitor refreshes. Resolving a ticket stamps `metAt`, so among
 * open tickets the first clause is normally redundant; it is spelled out anyway so the
 * predicate stands on its own if that ever changes.
 */
async function openLoad(
  scope: FilterQuery<TicketDoc>,
  now: Date
): Promise<Map<string, LoadRow>> {
  const overdue = {
    $and: [
      { $eq: ['$sla.resolution.metAt', null] },
      { $ne: ['$sla.resolution.dueAt', null] },
      { $lte: ['$sla.resolution.dueAt', now] },
    ],
  };

  const rows = await Ticket.aggregate<LoadRow>([
    { $match: { $and: [scope, { status: { $in: OPEN_TICKET_STATUSES }, assigneeId: { $ne: null } }] } },
    {
      $group: {
        _id: '$assigneeId',
        open: { $sum: 1 },
        breached: { $sum: { $cond: [overdue, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
}

/**
 * Every active technician and admin, including the ones holding nothing — a board that
 * hides idle staff cannot answer "who is free", which is most of the reason to look at
 * it. Busiest first, so the answer is at whichever end the reader looks.
 */
async function technicianLoad(
  scope: FilterQuery<TicketDoc>,
  rows: RecentRow[],
  now: Date,
  policy: SlaPolicySnapshot
): Promise<TechnicianLoadDto[]> {
  const [staff, load] = await Promise.all([
    User.find({ role: { $in: STAFF_ROLES }, status: UserStatus.ACTIVE })
      .select('name email role')
      .lean(),
    openLoad(scope, now),
  ]);

  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const perPerson = new Map<string, Window>();
  for (const row of rows) {
    if (!row.assigneeId || !row.resolvedAt || row.resolvedAt < since) continue;
    const key = String(row.assigneeId);
    const window = perPerson.get(key) ?? emptyWindow();
    accumulate(window, row, now, policy);
    perPerson.set(key, window);
  }

  return staff
    .map((person) => {
      const id = String(person._id);
      const queue = load.get(id);
      const window = perPerson.get(id);
      return {
        technician: toUserRefDto(person as unknown as UserRefSource),
        open: queue?.open ?? 0,
        resolvedLast7Days: window?.resolved ?? 0,
        breached: queue?.breached ?? 0,
        avgResolutionHours: window && window.resolved > 0 ? avgHours(window) : null,
      };
    })
    .sort((a, b) => b.open - a.open || a.technician.name.localeCompare(b.technician.name));
}

/* ────────────────────────────── needs attention ─────────────────────────────── */

/**
 * The queue's worst offenders: open tickets whose *resolution* clock is at risk or
 * already past, nearest deadline first.
 *
 * Resolution only, deliberately. The panel is ordered by the resolution deadline, so
 * mixing in tickets flagged by their much shorter response clock would produce a list
 * whose order did not match its contents; a response about to breach shows up on the
 * ticket's own SLA badge in the list it appears in.
 *
 * Rows are mapped through `toTicketListItemDto` with the same context the ticket list
 * uses, so the panel links to real rows and shows the same countdown they do.
 */
async function atRiskTickets(
  scope: FilterQuery<TicketDoc>,
  ctx: TicketMapContext
): Promise<TicketListItemDto[]> {
  const rows = await Ticket.find({
    $and: [
      scope,
      { status: { $in: OPEN_TICKET_STATUSES }, 'sla.resolution.dueAt': { $ne: null } },
    ],
  })
    .populate(TICKET_POPULATE.map((path) => ({ ...path })))
    .sort({ 'sla.resolution.dueAt': 1, _id: 1 })
    .limit(AT_RISK_SCAN);

  const urgent: TicketListItemDto[] = [];
  for (const row of rows) {
    const { state } = evaluateTicketSla(row.sla, ctx.now, ctx.policy).resolution;
    if (state !== SlaState.AT_RISK && state !== SlaState.BREACHED) continue;
    urgent.push(toTicketListItemDto(row as unknown as TicketSource, ctx));
    if (urgent.length === AT_RISK_LIMIT) break;
  }
  return urgent;
}

/* ──────────────────────────────── the endpoint ──────────────────────────────── */

export async function getDashboard(actor: ActorContext): Promise<DashboardDto> {
  const scope = ticketScopeFilter(actor);
  const ctx = await ticketMapContext(actor);
  const hours = ctx.policy.businessHours;

  const { keys, from } = recentBusinessDays(ctx.now, VOLUME_DAYS, hours);
  const currentFrom = new Date(ctx.now.getTime() - WINDOW_DAYS * DAY_MS);
  const previousFrom = new Date(ctx.now.getTime() - 2 * WINDOW_DAYS * DAY_MS);

  /* The chart's window starts at a local midnight and the KPI windows are rolling
   * seven-day spans from `now`, so neither one contains the other. Read from whichever
   * reaches further back and let each of them pick its own rows out of the result. */
  const readFrom = new Date(Math.min(from.getTime(), previousFrom.getTime()));

  const [facet, rows, atRisk] = await Promise.all([
    tally(scope),
    recentRows(scope, readFrom),
    atRiskTickets(scope, ctx),
  ]);

  const statusCounts = toCountMap(facet.status);
  const open = OPEN_TICKET_STATUSES.reduce(
    (total, status) => total + (statusCounts.get(status) ?? 0),
    0
  );

  const current = emptyWindow();
  const previous = emptyWindow();
  for (const row of rows) {
    if (!row.resolvedAt) continue;
    if (row.resolvedAt >= currentFrom) accumulate(current, row, ctx.now, ctx.policy);
    else if (row.resolvedAt >= previousFrom) accumulate(previous, row, ctx.now, ctx.policy);
  }

  return {
    kpis: buildKpis(open, current, previous),
    byStatus: countsFrom(statusCounts, TICKET_STATUSES, TICKET_STATUS_META),
    byPriority: countsFrom(toCountMap(facet.priority), PRIORITIES, PRIORITY_META),
    byCategory: await categoryCounts(facet.category),
    volume: volumeSeries(rows, keys, hours),
    technicianLoad: can(actor, Permission.ANALYTICS_VIEW)
      ? await technicianLoad(scope, rows, ctx.now, ctx.policy)
      : [],
    atRisk,
  };
}
