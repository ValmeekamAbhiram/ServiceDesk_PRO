/**
 * ServiceDesk Pro — actor context.
 *
 * Services never receive an Express `Request`. They receive an `ActorContext`:
 * the authenticated user, the request id for log correlation, and the clock to
 * read "now" from. Three consequences that matter:
 *
 *  - A service is callable from an HTTP handler, a Socket.IO handler, the SLA
 *    monitor and the seeder with no adaptation.
 *  - Authorization decisions are made from `actor.user`, which is rebuilt from
 *    the database on every request — never from anything the client sent.
 *  - Time-dependent logic reads `actor.clock`, so the Time Machine and the test
 *    suite reach every layer without a single `Date.now()` call in a service.
 *
 * Pure module: types plus small helpers. No Express, no Mongoose, no config.
 */
import { Role, UserStatus } from '@shared/enums';
import { hasAllPermissions, hasAnyPermission, isStaffRole } from '@/core/authz/permissions';
/* ─────────────────────────────── system actor ──────────────────────────────
 * Background work — the SLA monitor marking a ticket breached, the seeder — still
 * has to write audit entries and pass the same service-layer checks as a person.
 * Rather than thread `user: AuthenticatedUser | null` through every signature,
 * jobs build a synthetic actor with `automated: true`.
 *
 * This actor is deliberately unrestricted: the SLA monitor must see every ticket.
 * That is safe only because it is constructed here, in-process, by code paths no
 * HTTP route can reach — there is no password, no session and no token that
 * resolves to it, and `SYSTEM_ACTOR_ID` is an ObjectId no document can have.
 * ------------------------------------------------------------------------- */
/** Well-formed but unassignable, so audit rows stay valid without a real user. */
export const SYSTEM_ACTOR_ID = '000000000000000000000000';
export const SYSTEM_ACTOR_NAME = 'ServiceDesk Automation';
export function systemUser(permissions) {
    return {
        id: SYSTEM_ACTOR_ID,
        name: SYSTEM_ACTOR_NAME,
        email: 'automation@servicedesk.local',
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        permissions,
        sessionId: null,
    };
}
export function isSystemActor(actor) {
    return actor.user.id === SYSTEM_ACTOR_ID;
}
/** Label for audit trails and activity feeds: "Priya Nair", or "System". */
export function actorLabel(actor) {
    return isSystemActor(actor) ? 'System' : actor.user.name;
}
/* ──────────────────────────────── predicates ──────────────────────────────
 * Thin wrappers, so a service reads as `can(actor, Permission.TICKET_ASSIGN)`
 * rather than reaching into `actor.user.permissions` by hand. Convenience only —
 * the enforcement points are `requirePermission()` and the service-level scope
 * filters, not these helpers.
 * ------------------------------------------------------------------------- */
/** True when the actor holds **any** of the listed permissions. */
export function can(actor, ...permissions) {
    return hasAnyPermission(actor.user.permissions, permissions);
}
/** True when the actor holds **every** listed permission. */
export function canAll(actor, ...permissions) {
    return hasAllPermissions(actor.user.permissions, permissions);
}
/** ADMIN or TECHNICIAN — i.e. not an employee. Gates internal notes and staff views. */
export function isStaff(actor) {
    return isStaffRole(actor.user.role);
}
export function isSelf(actor, userId) {
    return actor.user.id === userId;
}
