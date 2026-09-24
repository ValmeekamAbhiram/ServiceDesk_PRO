/**
 * ServiceDesk Pro — the audit trail.
 *
 * Who did what, to which record, and what the values were before and after. It exists
 * for the question nobody can answer from the tickets themselves: *why is this ticket
 * assigned to me and marked URGENT when I never touched it?*
 *
 * ## Two rules the rest of the codebase depends on
 *
 * **Recording never fails the caller.** A ticket that was genuinely created must not
 * answer 500 because the trail row could not be written. `record()` therefore swallows
 * its own errors — but at `error` level, not `warn`, because a trail with holes in it is
 * a real problem even when nothing visible broke. The alternative, failing the write,
 * trades a rare logging fault for a certain user-facing one, which is the worse deal
 * at this scale. A regulated deployment would invert that and fail closed.
 *
 * **Nothing here can rewrite history.** The model's pre-hooks make `updateOne`,
 * `findOneAndUpdate` and every delete throw, so this service has no update path to
 * offer and the read below is the only other operation. That is the whole reason the
 * enforcement lives in the schema rather than here: a future service cannot forget it.
 *
 * ## What is deliberately not recorded
 *
 * Passwords, hashes and tokens. `diff()` drops any field whose name looks like a
 * secret, so a caller that passes a whole document by accident cannot leak one into a
 * collection built to be read by administrators. A password change is an *event* —
 * `PASSWORD_RESET` with no values attached.
 */
import { Role } from '@shared/enums';
import { moduleLogger } from '@/config/logger';
import { isSystemActor } from '@/core/actor';
import { AuditLog } from '@/models';
import { toObjectId } from '@/models/helpers';
import { resolvePaging, toPaginated } from '@/utils/respond';
const log = moduleLogger('audit');
/** Field names whose values must never reach the trail. Matched case-insensitively. */
const SECRET_FIELD = /pass|hash|token|secret|otp/i;
/**
 * The changed fields between two states of a record, ready for `record()`.
 *
 * Only the keys listed are considered, so passing a Mongoose document does not dump
 * fifty internal fields into the trail — the caller names what it means to describe.
 * A key whose value did not actually change is dropped, because "updated title from
 * X to X" is noise that hides the one line that mattered.
 */
export function diff(before, after, fields) {
    const changes = [];
    for (const field of fields) {
        if (SECRET_FIELD.test(field))
            continue;
        const from = normalize(before[field]);
        const to = normalize(after[field]);
        if (from === to)
            continue;
        changes.push({ field, from, to });
    }
    return changes;
}
/**
 * Values go into a `Mixed` field and come back out as JSON, so an ObjectId or a Date
 * that survived as an object would render as `{}` in the admin table. Comparing the
 * normalised forms is also what makes "the same id, one hydrated and one not" count as
 * unchanged rather than as an edit.
 */
function normalize(value) {
    if (value === undefined || value === null)
        return null;
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return String(value);
}
/* ─────────────────────────────── writing ───────────────────────────────── */
/**
 * Append one entry. Fire-and-forget from the caller's point of view: awaited so the
 * row is on disk before the response goes out, but incapable of throwing.
 *
 * The actor is copied in rather than referenced — see the model header. `actorId` is
 * null for the SLA monitor and the seeder, whose ids are not real users, and
 * `automated` records which of the two kinds of writer it was.
 */
export async function record(entry, actor) {
    try {
        const system = isSystemActor(actor);
        await AuditLog.create({
            actorId: system ? null : toObjectId(actor.user.id),
            actorName: actor.user.name,
            actorEmail: system ? null : actor.user.email,
            actorRole: actor.user.role,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId ? toObjectId(entry.entityId) : null,
            entityLabel: entry.entityLabel ?? null,
            summary: entry.summary,
            changes: entry.changes ?? [],
            ip: actor.ip,
            userAgent: actor.userAgent,
            requestId: actor.requestId,
            automated: actor.automated,
            /* `createdAt` comes from `timestamps: true`, i.e. the real system clock. That is
             * correct here and nowhere else: an audit entry records when something actually
             * happened, and a demo clock wound forward must not be able to backdate it. */
        });
    }
    catch (error) {
        log.error({ err: error, action: entry.action, entityId: entry.entityId }, 'Audit entry could not be written; the operation it describes still happened.');
    }
}
/** The same, for the several call sites that only need "X happened to Y". */
export async function recordEvent(action, entityType, summary, actor) {
    await record({ action, entityType, summary }, actor);
}
/* ─────────────────────────────── reading ───────────────────────────────── */
/**
 * One page of the trail, newest first.
 *
 * There is no scope filter here, unlike every other list in the application: the route
 * requires `audit:read`, which only an administrator holds, and an administrator who
 * can see every ticket gains nothing from a narrowed trail. The authorization is the
 * permission, and it is the whole of it — which is why this function takes no actor and
 * cannot be called from a route that forgot the guard without that being obvious.
 *
 * `to` is treated as an inclusive *day*: a filter of `2026-01-05` should return things
 * that happened at 23:50 that evening, and a naive `$lte` on a midnight boundary would
 * silently drop them.
 */
export async function list(query) {
    const { page, limit, skip } = resolvePaging(query);
    const filter = {};
    if (query.action)
        filter.action = query.action;
    if (query.entityType)
        filter.entityType = query.entityType;
    if (query.entityId)
        filter.entityId = toObjectId(query.entityId);
    if (query.actorId)
        filter.actorId = toObjectId(query.actorId);
    if (query.from || query.to) {
        filter.createdAt = {
            ...(query.from ? { $gte: query.from } : {}),
            ...(query.to ? { $lt: endOfDay(query.to) } : {}),
        };
    }
    const [rows, total] = await Promise.all([
        AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        AuditLog.countDocuments(filter),
    ]);
    return toPaginated(rows.map((row) => toAuditLogDto(row)), page, limit, total);
}
function endOfDay(date) {
    const day = new Date(date);
    day.setUTCHours(23, 59, 59, 999);
    return day;
}
/**
 * The wire shape. `changes` flips from the array the model stores to the keyed object
 * the DTO promises, because a table renders one row per field and looking a field up by
 * name beats scanning an array in the client.
 *
 * `actor` is rebuilt from the denormalised columns rather than populated, so an entry
 * about a user who has since been deleted still says who it was.
 */
export function toAuditLogDto(row) {
    const changes = row.changes.length === 0
        ? null
        : Object.fromEntries(row.changes.map((c) => [c.field, { from: c.from, to: c.to }]));
    return {
        id: row._id.toString(),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ? row.entityId.toString() : null,
        entityLabel: row.entityLabel,
        summary: row.summary,
        /* `actorRole` is a plain string in the model because the column is denormalised
         * evidence rather than a live reference — a role removed from the enum next year
         * must not make an old entry unreadable. Every row is written from `actor.user.role`,
         * so the cast is safe for anything this application wrote. */
        actor: row.actorId
            ? {
                id: row.actorId.toString(),
                name: row.actorName,
                email: row.actorEmail ?? '',
                role: (row.actorRole ?? Role.EMPLOYEE),
            }
            : null,
        actorName: row.actorName,
        automated: row.automated,
        changes,
        requestId: row.requestId,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
    };
}
