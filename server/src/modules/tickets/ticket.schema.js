/**
 * ServiceDesk Pro — ticket request schemas.
 *
 * Three decisions here are deliberate and worth reading before changing:
 *
 *  - **`status`, `requesterId` and every SLA field are absent from the write
 *    schemas.** A ticket's status changes only through `PATCH /:id/status`, which
 *    consults the transition table; the requester is always the authenticated user;
 *    deadlines are computed by the SLA engine. Zod strips unknown keys, so a client
 *    that posts `{ status: 'CLOSED', requesterId: '…' }` has those keys removed
 *    before the service ever runs — a stronger guarantee than remembering to ignore
 *    them.
 *  - **`version` is required on every mutation.** Two technicians working the same
 *    ticket is the normal case, not the edge case, and a lost update there means a
 *    resolution note that vanished. The client sends back the `version` it rendered
 *    and gets a 409 with the current one if it is stale.
 *  - **`assigneeId` and `assetId` are nullable, not optional.** `null` means "clear
 *    this", absent means "leave it alone". Collapsing the two would make it
 *    impossible to return a ticket to the unassigned queue.
 */
import { z } from 'zod';
import { CommentVisibility, PRIORITIES, Priority, TICKET_STATUSES, TicketStatus, } from '@shared/enums';
import { objectIdField, queryBoolean, queryDate, queryEnumList, queryLimit, queryPage, querySearch, querySortOrder, textField, } from '@/utils/zod';
const titleField = textField(5, 200, 'Give the ticket a title of at least 5 characters.');
const descriptionField = textField(10, 10_000, 'Describe the problem in at least 10 characters.');
/* `nativeEnum` reads the `as const` object directly, so the members stay in one place. */
const priorityField = z.nativeEnum(Priority);
const versionField = z.coerce.number().int().min(0);
/** `null` clears the link; omitted leaves it unchanged. See the header. */
const optionalRef = objectIdField.nullable().optional();
export const createTicketSchema = {
    body: z.object({
        title: titleField,
        description: descriptionField,
        categoryId: objectIdField,
        priority: priorityField.optional(),
        assetId: optionalRef,
    }),
};
/**
 * Every field optional except `version`, and `.refine` insists on at least one real
 * change: a PATCH carrying nothing but a version would otherwise "succeed", bump the
 * version and confuse anyone else editing.
 */
export const updateTicketSchema = {
    params: z.object({ id: objectIdField }),
    body: z
        .object({
        title: titleField.optional(),
        description: descriptionField.optional(),
        categoryId: objectIdField.optional(),
        priority: priorityField.optional(),
        assetId: optionalRef,
        version: versionField,
    })
        .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
        message: 'Nothing to update.',
    }),
};
/**
 * `resolutionNote` is required by the *service* when moving to RESOLVED rather than
 * by this schema, because the requirement depends on the target status. Enforcing it
 * here would mean either a cross-field refine that fires on every other transition
 * or a second schema; the service already has the ticket loaded and can say so
 * precisely.
 */
export const changeStatusSchema = {
    params: z.object({ id: objectIdField }),
    body: z.object({
        status: z.nativeEnum(TicketStatus),
        note: textField(1, 1000).optional(),
        resolutionNote: textField(1, 5000).optional(),
        version: versionField,
    }),
};
export const assignTicketSchema = {
    params: z.object({ id: objectIdField }),
    body: z.object({
        /** Explicitly nullable: `null` returns the ticket to the unassigned queue. */
        assigneeId: objectIdField.nullable(),
        version: versionField,
    }),
};
export const addCommentSchema = {
    params: z.object({ id: objectIdField }),
    body: z.object({
        body: textField(1, 20_000, 'Write something before posting.'),
        /**
         * Defaulted to PUBLIC on purpose. If this defaulted to INTERNAL a technician's
         * reply would silently never reach the person waiting for it; if a client omits
         * the field the safe failure is a visible comment, not an invisible one. The
         * right to post INTERNAL at all is checked in the service.
         */
        visibility: z.nativeEnum(CommentVisibility).default(CommentVisibility.PUBLIC),
    }),
};
/**
 * The list filter. `scope` exists so the client can ask for "mine" without knowing
 * its own user id, and so the *server* decides what "mine" means for the caller's
 * role — an employee's "mine" is the tickets they raised, a technician's is the ones
 * assigned to them.
 *
 * Note what these filters cannot do: widen access. `requesterId=<someone else>` is
 * accepted and then intersected with the caller's scope in the service, so an
 * employee filtering by another user's id gets an empty list, not a leak.
 */
export const listTicketsSchema = {
    query: z.object({
        q: querySearch,
        status: queryEnumList(TICKET_STATUSES),
        priority: queryEnumList(PRIORITIES),
        categoryId: objectIdField.optional(),
        assigneeId: objectIdField.optional(),
        requesterId: objectIdField.optional(),
        assetId: objectIdField.optional(),
        scope: z.enum(['all', 'mine', 'unassigned', 'created']).default('all'),
        breached: queryBoolean,
        createdFrom: queryDate,
        createdTo: queryDate,
        sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'dueAt', 'number']).default('createdAt'),
        sortOrder: querySortOrder,
        page: queryPage,
        limit: queryLimit,
    }),
};
export const ticketIdSchema = { params: z.object({ id: objectIdField }) };
/**
 * Reopening takes no target status — the route *is* the intent. `note` is where the
 * requester says why it is not fixed, which is the whole value of the action.
 */
export const reopenTicketSchema = {
    params: z.object({ id: objectIdField }),
    body: z.object({
        note: textField(1, 1000, 'Say what is still wrong.').optional(),
        version: versionField,
    }),
};
export const listCommentsSchema = {
    params: z.object({ id: objectIdField }),
    query: z.object({ page: queryPage, limit: queryLimit }),
};
