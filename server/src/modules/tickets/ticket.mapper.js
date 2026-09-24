/**
 * ServiceDesk Pro — ticket → DTO mapping.
 *
 * The same three rules as `user.mapper.ts`: nothing is spread, every field is
 * named, and dates become ISO strings exactly once. Two things are specific to
 * tickets and worth stating outright:
 *
 *  - **The SLA countdown is computed here, per response, from `dueAt`.** The state
 *    cached on the document is a floor, not the answer (see `ticket.model.ts`), so
 *    a ticket that has not been swept since it went overdue still reports BREACHED
 *    to the client. `remainingMs` is signed wall-clock milliseconds, so the browser
 *    can tick it down without asking again.
 *  - **`allowedTransitions` is sent with the detail view.** The client renders the
 *    status buttons from it rather than embedding a copy of the transition table,
 *    which is how a UI ends up offering a move the server will refuse.
 *
 * Reference fields arrive either as an `ObjectId` (unpopulated) or as a document
 * (populated). `populatedDoc()` tells them apart by looking for a field only the
 * document has, so a query that forgot a `populate()` renders `null` instead of
 * leaking a raw id into a name field.
 */
import { TICKET_TRANSITIONS } from '@shared/enums';
import { evaluateTicketSla } from '@/core/sla';
import { toUserRefDtoOrNull } from '@/modules/users/user.mapper';
import { populatedDoc } from '@/utils/populate';
/* ──────────────────────────────── references ────────────────────────────── */
export function toCategoryOption(value) {
    const category = populatedDoc(value, 'name');
    return category ? { id: String(category._id), label: category.name } : null;
}
export function toAssetRefDto(value) {
    const asset = populatedDoc(value, 'tag');
    if (!asset)
        return null;
    return {
        id: String(asset._id),
        tag: asset.tag,
        name: asset.name,
        type: asset.type,
        status: asset.status,
    };
}
/* ──────────────────────────────────── SLA ───────────────────────────────── */
function toSlaTargetDto(view) {
    return {
        state: view.state,
        dueAt: view.dueAt?.toISOString() ?? null,
        metAt: view.metAt?.toISOString() ?? null,
        remainingMs: view.remainingMs,
        percentUsed: view.percentUsed,
        budgetMinutes: view.budgetMinutes,
    };
}
export function toTicketSlaDto(ticket, ctx) {
    const view = evaluateTicketSla(ticket.sla, ctx.now, ctx.policy);
    return {
        policyName: view.policyName,
        response: toSlaTargetDto(view.response),
        resolution: toSlaTargetDto(view.resolution),
        breached: view.breached,
    };
}
/* ──────────────────────────── timeline & children ───────────────────────── */
/**
 * `by` is resolved from a map the service builds with one query for every actor in
 * the timeline, rather than a `populate()` per row — a long-running ticket can
 * easily have twenty status changes among four people.
 */
export function toStatusHistoryDto(history, actors) {
    return history.map((entry) => ({
        from: entry.from,
        to: entry.to,
        at: entry.at.toISOString(),
        by: entry.byUserId ? toUserRefDtoOrNull(actors.get(String(entry.byUserId))) : null,
        note: entry.note,
    }));
}
/**
 * `url` is a relative API path, not an absolute one. The download endpoint checks
 * the caller's access to the parent ticket on every request, so the link is safe to
 * embed in a page — and being relative means it keeps working behind whatever host
 * or proxy the app is deployed under.
 */
export function toAttachmentDto(attachment) {
    return {
        id: String(attachment._id),
        filename: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        url: `/api/attachments/${String(attachment._id)}`,
        uploadedBy: toUserRefDtoOrNull(populatedDoc(attachment.uploadedById, 'name')),
        uploadedAt: attachment.createdAt.toISOString(),
    };
}
export function toTicketCommentDto(comment, attachments = []) {
    return {
        id: String(comment._id),
        ticketId: String(comment.ticketId),
        author: toUserRefDtoOrNull(populatedDoc(comment.authorId, 'name')),
        authorLabel: comment.authorLabel,
        body: comment.body,
        edited: comment.edited,
        visibility: comment.visibility,
        isFirstResponse: comment.isFirstResponse,
        attachments,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
    };
}
/* ────────────────────────────── the two shapes ──────────────────────────── */
export function toTicketListItemDto(ticket, ctx) {
    return {
        id: String(ticket._id),
        number: ticket.number,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        category: toCategoryOption(ticket.categoryId),
        requester: toUserRefDtoOrNull(populatedDoc(ticket.requesterId, 'name')),
        assignee: toUserRefDtoOrNull(populatedDoc(ticket.assigneeId, 'name')),
        sla: toTicketSlaDto(ticket, ctx),
        commentCount: ticket.commentCount,
        attachmentCount: ticket.attachmentCount,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
    };
}
export function toTicketDto(ticket, ctx, extras) {
    return {
        ...toTicketListItemDto(ticket, ctx),
        description: ticket.description,
        asset: toAssetRefDto(ticket.assetId),
        attachments: extras.attachments,
        statusHistory: toStatusHistoryDto(ticket.statusHistory, extras.actors),
        resolutionNote: ticket.resolutionNote,
        resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
        closedAt: ticket.closedAt?.toISOString() ?? null,
        firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
        reopenCount: ticket.reopenCount,
        version: ticket.version,
        allowedTransitions: allowedTransitionsFor(ticket.status),
    };
}
/** Copied out of the table so the returned array cannot be mutated by a caller. */
export function allowedTransitionsFor(status) {
    return [...(TICKET_TRANSITIONS[status] ?? [])];
}
