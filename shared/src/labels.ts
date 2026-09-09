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

import {
  ArticleStatus,
  AssetStatus,
  AssetType,
  AuditAction,
  AuditEntity,
  NotificationType,
  Priority,
  Role,
  SlaState,
  TicketStatus,
  UserStatus,
} from './enums';

/** Semantic colour roles understood by the UI primitives. */
export type Tone =
  | 'neutral'
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'violet'
  | 'teal';

export interface LabelMeta {
  label: string;
  tone: Tone;
  /** Short form for dense tables. */
  short?: string;
  description?: string;
}

export const TICKET_STATUS_META: Record<TicketStatus, LabelMeta> = {
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

export const PRIORITY_META: Record<Priority, LabelMeta> = {
  LOW: { label: 'Low', tone: 'neutral', description: 'Minor inconvenience, no deadline pressure' },
  MEDIUM: { label: 'Medium', tone: 'info', description: 'Normal day-to-day request' },
  HIGH: { label: 'High', tone: 'warning', description: 'Blocking one person’s work' },
  URGENT: { label: 'Urgent', tone: 'danger', description: 'Blocking a team, or business critical' },
};

export const SLA_STATE_META: Record<SlaState, LabelMeta> = {
  ON_TRACK: { label: 'On track', tone: 'success', description: 'Comfortably inside the deadline' },
  AT_RISK: { label: 'At risk', tone: 'warning', description: 'Most of the time budget is used' },
  BREACHED: { label: 'Breached', tone: 'danger', description: 'The deadline passed' },
  MET: { label: 'Met', tone: 'success', description: 'Hit in time' },
};

export const ROLE_META: Record<Role, LabelMeta> = {
  ADMIN: { label: 'Administrator', tone: 'danger', short: 'Admin', description: 'Full access, including users and settings' },
  TECHNICIAN: { label: 'Technician', tone: 'primary', short: 'Tech', description: 'Works the ticket queue' },
  EMPLOYEE: { label: 'Employee', tone: 'neutral', short: 'Emp', description: 'Raises tickets and reads articles' },
};

export const USER_STATUS_META: Record<UserStatus, LabelMeta> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INACTIVE: { label: 'Inactive', tone: 'neutral', description: 'Cannot sign in; history preserved' },
};

export const ASSET_TYPE_META: Record<AssetType, LabelMeta> = {
  LAPTOP: { label: 'Laptop', tone: 'primary' },
  DESKTOP: { label: 'Desktop', tone: 'primary' },
  MONITOR: { label: 'Monitor', tone: 'info' },
  PRINTER: { label: 'Printer', tone: 'teal' },
  PHONE: { label: 'Phone', tone: 'violet' },
  NETWORK: { label: 'Network device', tone: 'info', short: 'Network' },
  SERVER: { label: 'Server', tone: 'danger' },
  OTHER: { label: 'Other', tone: 'neutral' },
};

export const ASSET_STATUS_META: Record<AssetStatus, LabelMeta> = {
  IN_USE: { label: 'In use', tone: 'success' },
  IN_STOCK: { label: 'In stock', tone: 'info' },
  IN_REPAIR: { label: 'In repair', tone: 'warning' },
  RETIRED: { label: 'Retired', tone: 'neutral' },
};

export const ARTICLE_STATUS_META: Record<ArticleStatus, LabelMeta> = {
  DRAFT: { label: 'Draft', tone: 'warning', description: 'Not visible to employees yet' },
  PUBLISHED: { label: 'Published', tone: 'success', description: 'Visible to everyone' },
};

export const NOTIFICATION_TYPE_META: Record<NotificationType, LabelMeta> = {
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
export const AUDIT_ACTION_META: Record<AuditAction, LabelMeta> = {
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

export const AUDIT_ENTITY_META: Record<AuditEntity, LabelMeta> = {
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
function lookup<T extends string>(
  map: Record<string, LabelMeta>,
  value: T | null | undefined
): LabelMeta {
  if (!value) return { label: '—', tone: 'neutral' };
  return map[value] ?? { label: titleCase(value), tone: 'neutral' };
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const ticketStatusMeta = (v: TicketStatus | null | undefined): LabelMeta =>
  lookup(TICKET_STATUS_META, v);
export const priorityMeta = (v: Priority | null | undefined): LabelMeta =>
  lookup(PRIORITY_META, v);
export const slaStateMeta = (v: SlaState | null | undefined): LabelMeta =>
  lookup(SLA_STATE_META, v);
export const roleMeta = (v: Role | null | undefined): LabelMeta => lookup(ROLE_META, v);
export const userStatusMeta = (v: UserStatus | null | undefined): LabelMeta =>
  lookup(USER_STATUS_META, v);
export const assetTypeMeta = (v: AssetType | null | undefined): LabelMeta =>
  lookup(ASSET_TYPE_META, v);
export const assetStatusMeta = (v: AssetStatus | null | undefined): LabelMeta =>
  lookup(ASSET_STATUS_META, v);
export const articleStatusMeta = (v: ArticleStatus | null | undefined): LabelMeta =>
  lookup(ARTICLE_STATUS_META, v);
export const notificationTypeMeta = (v: NotificationType | null | undefined): LabelMeta =>
  lookup(NOTIFICATION_TYPE_META, v);
export const auditActionMeta = (v: AuditAction | null | undefined): LabelMeta =>
  lookup(AUDIT_ACTION_META, v);
export const auditEntityMeta = (v: AuditEntity | null | undefined): LabelMeta =>
  lookup(AUDIT_ENTITY_META, v);

/** `[{ value, label }]` for a `<select>`, built from the enum so it cannot drift. */
export function optionsFrom<T extends string>(
  map: Record<T, LabelMeta>
): { value: T; label: string }[] {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value].label }));
}
