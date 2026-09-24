/**
 * ServiceDesk Pro — permission resolution (pure).
 *
 * A user's effective permission set is derived from their role, here and nowhere
 * else:
 *
 *     resolvePermissions(role) === new Set(ROLE_PERMISSIONS[role])
 *
 * Two properties matter for security:
 *
 *  - **The role is the only input.** There are no per-user grants or denials to
 *    get out of step with the role table, and therefore no way for a user
 *    record to hold a permission the role does not describe.
 *  - **This runs server-side only.** The client receives the resolved array in
 *    `CurrentUserDto.permissions` purely so it can hide buttons it would not be
 *    allowed to use. It is never an input: `middleware/authenticate.ts` recomputes
 *    the set from the database record on every request, so a tampered token or a
 *    stale client cannot widen it, and demoting a user takes effect on their very
 *    next request rather than when their token happens to expire.
 *
 * Pure module — no Express, no Mongoose, no config, so it is trivially testable.
 */
import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, } from '@shared/enums';
/** Stable ordering, so `permissions` arrays do not churn between responses. */
const PERMISSION_ORDER = new Map(PERMISSIONS.map((permission, index) => [permission, index]));
export function resolvePermissions(role) {
    return new Set(ROLE_PERMISSIONS[role] ?? []);
}
/** Deterministic array form, for DTOs and audit diffs. */
export function permissionList(permissions) {
    return Array.from(new Set(permissions)).sort((a, b) => (PERMISSION_ORDER.get(a) ?? 999) - (PERMISSION_ORDER.get(b) ?? 999));
}
/** True when the holder has **at least one** of `required` (OR semantics). */
export function hasAnyPermission(held, required) {
    if (required.length === 0)
        return true;
    return required.some((permission) => held.has(permission));
}
/** True when the holder has **every** one of `required` (AND semantics). */
export function hasAllPermissions(held, required) {
    return required.every((permission) => held.has(permission));
}
/** Roles that may see internal notes and staff-only views: ADMIN and TECHNICIAN. */
export function isStaffRole(role) {
    return STAFF_ROLES.includes(role);
}
