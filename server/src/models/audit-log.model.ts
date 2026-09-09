/**
 * ServiceDesk Pro — audit log.
 *
 * Append-only, enforced in the schema rather than by convention. The pre-hooks
 * below make `updateOne`, `findOneAndUpdate`, `deleteOne` and friends throw, so
 * an audit row cannot be rewritten even by code holding an admin actor, or by a
 * future service that "just needs to fix a typo". A log the audited system can
 * edit is not evidence of anything.
 *
 * There is no `versioned()` call here for the same reason: nothing about a row
 * ever changes, so there is no version to track.
 *
 * ## The actor is denormalised, not referenced
 *
 * `actorName` / `actorEmail` / `actorRole` are copied in at write time so an
 * entry stays readable after the user is renamed or removed, and so the audit
 * list needs no `populate()`. An audit trail that renders as "unknown user did
 * something" has lost the only thing it was for.
 *
 * ## `changes`
 *
 * Before/after values, which is what makes an entry useful ("priority MEDIUM →
 * URGENT", not "ticket updated"). `auditService` strips sensitive fields before
 * they reach this collection: a password change is recorded as an *event*, never
 * with its values.
 */

import { Schema, Types } from 'mongoose';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, type AuditAction, type AuditEntity } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, enumField, ref } from '@/models/helpers';

export interface AuditChangeDoc {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditLogDoc {
  _id: Types.ObjectId;
  /** Null for anything the SLA monitor or the seeder did. */
  actorId: Types.ObjectId | null;
  /** Denormalised — see the header. */
  actorName: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: Types.ObjectId | null;
  /** Human-friendly identifier: `TKT-000123`, `AST-000004`. */
  entityLabel: string | null;
  summary: string;
  changes: AuditChangeDoc[];
  ip: string | null;
  userAgent: string | null;
  /** Correlates every row written while serving one request. */
  requestId: string | null;
  /** True when a background job acted rather than a person. */
  automated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const auditChangeSchema = new Schema<AuditChangeDoc>(
  {
    field: { type: String, required: true },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorId: ref('User', { index: false }),
    actorName: { type: String, required: true, maxlength: 160 },
    actorEmail: { type: String, default: null, maxlength: 200 },
    actorRole: { type: String, default: null, maxlength: 40 },
    action: enumField(AUDIT_ACTIONS, { required: true }),
    entityType: enumField(AUDIT_ENTITIES, { required: true }),
    entityId: { type: Schema.Types.ObjectId, default: null, index: false },
    entityLabel: { type: String, default: null, maxlength: 160 },
    summary: { type: String, required: true, maxlength: 500 },
    changes: { type: [auditChangeSchema], default: [] },
    ip: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 512 },
    requestId: { type: String, default: null, index: false },
    automated: { type: Boolean, default: false },
  },
  BASE_SCHEMA_OPTIONS
);

/* ───────────────────────── append-only enforcement ─────────────────────── */

const IMMUTABLE = 'Audit log entries are append-only and cannot be modified or deleted.';

auditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function block() {
  throw new Error(IMMUTABLE);
});

auditLogSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function block() {
  throw new Error(IMMUTABLE);
});

auditLogSchema.pre('save', function blockEdits(next) {
  if (!this.isNew) {
    next(new Error(IMMUTABLE));
    return;
  }
  next();
});

/* ─────────────────────────────── indexes ────────────────────────────────── */

/** The default view: newest first. */
auditLogSchema.index({ createdAt: -1 });
/** "Show me everything that happened to this ticket." */
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
/** "Show me everything this person did." */
auditLogSchema.index({ actorId: 1, createdAt: -1 });
/** Filter the admin list by action. */
auditLogSchema.index({ action: 1, createdAt: -1 });
/** Every row written while serving one request. */
auditLogSchema.index({ requestId: 1, createdAt: 1 });

export const AuditLog = defineModel<AuditLogDoc>('AuditLog', auditLogSchema);
