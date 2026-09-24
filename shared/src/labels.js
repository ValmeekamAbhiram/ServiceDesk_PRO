/**
 * ServiceDesk Pro — display metadata.
 *
 * Human labels and semantic colour tokens for every enum, kept beside the enums
 * so a new status can never reach the screen as a raw `IN_PROGRESS`.
 *
 * `tone` values are design-system roles, not hex codes. The mapping from role to
 * actual colour lives once in `client/src/styles/index.css`, which is what makes
 * light and dark mode a single change rather than a hunt through components.
 */
export const TICKET_STATUS_META = {
    OPEN: {
        label: 'Open',
        tone: 'info',
        description: 'Raised and waiting to be picked up',
    },
    IN_PROGRESS: {
        label: 'In progress',
        tone: 'violet',
        short: 'WIP',
        description: 'A technician is working on it',
    },
    ON_HOLD: {
        label: 'On hold',
        tone: 'warning',
        short: 'Hold',
        description: 'Waiting on the requester or a supplier',
    },
    RESOLVED: {
        label: 'Resolved',
        tone: 'success',
        description: 'Fixed — the requester can still reopen it',
    },
    CLOSED: {
        label: 'Closed',
        tone: 'neutral',
        description: 'Finished and archived',
    },
    REOPENED: {
        label: 'Reopened',
        tone: 'danger',
        short: 'Reopen',
        description: 'Came back after being resolved',
    },
};
export const PRIORITY_META = {
    LOW: { label: 'Low', tone: 'neutral', description: 'Minor inconvenience, no deadline pressure' },
    MEDIUM: { label: 'Medium', tone: 'info', description: 'Normal day-to-day request' },
    HIGH: { label: 'High', tone: 'warning', description: 'Blocking one person’s work' },
    URGENT: { label: 'Urgent', tone: 'danger', description: 'Blocking a team, or business critical' },
};
export const SLA_STATE_META = {
    ON_TRACK: { label: 'On track', tone: 'success', description: 'Comfortably inside the deadline' },
    AT_RISK: { label: 'At risk', tone: 'warning', description: 'Most of the time budget is used' },
    BREACHED: { label: 'Breached', tone: 'danger', description: 'The deadline passed' },
    MET: { label: 'Met', tone: 'success', description: 'Hit in time' },
};
export const ROLE_META = {
    ADMIN: { label: 'Administrator', tone: 'danger', short: 'Admin', description: 'Full access, including users and settings' },
    TECHNICIAN: { label: 'Technician', tone: 'primary', short: 'Tech', description: 'Works the ticket queue' },
    EMPLOYEE: { label: 'Employee', tone: 'neutral', short: 'Emp', description: 'Raises tickets and reads articles' },
};
export const USER_STATUS_META = {
    ACTIVE: { label: 'Active', tone: 'success' },
    INACTIVE: { label: 'Inactive', tone: 'neutral', description: 'Cannot sign in; history preserved' },
};
export const ASSET_TYPE_META = {
    LAPTOP: { label: 'Laptop', tone: 'primary' },
    DESKTOP: { label: 'Desktop', tone: 'primary' },
    MONITOR: { label: 'Monitor', tone: 'info' },
    PRINTER: { label: 'Printer', tone: 'teal' },
    PHONE: { label: 'Phone', tone: 'violet' },
    NETWORK: { label: 'Network device', tone: 'info', short: 'Network' },
    SERVER: { label: 'Server', tone: 'danger' },
    OTHER: { label: 'Other', tone: 'neutral' },
};
export const ASSET_STATUS_META = {
    IN_USE: { label: 'In use', tone: 'success' },
    IN_STOCK: { label: 'In stock', tone: 'info' },
    IN_REPAIR: { label: 'In repair', tone: 'warning' },
    RETIRED: { label: 'Retired', tone: 'neutral' },
};
export const ARTICLE_STATUS_META = {
    DRAFT: { label: 'Draft', tone: 'warning', description: 'Not visible to employees yet' },
    PUBLISHED: { label: 'Published', tone: 'success', description: 'Visible to everyone' },
};
export const NOTIFICATION_TYPE_META = {
    TICKET_ASSIGNED: { label: 'Ticket assigned', tone: 'primary' },
    TICKET_COMMENTED: { label: 'New comment', tone: 'info' },
    TICKET_STATUS_CHANGED: { label: 'Status changed', tone: 'violet' },
    SLA_AT_RISK: { label: 'SLA at risk', tone: 'warning' },
    SLA_BREACHED: { label: 'SLA breached', tone: 'danger' },
};
/**
 * The audit trail's two enums.
 *
 * Every entry already carries a written `summary`, so these labels are for the filter
 * dropdowns and the narrow "Action" column — short, and toned so that the three that
 * matter to anyone reviewing privilege (`ROLE_CHANGED`, `PASSWORD_RESET`,
 * `SETTINGS_UPDATED`) do not read like a comment being posted.
 */
export const AUDIT_ACTION_META = {
    LOGIN: { label: 'Signed in', tone: 'neutral' },
    LOGOUT: { label: 'Signed out', tone: 'neutral' },
    TICKET_CREATED: { label: 'Ticket raised', tone: 'primary' },
    TICKET_UPDATED: { label: 'Ticket edited', tone: 'info' },
    TICKET_ASSIGNED: { label: 'Ticket assigned', tone: 'primary' },
    TICKET_STATUS_CHANGED: { label: 'Status changed', tone: 'violet' },
    COMMENT_ADDED: { label: 'Comment added', tone: 'neutral' },
    ASSET_CREATED: { label: 'Asset added', tone: 'teal' },
    ASSET_UPDATED: { label: 'Asset edited', tone: 'teal' },
    ARTICLE_CREATED: { label: 'Article drafted', tone: 'neutral' },
    ARTICLE_UPDATED: { label: 'Article edited', tone: 'info' },
    ARTICLE_PUBLISHED: { label: 'Article published', tone: 'success' },
    USER_CREATED: { label: 'User created', tone: 'primary' },
    USER_UPDATED: { label: 'User edited', tone: 'info' },
    ROLE_CHANGED: { label: 'Role changed', tone: 'warning' },
    PASSWORD_RESET: { label: 'Password reset', tone: 'warning' },
    SETTINGS_UPDATED: { label: 'Settings changed', tone: 'warning' },
    DEMO_CLOCK_CHANGED: { label: 'Clock moved', tone: 'danger' },
};
export const AUDIT_ENTITY_META = {
    USER: { label: 'User', tone: 'primary' },
    TICKET: { label: 'Ticket', tone: 'info' },
    COMMENT: { label: 'Comment', tone: 'neutral' },
    ASSET: { label: 'Asset', tone: 'teal' },
    ARTICLE: { label: 'Article', tone: 'violet' },
    CATEGORY: { label: 'Category', tone: 'neutral' },
    SLA_POLICY: { label: 'Service level', tone: 'warning' },
    SETTINGS: { label: 'Settings', tone: 'warning' },
};
/* ─────────────────────────────── accessors ──────────────────────────────── */
/**
 * Never index the maps directly in a component.
 *
 * These fall back to a readable label rather than crashing, so a value written
 * by an older version of the app degrades to "In Progress" instead of taking
 * the page down with it.
 */
function lookup(map, value) {
    if (!value)
        return { label: '—', tone: 'neutral' };
    return map[value] ?? { label: titleCase(value), tone: 'neutral' };
}
function titleCase(value) {
    return value
        .toLowerCase()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
export const ticketStatusMeta = (v) => lookup(TICKET_STATUS_META, v);
export const priorityMeta = (v) => lookup(PRIORITY_META, v);
export const slaStateMeta = (v) => lookup(SLA_STATE_META, v);
export const roleMeta = (v) => lookup(ROLE_META, v);
export const userStatusMeta = (v) => lookup(USER_STATUS_META, v);
export const assetTypeMeta = (v) => lookup(ASSET_TYPE_META, v);
export const assetStatusMeta = (v) => lookup(ASSET_STATUS_META, v);
export const articleStatusMeta = (v) => lookup(ARTICLE_STATUS_META, v);
export const notificationTypeMeta = (v) => lookup(NOTIFICATION_TYPE_META, v);
export const auditActionMeta = (v) => lookup(AUDIT_ACTION_META, v);
export const auditEntityMeta = (v) => lookup(AUDIT_ENTITY_META, v);
/** `[{ value, label }]` for a `<select>`, built from the enum so it cannot drift. */
export function optionsFrom(map) {
    return Object.keys(map).map((value) => ({ value, label: map[value].label }));
}
