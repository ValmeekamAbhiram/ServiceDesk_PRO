/**
 * ServiceDesk Pro — ticket service.
 *
 * ## The access boundary is `ticketScopeFilter()`
 *
 * Every read and every write in this file starts from `ticketScopeFilter(actor)` and
 * none of them re-derives it. A technician or admin holds `ticket:read:all` and gets `{}`;
 * anyone else gets `{ requesterId: <their own id> }`. Because the filter is part of
 * the *query* rather than a check applied afterwards, an employee asking for someone
 * else's ticket gets `NotFoundError` — the same response as for an id that does not
 * exist. That is deliberate: a 403 on a real id and a 404 on a fake one together
 * confirm which ids are real.
 *
 * The list filters cannot widen this. `?requesterId=<someone else>` is accepted,
 * merged *after* the scope filter, and yields an empty page.
 *
 * ## Mutations go through `.save()`
 *
 * Not `findOneAndUpdate`: a status change pushes onto `statusHistory`, recomputes the
 * SLA and adjusts counters together, and the `versioned()` helper bumps `version` on
 * save. The optimistic-concurrency check (`assertVersion`) happens against the
 * document just loaded, so two technicians resolving the same ticket cannot both win.
 *
 * ## No transactions
 *
 * The deployment target is a standalone `mongod`, so multi-document transactions are
 * unavailable. Where a write touches two collections — a ticket plus a user's
 * `openTicketCount`, a comment plus its parent's `commentCount` — the ticket is
 * written first and the counters follow with `$inc`. A counter is a cached
 * convenience, and the dashboard recomputes from the tickets themselves; a crash
 * between the two leaves a badge one off, never a lost ticket.
 */
import { AuditAction, AuditEntity, CommentVisibility, OPEN_TICKET_STATUSES, Permission, PRIORITY_RANK, SlaState, TICKET_TRANSITIONS, TicketStatus, UserStatus, canTransition, } from '@shared/enums';
import { ServerEvent } from '@shared/socket';
import { can, isStaff } from '@/core/actor';
import { notifyTicketAssigned, notifyTicketCommented, notifyTicketStatusChanged, } from '@/modules/notifications/notification.service';
import { emitToStaff, emitTicketChange } from '@/realtime/emit';
import { isStaffRole } from '@/core/authz/permissions';
import { markTargetMet, reopenTicketSla, repriceTicketSla, startTicketSla } from '@/core/sla';
import { recordAll } from '@/modules/attachments/attachment.service';
import { logger } from '@/config/logger';
import { Asset, Attachment, Category, TICKET_NUMBER_PREFIX, TICKET_SEQUENCE, Ticket, TicketComment, User, nextSequence, toObjectId, } from '@/models';
import { getSlaPolicy } from '@/modules/sla/sla-policy.service';
import { diff, record } from '@/modules/audit/audit.service';
import { ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError, assertFound, assertVersion, } from '@/utils/errors';
import { resolvePaging, toPaginated } from '@/utils/respond';
import { toAttachmentDto, toTicketCommentDto, toTicketDto, toTicketListItemDto, } from '@/modules/tickets/ticket.mapper';
const log = logger.child({ module: 'ticket.service' });
/**
 * The fields an edit is allowed to report to the audit trail, and the flat shape they
 * are compared in.
 *
 * A whitelist rather than the whole document, for two reasons. `description` is up to
 * 20,000 characters and copying both versions of it into an audit row would put the
 * bulk of the ticket into a second collection for no gain — the field is named as
 * changed, and the ticket itself holds the current text. And the counters, the SLA
 * subdocument and `statusHistory` all move for reasons that are not edits, so
 * including them would bury the one line that was.
 */
const AUDITED_TICKET_FIELDS = [
    'title',
    'priority',
    'description',
    'categoryId',
    'assetId',
];
function auditSnapshot(ticket) {
    return {
        title: ticket.title,
        priority: ticket.priority,
        /* Previewed, not copied. A description runs to 20,000 characters and both versions
         * of it would dwarf every other row in the collection; eighty characters is enough
         * to see *that* the text was rewritten and roughly how, and the ticket itself still
         * holds the current wording in full. */
        description: preview(ticket.description),
        categoryId: ticket.categoryId,
        assetId: ticket.assetId,
    };
}
function preview(text) {
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
/* ─────────────────────────── scope and shared loads ─────────────────────── */
/**
 * The whole authorization model for tickets, in one expression. Callers merge their
 * own filters *after* this, never before, so a caller-supplied filter can only ever
 * narrow the result.
 *
 * Exported for the dashboard, which aggregates over this same collection and has to
 * count exactly the rows this file would have returned. A second copy of the rule
 * over there would be free to drift from this one, and the first symptom would be an
 * at-risk panel listing tickets its reader cannot open.
 */
export function ticketScopeFilter(actor) {
    if (can(actor, Permission.TICKET_READ_ALL))
        return {};
    return { requesterId: toObjectId(actor.user.id) };
}
/**
 * Fields every ticket response needs populated, in one place so they cannot drift.
 * Exported alongside `ticketScopeFilter` for the dashboard: its at-risk panel renders
 * real `TicketListItemDto`s, and the mapper reads references the list DTO declares. A
 * shorter local list over there would silently start returning nulls the day that DTO
 * grows a field.
 */
export const TICKET_POPULATE = [
    { path: 'requesterId', select: 'name email role' },
    { path: 'assigneeId', select: 'name email role' },
    { path: 'categoryId', select: 'name color' },
    { path: 'assetId', select: 'tag name type status' },
];
/** 404 for "not yours" as well as "not there" — see the header. */
async function loadScoped(id, actor) {
    const found = await Ticket.findOne({ _id: toObjectId(id), ...ticketScopeFilter(actor) });
    return assertFound(found, 'Ticket');
}
/**
 * The payload for every ticket event: an id and the human reference, never ticket
 * fields. `TicketEventPayload` in the shared contract explains why — one event
 * reaches readers with different visibility, so each client re-fetches through the
 * endpoint that enforces its own permissions.
 */
function ticketEvent(ticket) {
    return { ticketId: String(ticket._id), number: ticket.number };
}
export async function ticketMapContext(actor) {
    return { now: actor.clock.now(), policy: await getSlaPolicy() };
}
/**
 * Reload with references populated before mapping. A `.save()` returns the document
 * with its refs as raw ids, and the DTO needs names — one extra read per mutation,
 * which is a fair price for never shipping a half-populated row.
 */
async function detailById(id, actor) {
    const found = await Ticket.findById(id).populate(TICKET_POPULATE.map((p) => ({ ...p })));
    const ticket = assertFound(found, 'Ticket');
    const [ctx, attachments, actors] = await Promise.all([
        ticketMapContext(actor),
        attachmentsFor(ticket, actor),
        actorsIn(ticket),
    ]);
    return toTicketDto(ticket, ctx, { attachments, actors });
}
/** Every user named in the timeline, fetched once rather than populated per row. */
async function actorsIn(ticket) {
    const ids = [...new Set(ticket.statusHistory.map((e) => e.byUserId).filter((id) => id !== null))];
    if (ids.length === 0)
        return new Map();
    const users = await User.find({ _id: { $in: ids } }).select('name email role');
    return new Map(users.map((user) => [String(user._id), user]));
}
/**
 * Ticket-level attachments. Internal ones are filtered out for a non-staff caller,
 * mirroring the comment rule: a file attached to an internal note is as private as
 * the note itself.
 */
async function attachmentsFor(ticket, actor) {
    const rows = await Attachment.find({
        ticketId: ticket._id,
        commentId: null,
        ...(isStaff(actor) ? {} : { visibility: CommentVisibility.PUBLIC }),
    })
        .sort({ createdAt: 1 })
        .populate({ path: 'uploadedById', select: 'name email role' });
    return rows.map((row) => toAttachmentDto(row));
}
/* ──────────────────────────────── references ────────────────────────────── */
function formatTicketNumber(sequence) {
    return `${TICKET_NUMBER_PREFIX}-${String(sequence).padStart(6, '0')}`;
}
/**
 * A bad reference in a body field is a 400 naming the field, not a 404: the caller
 * filled a form in wrong, and the form needs to know which control to highlight.
 * Inactive categories are refused for *new* tickets while existing tickets keep
 * theirs, which is the point of deactivating rather than deleting.
 */
async function requireActiveCategory(categoryId) {
    const category = await Category.findOne({ _id: toObjectId(categoryId), active: true });
    if (!category) {
        throw new ValidationError('Choose a category from the list.', [
            { path: 'categoryId', message: 'That category no longer exists.' },
        ]);
    }
    return category;
}
async function requireAsset(assetId) {
    const asset = await Asset.findById(toObjectId(assetId));
    if (!asset) {
        throw new ValidationError('That asset could not be found.', [
            { path: 'assetId', message: 'Unknown asset.' },
        ]);
    }
    return asset;
}
/**
 * Only an active technician or admin may hold a ticket. Checked because
 * `assigneeId` is a client-supplied id: without this, a ticket could be parked on an
 * employee — who has no queue to see it in — and quietly go nowhere.
 */
async function requireAssignableUser(userId) {
    const user = await User.findById(toObjectId(userId)).select('name email role status');
    if (!user)
        throw new NotFoundError('User');
    if (!isStaffRole(user.role)) {
        throw new ValidationError('Tickets can only be assigned to technicians or admins.', [
            { path: 'assigneeId', message: 'This person is not a technician.' },
        ]);
    }
    if (user.status !== UserStatus.ACTIVE) {
        throw new ValidationError('That account is not active.', [
            { path: 'assigneeId', message: 'This account is deactivated.' },
        ]);
    }
    return user;
}
/* ──────────────────────────────── creating ──────────────────────────────── */
/**
 * The requester is always the authenticated user — there is no "raise on behalf of"
 * in this build, so `requesterId` is never read from the request. When no priority is
 * given the category's own default applies, which is what makes "Network outage"
 * arrive as HIGH without the reporter having to judge it.
 *
 * `files` have already been written to disk and validated by the upload middleware;
 * all that happens here is linking them to the ticket. They are recorded *after* the
 * insert because an attachment needs a ticket id, and they are PUBLIC because a file
 * the requester attached to their own report is not an internal note.
 */
export async function create(input, actor, files = []) {
    const now = actor.clock.now();
    const category = await requireActiveCategory(input.categoryId);
    const asset = input.assetId ? await requireAsset(input.assetId) : null;
    const priority = input.priority ?? category.defaultPriority;
    const policy = await getSlaPolicy();
    const requesterId = toObjectId(actor.user.id);
    /*
     * The number is taken from an atomic counter before the insert. Without
     * transactions a failed insert burns a number, leaving a gap in the sequence —
     * which is harmless. Reusing numbers, or deriving one from a count, would not be.
     */
    const number = formatTicketNumber(await nextSequence(TICKET_SEQUENCE));
    const ticket = await Ticket.create({
        number,
        title: input.title,
        description: input.description,
        status: TicketStatus.OPEN,
        priority,
        priorityRank: PRIORITY_RANK[priority],
        categoryId: category._id,
        requesterId,
        assigneeId: null,
        assetId: asset?._id ?? null,
        statusHistory: [
            { from: null, to: TicketStatus.OPEN, at: now, byUserId: requesterId, note: null },
        ],
        sla: startTicketSla(now, priority, policy),
        /* Set on the insert rather than after `recordAll` below, so the ticket is never
         * saved twice. A second `save()` here would bump `version` to 2 before the
         * creator has seen 1, which is a confusing optimistic-concurrency token to hand
         * back from a create. multer has already parsed the upload by now, so the count
         * is known; only the attachment rows themselves need the ticket's id. */
        attachmentCount: files.length,
    });
    await Promise.all([
        User.updateOne({ _id: requesterId }, { $inc: { openTicketCount: 1 } }),
        Category.updateOne({ _id: category._id }, { $inc: { ticketCount: 1 } }),
        asset
            ? Asset.updateOne({ _id: asset._id }, { $inc: { ticketCount: 1, openTicketCount: 1 } })
            : Promise.resolve(),
    ]);
    if (files.length > 0) {
        await recordAll(files, { ticketId: ticket._id, visibility: CommentVisibility.PUBLIC }, actor);
    }
    log.info({ requestId: actor.requestId, ticketId: String(ticket._id), number, priority }, 'ticket created');
    /* Staff only, and no notification row: the one person who already knows is the
     * requester, and a new ticket is addressed to whoever picks it up rather than to
     * anybody in particular. */
    emitToStaff(ServerEvent.TICKET_CREATED, ticketEvent(ticket));
    await record({
        action: AuditAction.TICKET_CREATED,
        entityType: AuditEntity.TICKET,
        entityId: String(ticket._id),
        entityLabel: number,
        summary: `Raised ${number} at ${priority} priority in ${category.name}`,
    }, actor);
    return detailById(String(ticket._id), actor);
}
/* ───────────────────────────────── listing ──────────────────────────────── */
const SORT_FIELDS = {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    number: 'number',
    /* Never `priority`: Mongo would sort the strings. See `TicketDoc.priorityRank`. */
    priority: 'priorityRank',
    dueAt: 'sla.resolution.dueAt',
};
/**
 * "TKT-000042", "tkt-42" and "42" all mean the same ticket to the person on the
 * phone. Recognising the pattern lets an exact-number lookup bypass the text index,
 * which matters because `$text` tokenises "TKT-000042" and would also return every
 * ticket mentioning it in a description.
 */
function asTicketNumber(term) {
    const match = /^(?:tkt[-\s]?)?(\d{1,6})$/i.exec(term.trim());
    return match ? formatTicketNumber(Number(match[1])) : null;
}
/**
 * Caller filters are combined with `$and` rather than merged into one object. That is
 * not a style choice: `filter.requesterId = query.requesterId` would *overwrite* the
 * `requesterId` that `ticketScopeFilter` put there for an employee, turning a filter into a
 * privilege escalation. Under `$and` every clause must hold, so a caller filter can
 * only ever narrow.
 */
function buildListFilter(query, actor) {
    const selfId = toObjectId(actor.user.id);
    const staffView = can(actor, Permission.TICKET_READ_ALL);
    const clauses = [ticketScopeFilter(actor)];
    /* "Mine" means the work I own, which differs by role: staff hold tickets,
     * employees raise them. Resolving it server-side keeps the client from having to
     * know its own id — or its own role — to ask the obvious question. */
    if (query.scope === 'mine') {
        clauses.push(staffView ? { assigneeId: selfId } : { requesterId: selfId });
    }
    else if (query.scope === 'unassigned') {
        clauses.push({ assigneeId: null });
    }
    else if (query.scope === 'created') {
        clauses.push({ requesterId: selfId });
    }
    if (query.status)
        clauses.push({ status: { $in: query.status } });
    if (query.priority)
        clauses.push({ priority: { $in: query.priority } });
    if (query.categoryId)
        clauses.push({ categoryId: toObjectId(query.categoryId) });
    if (query.assigneeId)
        clauses.push({ assigneeId: toObjectId(query.assigneeId) });
    if (query.requesterId)
        clauses.push({ requesterId: toObjectId(query.requesterId) });
    if (query.assetId)
        clauses.push({ assetId: toObjectId(query.assetId) });
    /* Either target breached counts: a missed first reply is as much a failure as a
     * missed fix, and the queue view asks one question — "what has gone wrong?". */
    if (query.breached) {
        clauses.push({
            $or: [
                { 'sla.response.state': SlaState.BREACHED },
                { 'sla.resolution.state': SlaState.BREACHED },
            ],
        });
    }
    if (query.createdFrom || query.createdTo) {
        clauses.push({
            createdAt: {
                ...(query.createdFrom ? { $gte: query.createdFrom } : {}),
                ...(query.createdTo ? { $lte: query.createdTo } : {}),
            },
        });
    }
    const exactNumber = query.q ? asTicketNumber(query.q) : null;
    if (exactNumber)
        clauses.push({ number: exactNumber });
    return { $and: clauses };
}
/**
 * A text search sorts by relevance and ignores `sortBy`. That is the right default:
 * somebody typing "printer jam" wants the closest match first, not the newest ticket
 * that happens to contain both words. An exact ticket number never reaches the text
 * index at all — `buildListFilter` turns it into a `number` equality.
 */
export async function list(query, actor) {
    const { page, limit, skip } = resolvePaging(query);
    const filter = buildListFilter(query, actor);
    const textTerm = query.q && !asTicketNumber(query.q) ? query.q : null;
    if (textTerm)
        Object.assign(filter, { $text: { $search: textTerm } });
    const direction = query.sortOrder === 'asc' ? 1 : -1;
    /* `_id` breaks ties so paging is stable. Without it two tickets created in the
     * same millisecond can swap places between page 1 and page 2, and a row is either
     * shown twice or not at all. */
    const sort = textTerm
        ? { score: { $meta: 'textScore' }, _id: -1 }
        : { [SORT_FIELDS[query.sortBy]]: direction, _id: direction };
    const cursor = Ticket.find(filter)
        .populate(TICKET_POPULATE.map((p) => ({ ...p })))
        .sort(sort)
        .skip(skip)
        .limit(limit);
    if (textTerm)
        cursor.select({ score: { $meta: 'textScore' } });
    const [rows, total, ctx] = await Promise.all([
        cursor.exec(),
        Ticket.countDocuments(filter),
        ticketMapContext(actor),
    ]);
    return toPaginated(rows.map((row) => toTicketListItemDto(row, ctx)), page, limit, total);
}
export async function getById(id, actor) {
    /* Scoped read first, then the populated read. Two queries, but the 404-for-hidden
     * behaviour lives in exactly one place instead of being re-implemented here. */
    await loadScoped(id, actor);
    return detailById(id, actor);
}
/* ─────────────────────────── denormalised counters ─────────────────────────
 * `openTicketCount` on a user, `ticketCount` / `openTicketCount` on an asset,
 * `ticketCount` on a category. They exist so a list row needs no per-row aggregate,
 * and they are adjusted with `$inc` rather than recomputed: two people resolving
 * different tickets at the same moment would otherwise write each other's stale totals.
 *
 * The category's is a lifetime total, like the asset's `ticketCount` and unlike its
 * `openTicketCount` — the admin list uses it to answer "is anyone still filing against
 * this category?" before retiring one, which a count of currently-open tickets would
 * answer wrongly for a category that saw two hundred tickets and closed them all.
 * ------------------------------------------------------------------------- */
function isOpenStatus(status) {
    return OPEN_TICKET_STATUSES.includes(status);
}
/**
 * Move the ticket's asset link, keeping both assets' counters right. The new asset is
 * resolved *before* the old one is decremented, so a bad `assetId` leaves the counts
 * untouched rather than half-applied.
 */
async function relinkAsset(ticket, nextAssetId) {
    const currentId = ticket.assetId ? String(ticket.assetId) : null;
    if (currentId === nextAssetId)
        return;
    const next = nextAssetId ? await requireAsset(nextAssetId) : null;
    const openDelta = isOpenStatus(ticket.status) ? 1 : 0;
    const writes = [];
    if (ticket.assetId) {
        writes.push(Asset.updateOne({ _id: ticket.assetId }, { $inc: { ticketCount: -1, openTicketCount: -openDelta } }));
    }
    if (next) {
        writes.push(Asset.updateOne({ _id: next._id }, { $inc: { ticketCount: 1, openTicketCount: openDelta } }));
    }
    ticket.assetId = next?._id ?? null;
    await Promise.all(writes);
}
/** Applied whenever a ticket crosses the open/closed line, in either direction. */
async function shiftOpenCounters(ticket, delta) {
    await Promise.all([
        User.updateOne({ _id: ticket.requesterId }, { $inc: { openTicketCount: delta } }),
        ticket.assigneeId
            ? User.updateOne({ _id: ticket.assigneeId }, { $inc: { assignedTicketCount: delta } })
            : Promise.resolve(),
        ticket.assetId
            ? Asset.updateOne({ _id: ticket.assetId }, { $inc: { openTicketCount: delta } })
            : Promise.resolve(),
    ]);
}
/* ──────────────────────────────── editing ───────────────────────────────── */
/**
 * Fields a person typed, plus the two that have consequences: changing the category
 * is bookkeeping, changing the **priority** moves both SLA deadlines.
 *
 * Repricing keeps the original start instant, so raising a ticket to URGENT applies
 * the urgent budget from when it was raised rather than from now — the problem was
 * urgent all along, somebody just noticed late. This is the only place an SLA state
 * may be softened, and `repriceTarget` explains why that is legitimate.
 *
 * Status is not editable here. It moves through `changeStatus` alone, which consults
 * the transition table.
 */
export async function update(id, input, actor) {
    const ticket = await loadScoped(id, actor);
    assertVersion(input.version, ticket.version, 'ticket');
    /* Captured before the mutations below, because the trail records what changed and a
     * Mongoose document has no memory of what it used to hold once assigned. */
    const before = auditSnapshot(ticket);
    /* The category's *name*, kept for the audit summary. `changes` can only carry the id
     * — the previous category's name is not loaded and is not worth a query — so the
     * readable half of the entry has to be captured while the document is in hand. */
    let movedTo = null;
    if (input.title !== undefined)
        ticket.title = input.title;
    if (input.description !== undefined)
        ticket.description = input.description;
    if (input.categoryId !== undefined && input.categoryId !== String(ticket.categoryId)) {
        /* Resolved before either counter moves, so a category that has been retired since the
         * form was opened leaves both totals untouched instead of decrementing the old one and
         * then throwing. */
        const next = await requireActiveCategory(input.categoryId);
        const previousId = ticket.categoryId;
        movedTo = next.name;
        ticket.categoryId = next._id;
        await Promise.all([
            Category.updateOne({ _id: previousId }, { $inc: { ticketCount: -1 } }),
            Category.updateOne({ _id: next._id }, { $inc: { ticketCount: 1 } }),
        ]);
    }
    if (input.assetId !== undefined)
        await relinkAsset(ticket, input.assetId);
    if (input.priority !== undefined && input.priority !== ticket.priority) {
        const [policy, now] = [await getSlaPolicy(), actor.clock.now()];
        const previous = ticket.priority;
        ticket.priority = input.priority;
        ticket.sla = repriceTicketSla(ticket.sla, input.priority, now, policy);
        log.info({ requestId: actor.requestId, ticketId: id, from: previous, to: input.priority }, 'ticket priority changed');
    }
    await ticket.save();
    await record({
        action: AuditAction.TICKET_UPDATED,
        entityType: AuditEntity.TICKET,
        entityId: id,
        entityLabel: ticket.number,
        summary: movedTo ? `Edited ${ticket.number} and moved it to ${movedTo}` : `Edited ${ticket.number}`,
        changes: diff(before, auditSnapshot(ticket), AUDITED_TICKET_FIELDS),
    }, actor);
    return detailById(id, actor);
}
/**
 * Assign or unassign. A no-op assignment returns early rather than saving: bumping
 * `version` for a change nobody made would invalidate every other editor's form for
 * nothing.
 */
export async function assign(id, input, actor) {
    const ticket = await loadScoped(id, actor);
    assertVersion(input.version, ticket.version, 'ticket');
    const previousId = ticket.assigneeId ? String(ticket.assigneeId) : null;
    if (previousId === input.assigneeId)
        return detailById(id, actor);
    const assignee = input.assigneeId ? await requireAssignableUser(input.assigneeId) : null;
    ticket.assigneeId = assignee?._id ?? null;
    await ticket.save();
    /* Only open tickets count towards a technician's load — a resolved one is not work
     * anybody still has to do. */
    if (isOpenStatus(ticket.status)) {
        await Promise.all([
            previousId
                ? User.updateOne({ _id: previousId }, { $inc: { assignedTicketCount: -1 } })
                : Promise.resolve(),
            assignee
                ? User.updateOne({ _id: assignee._id }, { $inc: { assignedTicketCount: 1 } })
                : Promise.resolve(),
        ]);
    }
    log.info({ requestId: actor.requestId, ticketId: id, from: previousId, to: input.assigneeId }, input.assigneeId ? 'ticket assigned' : 'ticket unassigned');
    await notifyTicketAssigned(ticket, actor);
    emitTicketChange(id, ServerEvent.TICKET_UPDATED, ticketEvent(ticket));
    await record({
        action: AuditAction.TICKET_ASSIGNED,
        entityType: AuditEntity.TICKET,
        entityId: id,
        entityLabel: ticket.number,
        summary: assignee
            ? `Assigned ${ticket.number} to ${assignee.name}`
            : `Returned ${ticket.number} to the unassigned queue`,
        changes: [{ field: 'assigneeId', from: previousId, to: input.assigneeId }],
    }, actor);
    return detailById(id, actor);
}
async function applyStatusChange(ticket, to, detail, actor) {
    const from = ticket.status;
    /* Also rejects `from === to`: no status lists itself as a legal next step, so
     * "resolve an already-resolved ticket" needs no special case. */
    if (!canTransition(from, to)) {
        throw new InvalidTransitionError('ticket', from, to, TICKET_TRANSITIONS[from]);
    }
    const now = actor.clock.now();
    if (to === TicketStatus.RESOLVED) {
        /* Required by the service rather than the schema, because it is required only
         * for this one transition. An existing note survives a resolve → reopen →
         * resolve cycle, so the second resolve need not repeat itself. */
        const resolutionNote = detail.resolutionNote ?? ticket.resolutionNote;
        if (!resolutionNote) {
            throw new ValidationError('Say what fixed it before resolving the ticket.', [
                { path: 'resolutionNote', message: 'Required when resolving a ticket.' },
            ]);
        }
        ticket.resolutionNote = resolutionNote;
        ticket.resolvedAt = now;
        /* Both clocks stop, not just the resolution one. A ticket fixed on sight — no
         * comment, straight to resolved — has plainly been responded to, and leaving its
         * response target open would let it drift into BREACHED days later for a reply
         * nobody was still waiting for. `markTargetMet` is a no-op once `metAt` is set,
         * so the usual reply-then-resolve path is untouched, and the verdict is still
         * decided against the response deadline rather than assumed to be on time. */
        ticket.sla = {
            ...ticket.sla,
            response: markTargetMet(ticket.sla.response, now),
            resolution: markTargetMet(ticket.sla.resolution, now),
        };
    }
    if (to === TicketStatus.CLOSED)
        ticket.closedAt = now;
    if (to === TicketStatus.REOPENED) {
        const policy = await getSlaPolicy();
        ticket.reopenCount += 1;
        ticket.resolvedAt = null;
        ticket.closedAt = null;
        /* `resolutionNote` is deliberately kept: what was tried and did not hold is the
         * most useful thing on the page for whoever picks the ticket up next. */
        ticket.sla = reopenTicketSla(ticket.sla, now, ticket.priority, policy);
    }
    ticket.status = to;
    ticket.statusHistory.push({
        from,
        to,
        at: now,
        byUserId: toObjectId(actor.user.id),
        note: detail.note ?? null,
    });
    await ticket.save();
    const wasOpen = isOpenStatus(from);
    const nowOpen = isOpenStatus(to);
    if (wasOpen !== nowOpen)
        await shiftOpenCounters(ticket, nowOpen ? 1 : -1);
    log.info({ requestId: actor.requestId, ticketId: String(ticket._id), from, to }, 'ticket status changed');
    await notifyTicketStatusChanged(ticket, from, to, actor);
    emitTicketChange(String(ticket._id), ServerEvent.TICKET_UPDATED, ticketEvent(ticket));
    /* Recorded here rather than in `changeStatus` and `reopen` separately, so the
     * requester's own reopen lands in the trail on the same terms as a technician's
     * resolve — one write path, one entry, no way for an entry point to forget. */
    await record({
        action: AuditAction.TICKET_STATUS_CHANGED,
        entityType: AuditEntity.TICKET,
        entityId: String(ticket._id),
        entityLabel: ticket.number,
        summary: `Moved ${ticket.number} from ${from} to ${to}`,
        changes: [{ field: 'status', from, to }],
    }, actor);
}
export async function changeStatus(id, input, actor) {
    const ticket = await loadScoped(id, actor);
    assertVersion(input.version, ticket.version, 'ticket');
    await applyStatusChange(ticket, input.status, { note: input.note, resolutionNote: input.resolutionNote }, actor);
    return detailById(id, actor);
}
/**
 * The requester's own route back. Its authorization is here rather than in middleware
 * for the reason given above: an employee holds no `ticket:update`, so a
 * `requirePermission` guard would either lock them out of their own ticket or be
 * satisfied by a permission everyone has — and a guard everyone passes is worse than
 * no guard, because it reads as protection.
 *
 * `ticketScopeFilter` has already limited an employee to their own tickets, so this check
 * exists for the one case it does not cover: a technician reopening a ticket they
 * neither raised nor were assigned. That is legitimate desk work, hence `isStaff`.
 */
export async function reopen(id, input, actor) {
    const ticket = await loadScoped(id, actor);
    assertVersion(input.version, ticket.version, 'ticket');
    const isRequester = String(ticket.requesterId) === actor.user.id;
    if (!isRequester && !isStaff(actor)) {
        throw new ForbiddenError('Only the person who raised this ticket can reopen it.');
    }
    await applyStatusChange(ticket, TicketStatus.REOPENED, { note: input.note }, actor);
    return detailById(id, actor);
}
/* ──────────────────────────────── comments ──────────────────────────────────
 * `visibility` is the security-sensitive field in this collection. It is enforced in
 * two independent places, as `ticket-comment.model.ts` describes: the query below
 * adds `visibility: PUBLIC` for a non-staff caller, so internal rows never leave the
 * database, and the socket emitter (notifications module) publishes internal comments
 * only to the staff room. One filter is one refactor away from being dropped; two in
 * different layers is a property.
 * ------------------------------------------------------------------------- */
export async function addComment(id, input, actor, files = []) {
    const ticket = await loadScoped(id, actor);
    if (input.visibility === CommentVisibility.INTERNAL &&
        !can(actor, Permission.TICKET_COMMENT_INTERNAL)) {
        throw new ForbiddenError('Only technicians and admins can post internal notes.');
    }
    /*
     * What counts as "the first response" for the SLA: a reply the requester can
     * actually see, written by somebody other than the requester. An internal note is
     * not a reply to anyone, and a technician commenting on a ticket they raised
     * themselves is not answering a customer — treating either as a response would let
     * the response target be met without a single word reaching the person waiting.
     */
    const now = actor.clock.now();
    const stopsResponseClock = isStaff(actor) &&
        ticket.firstResponseAt === null &&
        input.visibility === CommentVisibility.PUBLIC &&
        String(ticket.requesterId) !== actor.user.id;
    const comment = await TicketComment.create({
        ticketId: ticket._id,
        authorId: toObjectId(actor.user.id),
        /* Copied, not populated — the timeline must still name the author after the
         * account is deactivated or removed. */
        authorLabel: actor.user.name,
        body: input.body,
        visibility: input.visibility,
        isFirstResponse: stopsResponseClock,
    });
    /* The comment's visibility is copied onto its attachments, so a file on an
     * internal note is as private as the note. The download route re-reads that field
     * rather than trusting whoever listed the attachment to have filtered correctly. */
    const attachments = files.length > 0
        ? await recordAll(files, { ticketId: ticket._id, commentId: comment._id, visibility: input.visibility }, actor)
        : [];
    ticket.commentCount += 1;
    ticket.attachmentCount += attachments.length;
    if (stopsResponseClock) {
        ticket.firstResponseAt = now;
        ticket.sla = { ...ticket.sla, response: markTargetMet(ticket.sla.response, now) };
    }
    await ticket.save();
    log.info({
        requestId: actor.requestId,
        ticketId: id,
        commentId: String(comment._id),
        visibility: input.visibility,
        firstResponse: stopsResponseClock,
    }, 'comment added');
    await notifyTicketCommented(ticket, input.visibility, actor);
    /*
     * The second of the two independent places the visibility rule is enforced, as the
     * section header above promises. An internal note is emitted to the staff room
     * only; the ticket room contains the requester, who must not learn that an internal
     * note exists — not even that one arrived.
     */
    if (input.visibility === CommentVisibility.INTERNAL) {
        emitToStaff(ServerEvent.TICKET_COMMENTED, ticketEvent(ticket));
    }
    else {
        emitTicketChange(id, ServerEvent.TICKET_COMMENTED, ticketEvent(ticket));
    }
    /* The body is deliberately not in the trail. The audit list is an administrator's
     * view of *actions*, and copying every comment into it would duplicate the whole
     * conversation into a collection nobody can redact — while the comment itself is
     * already permanent, attributed and timestamped on the ticket. */
    await record({
        action: AuditAction.COMMENT_ADDED,
        entityType: AuditEntity.COMMENT,
        entityId: String(comment._id),
        entityLabel: ticket.number,
        summary: `Added ${input.visibility === CommentVisibility.INTERNAL ? 'an internal note' : 'a public reply'} to ${ticket.number}`,
    }, actor);
    /* The author is the caller, so the reference is built from the actor rather than
     * fetched back out of the database. */
    return toTicketCommentDto({
        ...comment.toObject(),
        authorId: {
            _id: toObjectId(actor.user.id),
            name: actor.user.name,
            email: actor.user.email,
            role: actor.user.role,
        },
    }, attachments);
}
/**
 * Oldest first — a conversation reads top to bottom, and the SLA's first response is
 * the interesting row near the start rather than the end.
 *
 * The scoped ticket load happens first, so someone probing comment endpoints with
 * another person's ticket id gets the same 404 they would get from the ticket itself.
 */
export async function listComments(id, query, actor) {
    await loadScoped(id, actor);
    const { page, limit, skip } = resolvePaging(query);
    const filter = {
        ticketId: toObjectId(id),
        ...(isStaff(actor) ? {} : { visibility: CommentVisibility.PUBLIC }),
    };
    const [rows, total] = await Promise.all([
        TicketComment.find(filter)
            .sort({ createdAt: 1, _id: 1 })
            .skip(skip)
            .limit(limit)
            .populate({ path: 'authorId', select: 'name email role' }),
        TicketComment.countDocuments(filter),
    ]);
    /* One query for every attachment on the page, grouped in memory — rather than one
     * query per comment, which is the same work done twenty times. */
    const files = await Attachment.find({ commentId: { $in: rows.map((row) => row._id) } })
        .sort({ createdAt: 1 })
        .populate({ path: 'uploadedById', select: 'name email role' });
    const byComment = new Map();
    for (const file of files) {
        const key = String(file.commentId);
        const bucket = byComment.get(key);
        if (bucket)
            bucket.push(toAttachmentDto(file));
        else
            byComment.set(key, [toAttachmentDto(file)]);
    }
    return toPaginated(rows.map((row) => toTicketCommentDto(row, byComment.get(String(row._id)) ?? [])), page, limit, total);
}
