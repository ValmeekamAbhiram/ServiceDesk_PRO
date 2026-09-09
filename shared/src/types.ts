/**
 * ServiceDesk Pro — shared DTO contract.
 *
 * The exact JSON shape crossing the wire. The server returns these; the client
 * consumes them; neither guesses. Two conventions hold throughout:
 *
 *  - **Ids are strings.** `ObjectId` is a server-side concern and never leaks
 *    into a DTO, so the client never has to know what a BSON type is.
 *  - **Dates are ISO 8601 strings.** `JSON.parse` does not revive `Date`, so a
 *    DTO typed `Date` would be a lie the moment it left the server. The client
 *    parses at the point of display.
 *
 * DTOs are also where **derived** values live. `slaResponseRemainingMs` is not
 * stored anywhere — it is computed per request from the deadline and the current
 * clock, so the UI never has to reimplement SLA arithmetic to draw a countdown.
 */

import type {
  ArticleStatus,
  AssetStatus,
  AssetType,
  AuditAction,
  AuditEntity,
  ClockMode,
  CommentVisibility,
  ErrorCode,
  NotificationType,
  Permission,
  Priority,
  Role,
  SlaState,
  TicketStatus,
  UserStatus,
} from './enums';

/* ───────────────────────────── API envelopes ─────────────────────────────── */

/**
 * Every successful response is `{ success: true, data: … }`.
 *
 * The wrapper looks like ceremony on a single object, and it earns its keep the
 * first time an endpoint needs to return a list plus a total: the client's
 * "did this work?" check never has to change shape.
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  /** Correlation id — the same value in the server logs. Quote it in a bug report. */
  requestId: string;
}

export interface ApiFieldError {
  /** Dotted path, e.g. `title` or `items.0.assetId`. */
  path: string;
  message: string;
}

export interface ApiError {
  success: false;
  error: {
    code: ErrorCode;
    /** Safe to show a user verbatim. Never contains internals or a stack trace. */
    message: string;
    /** Present on `VALIDATION_FAILED`: every problem at once, not just the first. */
    fields?: ApiFieldError[];
    /** `VERSION_CONFLICT` sends `currentVersion`; `RATE_LIMITED` sends `retryAfterSeconds`. */
    [key: string]: unknown;
  };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/**
 * Query parameters shared by every list endpoint.
 *
 * `sortBy` and `sortOrder` are spelled the way the server's Zod schemas spell them.
 * They were once `sort` and `order` here, which typechecked on both sides and did
 * nothing at all — the server dropped the unknown keys and every list came back in its
 * default order. Each list narrows `sortBy` to the fields it actually indexes.
 */
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** `{ id, label }` for dropdowns, so the client never hardcodes a list. */
export interface Option {
  id: string;
  label: string;
}

/* ──────────────────────────────── Auth ──────────────────────────────────── */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token, so the client can refresh proactively. */
  accessTokenExpiresAt: string;
}

export interface AuthResponse extends AuthTokens {
  user: CurrentUserDto;
}

export interface RefreshRequest {
  refreshToken: string;
}

/**
 * The signed-in user, as the client sees themselves.
 *
 * `permissions` is resolved server-side from the role and sent for **rendering
 * only** — it decides which buttons appear. Every one of those actions is
 * checked again on the server, because a permission list in the browser is a
 * hint, not a guarantee.
 */
export interface CurrentUserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  jobTitle: string | null;
  phone: string | null;
  permissions: Permission[];
  createdAt: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/* ──────────────────────────────── Users ─────────────────────────────────── */

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  jobTitle: string | null;
  phone: string | null;
  /** Denormalised counters, maintained as tickets are written. */
  openTicketCount: number;
  assignedTicketCount: number;
  createdAt: string;
}

/** The `{ id, name }` stub embedded wherever a ticket names a person. */
export interface UserRefDto {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/**
 * There is no `CreateUserRequest`. People register themselves through
 * `POST /api/auth/register` and an administrator then grants the role with this patch —
 * an admin choosing somebody else's password would need a way to tell them what it is,
 * and with no email delivery in this build that way is worse than the problem it solves.
 *
 * `email` is absent for a different reason: it is the login identity, and rewriting
 * somebody's identity with no verification step is account takeover with an audit trail.
 */
export interface UpdateUserRequest {
  name?: string;
  role?: Role;
  status?: UserStatus;
  jobTitle?: string | null;
  phone?: string | null;
}

export interface UserListQuery extends PaginationQuery {
  q?: string;
  role?: Role;
  status?: UserStatus;
}

/* ────────────────────────────── Categories ──────────────────────────────── */

export interface CategoryDto {
  id: string;
  name: string;
  description: string | null;
  /** Hex colour used by the badge, so the UI has no hardcoded palette per name. */
  color: string;
  defaultPriority: Priority;
  /**
   * Lower-cased terms the offline ticket classifier scores a title against. Returned so
   * an administrator can see and tune what the suggestion panel is matching on; it is
   * ordinary configuration, not a secret.
   */
  keywords: string[];
  /** Ascending display order in every picker. Ties break on name. */
  sortOrder: number;
  active: boolean;
  ticketCount: number;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  color?: string;
  defaultPriority?: Priority;
  keywords?: string[];
  sortOrder?: number;
  active?: boolean;
}

/* ─────────────────────────────── Tickets ────────────────────────────────── */

/**
 * One row in a ticket's timeline.
 *
 * Stored on the ticket rather than derived from the audit log: the timeline is
 * read on every ticket page and must not depend on a separate collection being
 * intact.
 */
export interface TicketStatusChangeDto {
  from: TicketStatus | null;
  to: TicketStatus;
  at: string;
  by: UserRefDto | null;
  note: string | null;
}

export interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedBy: UserRefDto | null;
  uploadedAt: string;
}

export interface TicketCommentDto {
  id: string;
  ticketId: string;
  /** The live user record. Null once the author is deleted — render `authorLabel`. */
  author: UserRefDto | null;
  /** The author's name as it was when they wrote this. Always present. */
  authorLabel: string;
  body: string;
  /** True when the body was changed after posting; the UI marks it "edited". */
  edited: boolean;
  visibility: CommentVisibility;
  /** True when this comment is the one that stopped the response SLA clock. */
  isFirstResponse: boolean;
  attachments: AttachmentDto[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The SLA panel for one target, everything the countdown needs.
 *
 * `remainingMs` is signed: negative means overdue by that much. Sending one
 * signed number instead of a separate `overdue` boolean removes the possibility
 * of the two disagreeing.
 */
export interface SlaTargetDto {
  state: SlaState;
  /** Absolute deadline in business time. Null if this target has no policy. */
  dueAt: string | null;
  /** When the target was actually hit. */
  metAt: string | null;
  /** Signed: `dueAt - now`. Negative once breached. */
  remainingMs: number | null;
  /** 0–100+, business minutes consumed over the budget. Drives the progress bar. */
  percentUsed: number;
  /** Total business minutes allowed, from the policy. */
  budgetMinutes: number;
}

export interface TicketSlaDto {
  policyName: string;
  response: SlaTargetDto;
  resolution: SlaTargetDto;
  /** True if either target is breached — the one flag a list row needs. */
  breached: boolean;
}

/** The compact shape a list row needs. Deliberately smaller than `TicketDto`. */
export interface TicketListItemDto {
  id: string;
  number: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  category: Option | null;
  requester: UserRefDto | null;
  assignee: UserRefDto | null;
  sla: TicketSlaDto;
  commentCount: number;
  /** Lets a list row show a paperclip badge without a per-ticket query. */
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDto extends TicketListItemDto {
  description: string;
  asset: AssetRefDto | null;
  attachments: AttachmentDto[];
  statusHistory: TicketStatusChangeDto[];
  resolutionNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  firstResponseAt: string | null;
  reopenCount: number;
  /** Optimistic-concurrency token; send it back on update. */
  version: number;
  /** Statuses this ticket may legally move to, from `TICKET_TRANSITIONS`. */
  allowedTransitions: TicketStatus[];
}

export interface CreateTicketRequest {
  title: string;
  description: string;
  categoryId: string;
  priority?: Priority;
  assetId?: string | null;
}

export interface UpdateTicketRequest {
  title?: string;
  description?: string;
  categoryId?: string;
  priority?: Priority;
  assetId?: string | null;
  /** Required: rejected with `VERSION_CONFLICT` if someone else edited first. */
  version: number;
}

export interface ChangeTicketStatusRequest {
  status: TicketStatus;
  note?: string;
  /** Required by the server when moving to RESOLVED. */
  resolutionNote?: string;
  version: number;
}

export interface AssignTicketRequest {
  /** Null unassigns and returns the ticket to the queue. */
  assigneeId: string | null;
  version: number;
}

export interface AddCommentRequest {
  body: string;
  visibility?: CommentVisibility;
}

export interface TicketListQuery extends PaginationQuery {
  /** Free text over number, title and description. */
  q?: string;
  /** Repeatable or comma-separated: `?status=OPEN,IN_PROGRESS`. */
  status?: TicketStatus[];
  priority?: Priority[];
  categoryId?: string;
  assigneeId?: string;
  requesterId?: string;
  /** Every ticket raised against one asset — what the asset page shows as its history. */
  assetId?: string;
  /** `me` shortcuts, so the client does not have to know its own id in a query. */
  scope?: 'all' | 'mine' | 'unassigned' | 'created';
  /** Only tickets with a breached target. */
  breached?: boolean;
  createdFrom?: string;
  createdTo?: string;
}

/* ────────────────────────────── SLA policy ──────────────────────────────── */

/**
 * The business-hours window, as minutes from midnight in `timezone`.
 *
 * Minutes-from-midnight rather than `"09:00"` because the SLA engine does
 * arithmetic on it, and parsing a string at every comparison is how one call
 * site ends up treating 9:30 as 9.3 hours.
 */
export interface BusinessHoursDto {
  timezone: string;
  startMinute: number;
  endMinute: number;
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** Server-rendered summary, e.g. "Mon–Fri, 09:00–18:00 (Asia/Kolkata)". */
  label: string;
}

export interface SlaPolicyDto {
  id: string;
  name: string;
  businessHours: BusinessHoursDto;
  /** Per-priority budgets, in **business** minutes. */
  targets: Record<Priority, { responseMinutes: number; resolutionMinutes: number }>;
  /** Percent of the budget consumed at which a target becomes AT_RISK. */
  atRiskThresholdPercent: number;
  updatedAt: string;
}

export interface UpdateSlaPolicyRequest {
  name?: string;
  businessHours?: Partial<BusinessHoursDto>;
  targets?: Partial<Record<Priority, { responseMinutes: number; resolutionMinutes: number }>>;
  atRiskThresholdPercent?: number;
}

/* ──────────────────────────────── Assets ───────────────────────────────── */

export interface AssetRefDto {
  id: string;
  tag: string;
  name: string;
  type: AssetType;
  status: AssetStatus;
}

export interface AssetDto extends AssetRefDto {
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  assignedTo: UserRefDto | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  warrantyExpiryDate: string | null;
  /** Negative once expired, so a single number drives the warranty badge. */
  warrantyDaysRemaining: number | null;
  notes: string | null;
  /** Denormalised, so the list does not need a lookup per row. */
  ticketCount: number;
  openTicketCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AssetInput {
  name: string;
  type: AssetType;
  status?: AssetStatus;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  location?: string | null;
  assignedToId?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyExpiryDate?: string | null;
  notes?: string | null;
}

export interface AssetListQuery extends PaginationQuery {
  q?: string;
  type?: AssetType[];
  status?: AssetStatus[];
  assignedToId?: string;
  /** Warranty expiring inside N days (or already expired). */
  warrantyWithinDays?: number;
}

/* ────────────────────────────── Knowledge ──────────────────────────────── */

export interface ArticleDto {
  id: string;
  title: string;
  slug: string;
  summary: string;
  /** Markdown. Rendered client-side; sanitised before display. */
  body: string;
  status: ArticleStatus;
  category: Option | null;
  tags: string[];
  author: UserRefDto | null;
  viewCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A search hit: the article without its body, plus why it matched. */
export interface ArticleSearchHitDto {
  id: string;
  title: string;
  slug: string;
  summary: string;
  tags: string[];
  /** MongoDB text score. Comparable within one result set, not across queries. */
  score: number;
}

/**
 * Note what is missing: `status`. Publishing is `POST /api/articles/:id/publish`,
 * behind `ARTICLE_PUBLISH`, which only ADMIN holds. If the write shape carried a
 * status then an author holding `ARTICLE_WRITE` could publish their own draft by
 * naming the field, which is the one thing the review boundary exists to prevent.
 */
export interface ArticleInput {
  title: string;
  summary: string;
  body: string;
  categoryId?: string | null;
  tags?: string[];
}

export interface ArticleListQuery extends PaginationQuery {
  q?: string;
  status?: ArticleStatus;
  categoryId?: string;
  tag?: string;
}

/* ─────────────────────────── Ticket assistance ─────────────────────────── */

/**
 * The one AI-assisted feature: a suggestion shown while a ticket is being
 * written.
 *
 * It **suggests** and never applies. The user picks the category and priority;
 * this only pre-selects them. `source` is surfaced in the UI so a suggestion is
 * never mistaken for a policy decision — `heuristic` means the offline keyword
 * classifier produced it, which is what runs when no API key is configured.
 */
export interface TicketSuggestionDto {
  categoryId: string | null;
  categoryName: string | null;
  priority: Priority;
  /** 0–1. Shown as a percentage next to the suggestion. */
  confidence: number;
  /** One line the user can read and disagree with. */
  reason: string;
  source: 'heuristic' | 'llm';
  /** Existing articles that may already answer this, by text search. */
  relatedArticles: ArticleSearchHitDto[];
}

export interface TicketSuggestionRequest {
  title: string;
  description?: string;
}

/* ───────────────────────────── Notifications ───────────────────────────── */

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Client-side route to open, e.g. `/tickets/65f…`. */
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationListDto extends Paginated<NotificationDto> {
  unreadCount: number;
}

/* ──────────────────────────────── Audit ────────────────────────────────── */

export interface AuditLogDto {
  id: string;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string | null;
  /** Label captured at write time, so it survives the entity being renamed. */
  entityLabel: string | null;
  /** One past-tense line: "Assigned to Tara Tech". The trail's readable column. */
  summary: string;
  /**
   * Null for the SLA monitor and the seeder, whose ids are not real users. `actorName`
   * is populated either way, so the table can name the writer without a special case.
   */
  actor: UserRefDto | null;
  actorName: string;
  automated: boolean;
  /** Changed fields only — `{ status: { from, to } }`. */
  changes: Record<string, { from: unknown; to: unknown }> | null;
  requestId: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditListQuery extends PaginationQuery {
  action?: AuditAction;
  entityType?: AuditEntity;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

/* ────────────────────────────── Dashboard ──────────────────────────────── */

export interface KpiDto {
  label: string;
  value: number;
  /** Percent change against the previous equivalent period. Null if no baseline. */
  changePercent: number | null;
  /** Whether an increase is good — the client must not guess per metric. */
  higherIsBetter: boolean;
  /**
   * How to render `value`. A `percent` is already scaled: `92.5` means 92.5%, not
   * 9250%. `hours` are business hours, so "4.2" is half a working day and not a
   * fifth of a calendar one. Both arrive rounded to one decimal place.
   */
  format: 'number' | 'percent' | 'hours';
}

export interface CountByKeyDto {
  key: string;
  label: string;
  count: number;
  color?: string;
}

export interface TimeSeriesPointDto {
  /** `YYYY-MM-DD`. */
  date: string;
  created: number;
  resolved: number;
}

export interface TechnicianLoadDto {
  technician: UserRefDto;
  open: number;
  resolvedLast7Days: number;
  breached: number;
  /** Mean business hours from creation to resolution. Null if nothing resolved. */
  avgResolutionHours: number | null;
}

export interface DashboardDto {
  kpis: KpiDto[];
  byStatus: CountByKeyDto[];
  byPriority: CountByKeyDto[];
  byCategory: CountByKeyDto[];
  volume: TimeSeriesPointDto[];
  /** Staff only; empty for an employee. */
  technicianLoad: TechnicianLoadDto[];
  /** The queue's worst offenders, for the "needs attention" panel. */
  atRisk: TicketListItemDto[];
}

/* ────────────────────── Settings, demo & system state ──────────────────── */

export interface SettingsDto {
  /** Shown under the product name in the sidebar, for every signed-in user. */
  organizationName: string;
  /** Offered as a `mailto:` in the sidebar footer. Nothing sends mail on its behalf. */
  supportEmail: string;
  /**
   * Two flags per feature, and the pairing is the point.
   *
   * `demoMode` and `aiSuggestionsEnabled` are the *effective* values —
   * `env.DEMO_MODE && demoModeRequested`, `env.AI_ENABLED && aiSuggestionsRequested`.
   * A stored setting can switch a feature off but never on, because the environment
   * has the last word on what this deployment is allowed to do.
   *
   * The `Requested` twin is what the admin form edits. Both are sent so the form can
   * distinguish "an administrator turned this off" from "this deployment was never
   * built with it" — a toggle that silently has no effect is worse than one that
   * explains why it is inert.
   */
  demoMode: boolean;
  demoModeRequested: boolean;
  aiSuggestionsEnabled: boolean;
  aiSuggestionsRequested: boolean;
  /** True once the seeder has run, so the demo panel can say so honestly. */
  seeded: boolean;
  updatedAt: string;
}

export interface UpdateSettingsRequest {
  organizationName?: string;
  supportEmail?: string;
  aiSuggestionsEnabled?: boolean;
  demoModeRequested?: boolean;
}

/**
 * The Time Machine's state.
 *
 * Both times are sent so the demo panel can show them side by side — the whole
 * point of the feature is that the audience sees a *simulated* clock moving,
 * not a real one.
 */
export interface DemoClockDto {
  mode: ClockMode;
  /** What the SLA engine believes the time is. */
  simulatedTime: string;
  /** What the wall clock says. */
  realTime: string;
  offsetMs: number;
  offsetLabel: string;
}

export interface AdvanceClockRequest {
  /** Minutes to jump forward. Omit with `reset: true` to return to real time. */
  minutes?: number;
  reset?: boolean;
}

/**
 * The subset of configuration the server is willing to say out loud. Secrets are
 * absent by construction: `publicConfig()` builds this object field by field rather
 * than filtering `env`, so a new secret cannot leak by being forgotten.
 */
export interface PublicConfigDto {
  nodeEnv: string;
  version: string;
  /** Effective, so a production deployment always reports `false`. */
  demoMode: boolean;
  timezone: string;
  aiEnabled: boolean;
  aiProvider: 'anthropic' | 'heuristic';
  maxUploadMb: number;
}

/**
 * `GET /api/health`, unauthenticated. `degraded` rather than a 5xx when the database
 * is unreachable, because the process is answering and a platform health check should
 * be told the difference between "not listening" and "listening, cannot serve".
 *
 * The route is typed by this interface so the response cannot drift away from it —
 * which it had, before anything checked.
 */
export interface HealthDto extends PublicConfigDto {
  status: 'ok' | 'degraded';
  /** Simulated time. Under a shifted demo clock this is not the wall clock. */
  time: string;
  db: { status: 'up' | 'down' | 'degraded'; kind: string | null };
}
