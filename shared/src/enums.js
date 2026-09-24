/**
 * ServiceDesk Pro — shared enums and domain constants.
 *
 * Single source of truth for both `server/` and `client/`. A status string that
 * exists here and nowhere else cannot drift between the API and the UI.
 *
 * TypeScript's `enum` is deliberately not used. `as const` objects give the same
 * ergonomics (`Role.ADMIN`), work identically at runtime as plain strings in
 * MongoDB and JSON, and — unlike `enum` — can be iterated with `Object.values()`
 * to build Mongoose validators and dropdown options from the same declaration.
 * Each block therefore comes as a trio: the object, the derived union type, and
 * a frozen array.
 */
/* ────────────────────────────── Identity ─────────────────────────────────── */
/**
 * Three roles, not a hierarchy.
 *
 *  - `EMPLOYEE`   raises tickets, sees their own, reads published articles.
 *  - `TECHNICIAN` works the queue: sees every ticket, assigns, resolves.
 *  - `ADMIN`      everything a technician can do, plus users, categories,
 *                 SLA policy, assets and the audit log.
 *
 * Scoping stays this simple on purpose: "employee sees their own, staff see all"
 * is one line in a query filter, and one line is a rule that cannot be got
 * wrong. Departments and manager hierarchies were cut for the same reason.
 */
export const Role = {
    ADMIN: 'ADMIN',
    TECHNICIAN: 'TECHNICIAN',
    EMPLOYEE: 'EMPLOYEE',
};
export const ROLES = Object.values(Role);
/** Roles that work the queue, as opposed to raising tickets. */
export const STAFF_ROLES = [Role.ADMIN, Role.TECHNICIAN];
export const UserStatus = {
    ACTIVE: 'ACTIVE',
    /** Deactivated rather than deleted, so their tickets keep an author. */
    INACTIVE: 'INACTIVE',
};
export const USER_STATUSES = Object.values(UserStatus);
/* ─────────────────────────────── Tickets ────────────────────────────────── */
export const TicketStatus = {
    /** Created, not yet picked up. The SLA response clock is running. */
    OPEN: 'OPEN',
    /** A technician is actively working it. */
    IN_PROGRESS: 'IN_PROGRESS',
    /** Waiting on the requester or a third party. */
    ON_HOLD: 'ON_HOLD',
    /** A fix has been applied; the requester can still reopen. */
    RESOLVED: 'RESOLVED',
    /** Final. */
    CLOSED: 'CLOSED',
    /** Was resolved, came back. Kept distinct from OPEN so "reopen rate" is real. */
    REOPENED: 'REOPENED',
};
export const TICKET_STATUSES = Object.values(TicketStatus);
/** No SLA clock runs in these; nothing is overdue once it is done. */
export const TERMINAL_TICKET_STATUSES = [
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
];
/** The queue: what a technician sees as outstanding work. */
export const OPEN_TICKET_STATUSES = [
    TicketStatus.OPEN,
    TicketStatus.IN_PROGRESS,
    TicketStatus.ON_HOLD,
    TicketStatus.REOPENED,
];
/**
 * Legal status moves, enforced on the server.
 *
 * A transition table rather than scattered `if` checks: the whole lifecycle is
 * readable in one place, the API can hand the UI the list of buttons to show,
 * and "CLOSED → IN_PROGRESS" is impossible rather than merely unlikely.
 */
export const TICKET_TRANSITIONS = {
    [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS, TicketStatus.ON_HOLD, TicketStatus.RESOLVED],
    [TicketStatus.IN_PROGRESS]: [TicketStatus.ON_HOLD, TicketStatus.RESOLVED, TicketStatus.OPEN],
    [TicketStatus.ON_HOLD]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.OPEN],
    [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.REOPENED],
    [TicketStatus.CLOSED]: [TicketStatus.REOPENED],
    [TicketStatus.REOPENED]: [TicketStatus.IN_PROGRESS, TicketStatus.ON_HOLD, TicketStatus.RESOLVED],
};
export function canTransition(from, to) {
    return TICKET_TRANSITIONS[from].includes(to);
}
export const Priority = {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    URGENT: 'URGENT',
};
export const PRIORITIES = Object.values(Priority);
/** Higher is more urgent — used to sort the queue and to compare two priorities. */
export const PRIORITY_RANK = {
    [Priority.LOW]: 1,
    [Priority.MEDIUM]: 2,
    [Priority.HIGH]: 3,
    [Priority.URGENT]: 4,
};
export const CommentVisibility = {
    /** Visible to the requester. */
    PUBLIC: 'PUBLIC',
    /** Staff only — technician notes the requester must not see. */
    INTERNAL: 'INTERNAL',
};
export const COMMENT_VISIBILITIES = Object.values(CommentVisibility);
/* ───────────────────────────────── SLA ──────────────────────────────────── */
/*
 * There is no `SlaTarget` enum. Every shape that carries the two clocks — the ticket
 * subdocument, the engine's snapshot, the DTO — names them as sibling fields,
 * `response` and `resolution`, so nothing ever selects a target by value. An enum
 * alongside those fields would be a second way to say the same thing, and the two
 * would eventually disagree.
 */
export const SlaState = {
    /** Comfortably inside the deadline. */
    ON_TRACK: 'ON_TRACK',
    /** Past the warning threshold (default 75% of the budget consumed). */
    AT_RISK: 'AT_RISK',
    /** The deadline passed without the target being hit. */
    BREACHED: 'BREACHED',
    /** Hit in time. Terminal and good. */
    MET: 'MET',
};
export const SLA_STATES = Object.values(SlaState);
/** Once a target is met or breached, the verdict never changes again. */
export const TERMINAL_SLA_STATES = [SlaState.MET, SlaState.BREACHED];
/* ──────────────────────────────── Assets ────────────────────────────────── */
export const AssetType = {
    LAPTOP: 'LAPTOP',
    DESKTOP: 'DESKTOP',
    MONITOR: 'MONITOR',
    PRINTER: 'PRINTER',
    PHONE: 'PHONE',
    NETWORK: 'NETWORK',
    SERVER: 'SERVER',
    OTHER: 'OTHER',
};
export const ASSET_TYPES = Object.values(AssetType);
export const AssetStatus = {
    /** Assigned to someone and working. */
    IN_USE: 'IN_USE',
    /** On the shelf, ready to hand out. */
    IN_STOCK: 'IN_STOCK',
    /** Broken or with a vendor. */
    IN_REPAIR: 'IN_REPAIR',
    /** End of life. Kept for the history, excluded from counts. */
    RETIRED: 'RETIRED',
};
export const ASSET_STATUSES = Object.values(AssetStatus);
/* ────────────────────────────── Knowledge ───────────────────────────────── */
export const ArticleStatus = {
    /** Being written. Author and admins only. */
    DRAFT: 'DRAFT',
    /** Visible to everyone. */
    PUBLISHED: 'PUBLISHED',
};
export const ARTICLE_STATUSES = Object.values(ArticleStatus);
/* ───────────────────────── Notifications & auditing ─────────────────────── */
export const NotificationType = {
    TICKET_ASSIGNED: 'TICKET_ASSIGNED',
    TICKET_COMMENTED: 'TICKET_COMMENTED',
    TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
    SLA_AT_RISK: 'SLA_AT_RISK',
    SLA_BREACHED: 'SLA_BREACHED',
};
export const NOTIFICATION_TYPES = Object.values(NotificationType);
export const AuditAction = {
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    TICKET_CREATED: 'TICKET_CREATED',
    TICKET_UPDATED: 'TICKET_UPDATED',
    TICKET_ASSIGNED: 'TICKET_ASSIGNED',
    TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
    COMMENT_ADDED: 'COMMENT_ADDED',
    ASSET_CREATED: 'ASSET_CREATED',
    ASSET_UPDATED: 'ASSET_UPDATED',
    ARTICLE_CREATED: 'ARTICLE_CREATED',
    ARTICLE_UPDATED: 'ARTICLE_UPDATED',
    ARTICLE_PUBLISHED: 'ARTICLE_PUBLISHED',
    USER_CREATED: 'USER_CREATED',
    USER_UPDATED: 'USER_UPDATED',
    ROLE_CHANGED: 'ROLE_CHANGED',
    PASSWORD_RESET: 'PASSWORD_RESET',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    DEMO_CLOCK_CHANGED: 'DEMO_CLOCK_CHANGED',
};
export const AUDIT_ACTIONS = Object.values(AuditAction);
export const AuditEntity = {
    USER: 'USER',
    TICKET: 'TICKET',
    COMMENT: 'COMMENT',
    ASSET: 'ASSET',
    ARTICLE: 'ARTICLE',
    CATEGORY: 'CATEGORY',
    SLA_POLICY: 'SLA_POLICY',
    SETTINGS: 'SETTINGS',
};
export const AUDIT_ENTITIES = Object.values(AuditEntity);
/* ─────────────────────────── Permissions (RBAC) ─────────────────────────── */
/**
 * Routes ask for a capability, never for a job title.
 *
 * `requirePermission('ticket:assign')` keeps the route readable and means the
 * mapping below is the only place that has to change when a role's remit does.
 * The naming is `<resource>:<verb>` throughout.
 *
 * Every permission here is checked by at least one route or service. There is no
 * `ticket:resolve`, because resolving is a status change and `PATCH /:id/status`
 * already demands `ticket:update`: a permission that grants nothing reads like a
 * control, and someone eventually tries to withhold it.
 */
export const Permission = {
    TICKET_CREATE: 'ticket:create',
    TICKET_READ_OWN: 'ticket:read:own',
    TICKET_READ_ALL: 'ticket:read:all',
    TICKET_UPDATE: 'ticket:update',
    TICKET_ASSIGN: 'ticket:assign',
    TICKET_COMMENT_INTERNAL: 'ticket:comment:internal',
    ASSET_READ: 'asset:read',
    ASSET_MANAGE: 'asset:manage',
    ARTICLE_READ: 'article:read',
    ARTICLE_WRITE: 'article:write',
    ARTICLE_PUBLISH: 'article:publish',
    ANALYTICS_VIEW: 'analytics:view',
    USER_READ: 'user:read',
    USER_MANAGE: 'user:manage',
    SETTINGS_MANAGE: 'settings:manage',
    AUDIT_READ: 'audit:read',
    DEMO_CONTROL: 'demo:control',
};
export const PERMISSIONS = Object.values(Permission);
const EMPLOYEE_PERMISSIONS = [
    Permission.TICKET_CREATE,
    Permission.TICKET_READ_OWN,
    Permission.ARTICLE_READ,
    Permission.ASSET_READ,
];
const TECHNICIAN_PERMISSIONS = [
    ...EMPLOYEE_PERMISSIONS,
    Permission.TICKET_READ_ALL,
    Permission.TICKET_UPDATE,
    Permission.TICKET_ASSIGN,
    Permission.TICKET_COMMENT_INTERNAL,
    Permission.ARTICLE_WRITE,
    Permission.ANALYTICS_VIEW,
    Permission.USER_READ,
];
/**
 * ADMIN is granted every permission explicitly, by spreading `PERMISSIONS`,
 * rather than being special-cased in the authorization middleware. A
 * "role X bypasses all checks" branch is the one branch that never gets tested,
 * and it makes the permission list stop describing who can do what.
 */
export const ROLE_PERMISSIONS = {
    [Role.EMPLOYEE]: EMPLOYEE_PERMISSIONS,
    [Role.TECHNICIAN]: TECHNICIAN_PERMISSIONS,
    [Role.ADMIN]: [...PERMISSIONS],
};
/* ───────────────────────── Errors & misc contracts ──────────────────────── */
/**
 * Stable machine-readable error codes. The client switches on these; the
 * human-readable `message` beside them may be reworded freely without breaking
 * anything.
 */
export const ErrorCode = {
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    VERSION_CONFLICT: 'VERSION_CONFLICT',
    INVALID_TRANSITION: 'INVALID_TRANSITION',
    RATE_LIMITED: 'RATE_LIMITED',
    UPLOAD_REJECTED: 'UPLOAD_REJECTED',
    DEMO_DISABLED: 'DEMO_DISABLED',
    INTERNAL: 'INTERNAL',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};
/** Real time, or the demo clock the Time Machine drives. */
export const ClockMode = {
    REAL: 'REAL',
    DEMO: 'DEMO',
};
export const CLOCK_MODES = Object.values(ClockMode);
