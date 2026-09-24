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
export { BASE_SCHEMA_OPTIONS, Counter, defineModel, enumField, isValidObjectId, nextSequence, ref, requiredRef, reserveSequence, resetSequence, toObjectId, versioned, } from '@/models/helpers';
/* ─────────────────────────── people and access ──────────────────────────── */
export { User } from '@/models/user.model';
export { Session } from '@/models/session.model';
/* ───────────────────────────── reference data ───────────────────────────── */
export { Category } from '@/models/category.model';
export { DEFAULT_SLA_TARGETS, SLA_POLICY_KEY, SlaPolicy, } from '@/models/sla-policy.model';
export { SETTINGS_KEY, SystemSettings, } from '@/models/system-settings.model';
/* ────────────────────────────── the work itself ─────────────────────────── */
export { TICKET_NUMBER_PREFIX, TICKET_SEQUENCE, Ticket, } from '@/models/ticket.model';
export { TicketComment } from '@/models/ticket-comment.model';
export { Attachment } from '@/models/attachment.model';
/* ──────────────────────────── assets and knowledge ──────────────────────── */
export { ASSET_SEQUENCE, ASSET_TAG_PREFIX, Asset, } from '@/models/asset.model';
export { KnowledgeArticle, } from '@/models/knowledge-article.model';
/* ───────────────────────────── operational ──────────────────────────────── */
export { Notification } from '@/models/notification.model';
export { AuditLog, } from '@/models/audit-log.model';
