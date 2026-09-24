/**
 * ServiceDesk Pro — the SLA monitor.
 *
 * An SLA state is stored on the ticket, not computed on read, because the dashboard
 * counts breaches and a query cannot ask "would this be breached if you evaluated it
 * now?" without doing the maths per row. Something therefore has to notice that a
 * deadline has passed while nobody was looking at the ticket. That is this file: a
 * `setInterval` that sweeps the live queue, writes the states that changed, and
 * notifies whoever is on the hook.
 *
 * ## Why `setInterval` and not a job queue
 *
 * One process owns the desk. A queue would add a service to install, a worker to
 * deploy and a whole failure mode — a sweep that ran twice, notifying twice — in
 * exchange for durability nobody needs here: a missed sweep is corrected by the next
 * one sixty seconds later, because the states are derived from the deadlines rather
 * than accumulated. If this ever runs multi-instance, the sweep needs a lock; until
 * then it does not.
 *
 * ## What makes it safe to run every minute
 *
 * `escalate()` never walks a state backwards, and only ON_TRACK and AT_RISK can
 * change, so the query is narrow and every ticket produces at most one AT_RISK and
 * one BREACHED notification per target for its whole life. A ticket that has been
 * breached for a week is silent. Nothing here can *soften* a state either — only a
 * deliberate priority change may do that, through `repriceTicketSla`.
 *
 * ## Its authority
 *
 * The sweep runs as the system actor, which is unrestricted: it must see every
 * ticket, including ones no signed-in user could. That is safe because the actor is
 * built in-process by code no HTTP route can reach, and because the only fields this
 * file writes are the two SLA states — it cannot assign, comment or change a status.
 */
import { SlaState, TERMINAL_TICKET_STATUSES, Role, UserStatus } from '@shared/enums';
import { ServerEvent } from '@shared/socket';
import { env } from '@/config/env';
import { moduleLogger } from '@/config/logger';
import { getClock } from '@/config/clock';
import { resolvePermissions } from '@/core/authz/permissions';
import { systemUser } from '@/core/actor';
import { sweepTicketSla } from '@/core/sla';
import { Ticket, User } from '@/models';
import { notifySlaState } from '@/modules/notifications/notification.service';
import { getSlaPolicy } from '@/modules/sla/sla-policy.service';
import { emitTicketChange } from '@/realtime/emit';
const log = moduleLogger('sla-monitor');
/** States a sweep can still move. Everything else is already final or already met. */
const OPTIMISTIC = [SlaState.ON_TRACK, SlaState.AT_RISK];
/**
 * Ceiling on one sweep, so a database that has been asleep for a fortnight cannot
 * turn the first tick after a restart into a thousand writes and a thousand
 * notifications in one event-loop turn. The remainder is picked up by the next tick.
 */
const BATCH_LIMIT = 200;
/* ───────────────────────────────── the sweep ─────────────────────────────── */
/**
 * The actor the sweep runs as. Built per sweep rather than once at module load, so it
 * carries a fresh `requestId` and every line the sweep logs can be tied to one tick.
 */
function sweepActor() {
    return {
        user: systemUser(resolvePermissions(Role.ADMIN)),
        requestId: `sla-sweep-${Date.now().toString(36)}`,
        /* The process clock, not a real one: with the demo Time Machine armed, moving the
         * clock forward has to move the sweep's idea of "now" too, or the countdown a
         * demonstration just advanced past its deadline would never actually breach. */
        clock: getClock(),
        ip: null,
        userAgent: null,
        automated: true,
    };
}
/**
 * Admin ids, for tickets with nobody assigned.
 *
 * Read once per sweep and only when something is actually unassigned and escalating —
 * the common sweep changes nothing and this query never runs.
 */
async function activeAdminIds() {
    const rows = await User.find({ role: Role.ADMIN, status: UserStatus.ACTIVE })
        .select('_id')
        .lean();
    return rows.map((row) => String(row._id));
}
/**
 * One pass over the live queue.
 *
 * Exported for the tests and for a manual trigger; the interval below is just a caller.
 * Returns what it did, so a sweep that changed nothing costs one indexed query and one
 * debug line rather than a log entry per ticket.
 *
 * The query is the whole performance story. Terminal tickets are excluded — resolving
 * a ticket stops both clocks, so nothing there can move — and a ticket is only read if
 * one of its two states is still optimistic. `sla_sweep` on the ticket model is a
 * partial index over exactly that condition for the resolution clock.
 */
export async function sweepSlaStates(actor) {
    const startedAt = Date.now();
    const now = actor.clock.now();
    const policy = await getSlaPolicy();
    const tickets = await Ticket.find({
        status: { $nin: TERMINAL_TICKET_STATUSES },
        $or: [{ 'sla.response.state': { $in: OPTIMISTIC } }, { 'sla.resolution.state': { $in: OPTIMISTIC } }],
    })
        .sort({ 'sla.resolution.dueAt': 1 })
        .limit(BATCH_LIMIT);
    const summary = {
        scanned: tickets.length,
        changed: 0,
        atRisk: 0,
        breached: 0,
        skipped: 0,
        durationMs: 0,
    };
    let admins = null;
    for (const ticket of tickets) {
        const next = sweepTicketSla(ticket.sla, now, policy);
        if (!next)
            continue;
        const crossed = statesCrossed(ticket, next);
        if (!(await persist(ticket, next))) {
            summary.skipped += 1;
            continue;
        }
        summary.changed += 1;
        for (const event of crossed) {
            if (event.state === SlaState.BREACHED)
                summary.breached += 1;
            else
                summary.atRisk += 1;
        }
        if (crossed.length > 0 && !ticket.assigneeId)
            admins ??= await activeAdminIds();
        for (const event of crossed) {
            await notifySlaState(ticket, event, admins ?? [], actor);
        }
    }
    summary.durationMs = Date.now() - startedAt;
    return summary;
}
/** The transitions worth telling someone about, in the order they should be sent. */
function statesCrossed(ticket, next) {
    const crossed = [];
    if (next.response !== ticket.sla.response.state) {
        crossed.push({ target: 'response', state: next.response });
    }
    if (next.resolution !== ticket.sla.resolution.state) {
        crossed.push({ target: 'resolution', state: next.resolution });
    }
    return crossed;
}
/**
 * Write the two states and tell any open ticket view. `false` when the row moved
 * underneath us and the write was declined.
 *
 * `updateOne` on exact paths rather than `ticket.save()`, for two reasons: it cannot
 * accidentally persist another field the sweep happens to have touched, and it is one
 * round trip.
 *
 * The `version` in both the filter and the `$set` is the interesting part, and neither
 * half is decoration:
 *
 *  - **In the `$set`**, because `versioned()` adds `$inc: { version: 1 }` to every
 *    update that does not mention the field. A countdown crossing a threshold is not
 *    an edit — bumping it would make every form a technician has open fail its
 *    concurrency check a minute after they opened it. Naming the field is how a write
 *    opts out of that hook, and re-asserting the value it already has is the way to
 *    name it without changing it.
 *  - **In the filter**, because a `$set` of a counter can otherwise wind it *back*: if
 *    somebody saved an edit between the query above and this write, their bump would
 *    be overwritten with the value read before it. Matching on the version instead
 *    means the write simply does not happen, and nothing is lost by skipping — the
 *    states are derived from the deadlines, so the next tick recomputes them from
 *    whatever the edit left behind. An edit that repriced the SLA has probably changed
 *    the answer anyway.
 */
async function persist(ticket, next) {
    const result = await Ticket.updateOne({ _id: ticket._id, version: ticket.version }, {
        $set: {
            'sla.response.state': next.response,
            'sla.resolution.state': next.resolution,
            version: ticket.version,
        },
    });
    if (result.matchedCount === 0)
        return false;
    /* The in-memory document is used for the notification bodies below, so it has to
     * agree with what was just written. */
    ticket.sla.response.state = next.response;
    ticket.sla.resolution.state = next.resolution;
    emitTicketChange(String(ticket._id), ServerEvent.TICKET_SLA_CHANGED, {
        ticketId: String(ticket._id),
        response: next.response,
        resolution: next.resolution,
    });
    return true;
}
/* ──────────────────────────────── the interval ───────────────────────────── */
let timer = null;
let running = false;
/**
 * Start sweeping every `SLA_MONITOR_INTERVAL_SECONDS`, and return the stopper.
 *
 * Three properties this has to hold, all of them learned the hard way by anyone who
 * has written one of these:
 *
 *  - **No overlap.** A sweep slower than the interval must not start a second one on
 *    top of itself; `running` drops the tick instead of queueing it.
 *  - **No crash.** A sweep that throws — a lost connection mid-shutdown, usually —
 *    logs and waits for the next tick. An unhandled rejection in a timer takes the
 *    whole process down, which is a poor trade for a countdown.
 *  - **No held-open process.** `unref()` means a pending timer does not keep Node
 *    alive, so `Ctrl-C` exits at once instead of waiting out the interval.
 *
 * Deliberately *not* run once at startup: boot already does enough, and the first tick
 * is a minute away at most.
 */
export function startSlaMonitor() {
    if (timer)
        return stopSlaMonitor;
    const intervalMs = env.SLA_MONITOR_INTERVAL_SECONDS * 1000;
    timer = setInterval(() => {
        if (running) {
            log.warn('Previous sweep is still running; skipping this tick.');
            return;
        }
        running = true;
        void sweepSlaStates(sweepActor())
            .then((summary) => {
            if (summary.changed === 0) {
                log.debug({ ...summary }, 'SLA sweep found nothing to change');
                return;
            }
            log.info({ ...summary }, 'SLA states updated');
        })
            .catch((error) => log.error({ err: error }, 'SLA sweep failed'))
            .finally(() => {
            running = false;
        });
    }, intervalMs);
    timer.unref();
    log.info({ intervalSeconds: env.SLA_MONITOR_INTERVAL_SECONDS }, 'SLA monitor started');
    return stopSlaMonitor;
}
export function stopSlaMonitor() {
    if (!timer)
        return;
    clearInterval(timer);
    timer = null;
}
