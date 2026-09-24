/**
 * ServiceDesk Pro — tickets. The centre of the application.
 *
 * ## Human-readable numbers
 *
 * `number` is `TKT-000001`, generated from an atomic counter (`nextSequence`).
 * `_id` is a 24-character hex string nobody can read over the phone; a support
 * desk needs a number a person can say out loud, so both exist and the short one
 * is what appears in the UI.
 *
 * ## SLA: persist the inputs, cache the projection
 *
 * Two kinds of field live under `sla`:
 *
 *  - **Inputs**, written once when the deadline is computed: `budgetMinutes` and
 *    `dueAt` for each target, plus the policy name as it was at the time. These
 *    are facts. Editing the policy tomorrow must not silently move yesterday's
 *    deadline, because a technician was told a time and that promise was real.
 *  - **A cached projection**: `state`. It is derivable at any moment from `dueAt`
 *    and the current clock, and it is stored anyway — because "show me every
 *    breached ticket" has to be an index scan, and a value computed in Node
 *    cannot be indexed. The SLA monitor refreshes it.
 *
 * The rule that makes the cache safe: **a stale projection may only ever be
 * conservative.** The monitor moves ON_TRACK → AT_RISK → BREACHED as time
 * passes, and nothing moves a target back to ON_TRACK. So a ticket that has not
 * been swept yet may under-report its urgency for at most one sweep interval; it
 * can never claim to be healthy after being breached. The per-request read
 * recomputes `remainingMs` from `dueAt` regardless, so the countdown the user
 * sees is always exact.
 *
 * ## Status history is embedded
 *
 * The timeline is read on every ticket page, always in full, always with its
 * ticket, and never queried across tickets. That is the textbook case for
 * embedding. It also means the timeline cannot be lost independently of the
 * ticket it describes — unlike the audit log, which is a separate collection
 * because it is queried by actor and action across every entity.
 */
import { Schema } from 'mongoose';
import { Priority, PRIORITIES, PRIORITY_RANK, SlaState, SLA_STATES, TicketStatus, TICKET_STATUSES, } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, enumField, ref, requiredRef, versioned, } from '@/models/helpers';
/** Sequence name for `nextSequence()`. Kept here so only this module knows it. */
export const TICKET_SEQUENCE = 'ticket';
export const TICKET_NUMBER_PREFIX = 'TKT';
const statusChangeSchema = new Schema({
    from: enumField(TICKET_STATUSES, { default: null }),
    to: enumField(TICKET_STATUSES, { required: true }),
    at: { type: Date, required: true },
    byUserId: ref('User', { index: false }),
    note: { type: String, default: null, maxlength: 1000 },
}, { _id: false });
const slaTargetSchema = new Schema({
    startedAt: { type: Date, default: null },
    budgetMinutes: { type: Number, required: true, min: 0 },
    dueAt: { type: Date, default: null },
    metAt: { type: Date, default: null },
    state: enumField(SLA_STATES, { required: true, default: SlaState.ON_TRACK }),
}, { _id: false });
const ticketSchema = new Schema({
    number: { type: String, required: true, maxlength: 20, index: false },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 10_000 },
    status: enumField(TICKET_STATUSES, { required: true, default: TicketStatus.OPEN }),
    priority: enumField(PRIORITIES, { required: true, default: Priority.MEDIUM }),
    priorityRank: { type: Number, required: true, default: PRIORITY_RANK[Priority.MEDIUM], min: 1 },
    categoryId: requiredRef('Category', { index: false }),
    requesterId: requiredRef('User', { index: false }),
    assigneeId: ref('User', { index: false }),
    assetId: ref('Asset', { index: false }),
    statusHistory: { type: [statusChangeSchema], default: [] },
    sla: {
        policyName: { type: String, required: true, default: 'Standard support policy' },
        response: { type: slaTargetSchema, required: true },
        resolution: { type: slaTargetSchema, required: true },
    },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null, maxlength: 5000 },
    reopenCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    attachmentCount: { type: Number, default: 0, min: 0 },
}, BASE_SCHEMA_OPTIONS);
versioned(ticketSchema);
/** Derived, never authored. See `priorityRank` on `TicketDoc`. */
ticketSchema.pre('validate', function syncPriorityRank(next) {
    this.priorityRank = PRIORITY_RANK[this.priority] ?? PRIORITY_RANK[Priority.MEDIUM];
    next();
});
/* ─────────────────────────────── indexes ────────────────────────────────── */
/** Lookup by the number a user quotes. */
ticketSchema.index({ number: 1 }, { unique: true });
/** "My tickets", newest first — the employee's home page. */
ticketSchema.index({ requesterId: 1, createdAt: -1 });
/**
 * The technician queue. `status` first because it is always filtered, then
 * priority and deadline: this single index serves "open tickets, most urgent
 * first" and "open tickets closest to breaching" without a sort in memory.
 */
ticketSchema.index({ status: 1, priorityRank: -1, 'sla.resolution.dueAt': 1 });
/** "Assigned to me", the technician's own list. */
ticketSchema.index({ assigneeId: 1, status: 1, 'sla.resolution.dueAt': 1 });
/**
 * The SLA monitor's sweep: find tickets whose cached state is still optimistic
 * and whose deadline is close or past. Partial, because resolved and closed
 * tickets are the majority and none of them can breach — excluding them keeps
 * the index small and the sweep proportional to the live queue rather than to
 * the whole history.
 */
ticketSchema.index({ 'sla.resolution.state': 1, 'sla.resolution.dueAt': 1 }, {
    name: 'sla_sweep',
    partialFilterExpression: {
        'sla.resolution.state': { $in: [SlaState.ON_TRACK, SlaState.AT_RISK] },
    },
});
/** Dashboard aggregations: volume over time, counts by category. */
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ categoryId: 1, createdAt: -1 });
/** Tickets raised about one asset. Sparse — most tickets name no asset. */
ticketSchema.index({ assetId: 1, createdAt: -1 }, { sparse: true });
/**
 * Full-text search. Weighted so a match in the title outranks the same word
 * buried in a long description, and the number is weighted highest because
 * searching "TKT-000042" should return exactly one thing.
 */
ticketSchema.index({ number: 'text', title: 'text', description: 'text' }, { name: 'ticket_search', weights: { number: 20, title: 10, description: 2 } });
export const Ticket = defineModel('Ticket', ticketSchema);
