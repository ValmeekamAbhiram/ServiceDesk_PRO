/**
 * ServiceDesk Pro — user → DTO mapping.
 *
 * Three shapes, because three things need a user and they need different amounts
 * of it:
 *
 *  - `UserRefDto` — the stub embedded in a ticket row. Name, email, role, nothing
 *    else. A ticket list of 25 rows carries 50 of these, so it stays small.
 *  - `UserDto` — the admin's user table.
 *  - `CurrentUserDto` — the signed-in user's view of themselves, including the
 *    resolved permission list the client uses to decide which buttons to render.
 *
 * Mapping lives here rather than in a service because it is the boundary where a
 * Mongoose document stops and the wire contract starts. Two rules hold at that
 * boundary, and they are the reason this file is deliberately dull:
 *
 *  - **Nothing is spread.** Every field is named. A `select: false` slip that
 *    loaded `passwordHash` cannot leak through a mapper that never copies unknown
 *    keys, and adding a field to the schema does not silently add it to the API.
 *  - **Dates become ISO strings.** `Date` objects serialise differently depending
 *    on how they reach `res.json`, so they are converted exactly once, here.
 */
import { permissionList } from '@/core/authz/permissions';
export function toUserRefDto(user) {
    return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
    };
}
/**
 * `populate()` yields `null` for a reference whose target was deleted, and an
 * unpopulated `ObjectId` if a query forgot to populate it. Both become `null`
 * rather than a half-rendered row or a crash, so a ticket whose requester was
 * removed still lists.
 */
export function toUserRefDtoOrNull(user) {
    if (!user || typeof user !== 'object' || !('name' in user))
        return null;
    return toUserRefDto(user);
}
export function toUserDto(user) {
    return {
        ...toUserRefDto(user),
        status: user.status,
        jobTitle: user.jobTitle,
        phone: user.phone,
        openTicketCount: user.openTicketCount,
        assignedTicketCount: user.assignedTicketCount,
        createdAt: user.createdAt.toISOString(),
    };
}
/**
 * The signed-in user's own record. `permissions` is resolved from the role by the
 * server and sent for rendering only — every action it unlocks is checked again on
 * the server, because a permission list in a browser is a hint, not a guarantee.
 */
export function toCurrentUserDto(user, permissions) {
    return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        jobTitle: user.jobTitle,
        phone: user.phone,
        permissions: permissionList(permissions),
        createdAt: user.createdAt.toISOString(),
    };
}
