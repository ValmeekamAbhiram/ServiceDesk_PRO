/**
 * ServiceDesk Pro — in-app notifications.
 *
 * ## Two halves
 *
 * *Raising* one (`notifyTicket*`) is called from the ticket service, mid-write.
 * *Reading* them (`list`, `markRead`, `markAllRead`) is called from the bell menu.
 * They share only the collection.
 *
 * ## Raising a notification may never fail a write
 *
 * Every `notifyTicket*` function swallows its own errors. A technician has just been
 * assigned a ticket; the assignment is committed and the response is about to go out.
 * If the notification insert fails, the right outcome is a warning in the log and a
 * bell that does not light up — not a 500 on an assignment that succeeded. That is
 * also why they return `void`: there is no result a caller could usefully branch on.
 *
 * ## Nobody is notified about their own action
 *
 * The rule is applied once, in `recipientsOf()`, rather than at each call site. A
 * technician who assigns a ticket to themselves, or comments on their own ticket,
 * already knows.
 *
 * ## Authorization is the filter, always
 *
 * Every read and every update is keyed on `recipientId: actor.user.id`. There is no
 * middleware to forget, no ownership check to skip, and a notification belonging to
 * somebody else answers 404 — see `markRead`.
 */
import { CommentVisibility, NotificationType, SlaState } from '@shared/enums';
import { ticketStatusMeta } from '@shared/labels';
import { ServerEvent } from '@shared/socket';
import { moduleLogger } from '@/config/logger';
import { actorLabel } from '@/core/actor';
import { Notification } from '@/models';
import { toObjectId } from '@/models/helpers';
import { emitToUser } from '@/realtime/emit';
import { assertFound } from '@/utils/errors';
import { resolvePaging, toPaginated } from '@/utils/respond';
const log = moduleLogger('notifications');
/** Matches the model's documented sweep. Read from the clock, never `Date.now()`. */
const TTL_DAYS = 60;
/**
 * Who hears about a change to this ticket: the person who raised it and whoever is
 * working it, minus the person who made the change, minus duplicates when those are
 * the same user.
 */
function recipientsOf(ticket, actor) {
    const candidates = [String(ticket.requesterId), ticket.assigneeId ? String(ticket.assigneeId) : null];
    return [...new Set(candidates.filter((id) => id !== null && id !== actor.user.id))];
}
/**
 * Write one row per recipient, then emit.
 *
 * The order is the model's rule and not an accident: the socket is an accelerator
 * over a durable store, so a recipient whose laptop was asleep still finds the
 * notification waiting. `insertMany` is one round trip for the fan-out, and each
 * emission carries the same DTO the bell menu renders — so a live update and a
 * refresh cannot disagree about what a notification says.
 */
async function notify(input, actor) {
    if (input.recipients.length === 0)
        return;
    const now = actor.clock.now();
    const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
    const rows = await Notification.insertMany(input.recipients.map((recipientId) => ({
        recipientId: toObjectId(recipientId),
        type: input.type,
        title: input.title,
        body: input.body,
        actorId: actor.automated ? null : toObjectId(actor.user.id),
        link: input.link,
        read: false,
        readAt: null,
        expiresAt,
    })));
    for (const row of rows) {
        emitToUser(String(row.recipientId), ServerEvent.NOTIFICATION, toDto(row));
    }
}
/**
 * The error boundary promised in the header. Every public `notifyTicket*` runs
 * inside this, so a notification problem can never surface as a failed ticket
 * operation.
 */
async function safely(what, run) {
    try {
        await run();
    }
    catch (error) {
        log.warn({ err: error, what }, 'Notification could not be raised; the write is unaffected.');
    }
}
/** Ticket titles are up to 200 characters and the body field holds 1000. */
function quote(title) {
    const trimmed = title.length > 120 ? `${title.slice(0, 119)}…` : title;
    return `"${trimmed}"`;
}
function linkTo(ticket) {
    return `/tickets/${String(ticket._id)}`;
}
export async function notifyTicketAssigned(ticket, actor) {
    await safely('assignment', async () => {
        const assignee = ticket.assigneeId ? String(ticket.assigneeId) : null;
        if (!assignee || assignee === actor.user.id)
            return;
        await notify({
            recipients: [assignee],
            type: NotificationType.TICKET_ASSIGNED,
            title: `Ticket ${ticket.number} assigned to you`,
            body: `${actorLabel(actor)} assigned you ${quote(ticket.title)}.`,
            link: linkTo(ticket),
        }, actor);
    });
}
export async function notifyTicketStatusChanged(ticket, from, to, actor) {
    await safely('status change', async () => {
        await notify({
            recipients: recipientsOf(ticket, actor),
            type: NotificationType.TICKET_STATUS_CHANGED,
            title: `Ticket ${ticket.number} is now ${ticketStatusMeta(to).label}`,
            body: `${actorLabel(actor)} moved ${quote(ticket.title)} from ${ticketStatusMeta(from).label} to ${ticketStatusMeta(to).label}.`,
            link: linkTo(ticket),
        }, actor);
    });
}
/**
 * The visibility rule, which is a security rule.
 *
 * A public comment notifies the requester and the assignee. An **internal note
 * notifies the assignee only** — never the requester, whose bell would otherwise
 * announce the existence of a note the API refuses to show them, and whose body text
 * would leak the author and the ticket it was written on.
 *
 * That the assignee is a safe recipient is not an assumption: `requireAssignableUser`
 * in the ticket service rejects any assignee who is not a technician or admin, so
 * `assigneeId` cannot name an employee.
 */
export async function notifyTicketCommented(ticket, visibility, actor) {
    await safely('comment', async () => {
        const internal = visibility === CommentVisibility.INTERNAL;
        const assignee = ticket.assigneeId ? String(ticket.assigneeId) : null;
        const recipients = internal
            ? [assignee].filter((id) => id !== null && id !== actor.user.id)
            : recipientsOf(ticket, actor);
        await notify({
            recipients,
            type: NotificationType.TICKET_COMMENTED,
            title: internal
                ? `Internal note on ticket ${ticket.number}`
                : `New comment on ticket ${ticket.number}`,
            body: internal
                ? `${actorLabel(actor)} added an internal note on ${quote(ticket.title)}.`
                : `${actorLabel(actor)} commented on ${quote(ticket.title)}.`,
            link: linkTo(ticket),
        }, actor);
    });
}
/**
 * An SLA clock that just crossed a line, raised by the background monitor.
 *
 * ## Who hears it
 *
 * The person working the ticket, and nobody else — an SLA state is an internal
 * operations fact, and a requester told their ticket is "at risk" learns only that
 * the desk is behind, which is not theirs to act on. When the ticket is unassigned
 * there is no such person, so it goes to every admin instead: an unassigned ticket
 * running out of time is precisely the case where the desk needs to be told, and
 * with no assignee the alert would otherwise go nowhere.
 *
 * ## Why it cannot repeat
 *
 * The monitor only calls this for a ticket whose stored state *changed* on this
 * sweep, and `escalate()` never walks a state backwards, so each ticket can produce
 * at most one AT_RISK and one BREACHED notification per target for its whole life.
 * A breach that stays breached is silent, which is the difference between an alert
 * and a nuisance every sixty seconds.
 *
 * `actor` is the system actor, so `actorId` is null and the body says nothing about
 * who caused it — nobody did.
 */
export async function notifySlaState(ticket, input, admins, actor) {
    await safely('sla state', async () => {
        if (input.state !== SlaState.AT_RISK && input.state !== SlaState.BREACHED)
            return;
        const assignee = ticket.assigneeId ? String(ticket.assigneeId) : null;
        const recipients = assignee ? [assignee] : [...new Set(admins)];
        const clock = input.target === 'response' ? 'first response' : 'resolution';
        const breached = input.state === SlaState.BREACHED;
        await notify({
            recipients,
            type: breached ? NotificationType.SLA_BREACHED : NotificationType.SLA_AT_RISK,
            title: breached
                ? `Ticket ${ticket.number} has breached its ${clock} SLA`
                : `Ticket ${ticket.number} is close to its ${clock} SLA`,
            body: breached
                ? `The ${clock} deadline on ${quote(ticket.title)} has passed.`
                : `${quote(ticket.title)} is running out of time for its ${clock} deadline.`,
            link: linkTo(ticket),
        }, actor);
    });
}
/* ────────────────────────────── reading them ─────────────────────────────── */
function toDto(row) {
    return {
        id: String(row._id),
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        read: row.read,
        createdAt: row.createdAt.toISOString(),
    };
}
/** Mine, and only ever mine. The one expression this whole module's authorization rests on. */
function mine(actor) {
    return { recipientId: toObjectId(actor.user.id) };
}
/**
 * The bell menu.
 *
 * `unreadCount` is counted rather than derived from the page, because the badge has
 * to say 12 while the menu shows 5. `_id` breaks the sort tie so two notifications
 * written in the same millisecond — the fan-out of one comment — cannot swap places
 * between pages.
 */
export async function list(query, actor) {
    const { page, limit, skip } = resolvePaging(query);
    const scope = mine(actor);
    const filter = query.unreadOnly ? { ...scope, read: false } : scope;
    const [rows, total, unreadCount] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean().exec(),
        Notification.countDocuments(filter),
        Notification.countDocuments({ ...scope, read: false }),
    ]);
    return { ...toPaginated(rows.map(toDto), page, limit, total), unreadCount };
}
/**
 * Mark one read.
 *
 * The recipient is part of the query rather than checked afterwards, so somebody
 * else's notification is not found — a 404, per the project rule that a row the
 * caller may not see must not be distinguishable from one that does not exist.
 * Marking an already-read notification read again is a no-op that still returns it.
 */
export async function markRead(id, actor) {
    const updated = await Notification.findOneAndUpdate({ _id: toObjectId(id), ...mine(actor) }, { $set: { read: true, readAt: actor.clock.now() } }, { new: true }).lean();
    return toDto(assertFound(updated, 'Notification'));
}
/**
 * Mark everything read, and return the refreshed first page.
 *
 * Returning the list rather than a bare count means the bell menu redraws from the
 * same shape it already renders, and its badge comes from the server instead of the
 * client assuming the count is now zero.
 */
export async function markAllRead(query, actor) {
    await Notification.updateMany({ ...mine(actor), read: false }, { $set: { read: true, readAt: actor.clock.now() } });
    return list(query, actor);
}
