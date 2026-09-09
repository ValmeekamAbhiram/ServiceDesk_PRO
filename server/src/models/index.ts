/**
 * ServiceDesk Pro — model barrel.
 *
 * Twelve collections, and the ordering below is the dependency order: `User`
 * first because almost everything references it, then the reference data
 * (`Category`, `SlaPolicy`), then the working documents, then the operational
 * ones. Reading it top to bottom is a reasonable tour of the data model.
 *
 * Importing from `@/models` rather than from each file keeps model registration
 * in one place: the first import of this module defines every schema, so a
 * service that touches only tickets cannot accidentally leave `Category`
 * unregistered and break its own `populate()`.
 */

/* ─────────────────────────────── helpers ────────────────────────────────── */

export {
  BASE_SCHEMA_OPTIONS,
  Counter,
  defineModel,
  enumField,
  isValidObjectId,
  nextSequence,
  ref,
  requiredRef,
  reserveSequence,
  resetSequence,
  toObjectId,
  versioned,
  type FieldDef,
} from '@/models/helpers';

/* ─────────────────────────── people and access ──────────────────────────── */

export { User, type UserDoc } from '@/models/user.model';
export { Session, type SessionDoc } from '@/models/session.model';

/* ───────────────────────────── reference data ───────────────────────────── */

export { Category, type CategoryDoc } from '@/models/category.model';
export {
  DEFAULT_SLA_TARGETS,
  SLA_POLICY_KEY,
  SlaPolicy,
  type BusinessHoursConfig,
  type SlaPolicyDoc,
  type SlaTargetBudget,
} from '@/models/sla-policy.model';
export {
  SETTINGS_KEY,
  SystemSettings,
  type SystemSettingsDoc,
} from '@/models/system-settings.model';

/* ────────────────────────────── the work itself ─────────────────────────── */

export {
  TICKET_NUMBER_PREFIX,
  TICKET_SEQUENCE,
  Ticket,
  type TicketDoc,
  type TicketSlaTarget,
  type TicketStatusChange,
} from '@/models/ticket.model';
export { TicketComment, type TicketCommentDoc } from '@/models/ticket-comment.model';
export { Attachment, type AttachmentDoc } from '@/models/attachment.model';

/* ──────────────────────────── assets and knowledge ──────────────────────── */

export {
  ASSET_SEQUENCE,
  ASSET_TAG_PREFIX,
  Asset,
  type AssetDoc,
} from '@/models/asset.model';
export {
  KnowledgeArticle,
  type KnowledgeArticleDoc,
} from '@/models/knowledge-article.model';

/* ───────────────────────────── operational ──────────────────────────────── */

export { Notification, type NotificationDoc } from '@/models/notification.model';
export {
  AuditLog,
  type AuditChangeDoc,
  type AuditLogDoc,
} from '@/models/audit-log.model';
