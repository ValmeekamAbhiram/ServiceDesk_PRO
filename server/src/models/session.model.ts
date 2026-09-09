/**
 * ServiceDesk Pro — refresh-token sessions.
 *
 * Refresh tokens are stored as SHA-256 hashes, never in plaintext. If this
 * collection leaked, an attacker would hold hashes that cannot be replayed —
 * the same reasoning that applies to passwords applies to long-lived tokens.
 *
 * Rotation is recorded rather than implied: refreshing revokes the old row and
 * links it to its successor via `replacedBySessionId`. A token presented after
 * it was rotated is therefore detectable as *reuse* rather than merely invalid,
 * which is the signal that a token was stolen — `authService` responds by
 * revoking the whole family.
 */

import { Schema, Types } from 'mongoose';
import { BASE_SCHEMA_OPTIONS, defineModel, ref, requiredRef } from '@/models/helpers';

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 of the refresh token. The token itself is never persisted. */
  refreshTokenHash: string;
  /** Groups every rotation of one login, so a whole family can be revoked. */
  familyId: string;
  issuedAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  replacedBySessionId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: requiredRef('User'),
    refreshTokenHash: { type: String, required: true, unique: true, select: false },
    familyId: { type: String, required: true, index: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 512 },
    deviceLabel: { type: String, default: null, maxlength: 120 },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null, maxlength: 200 },
    replacedBySessionId: ref('Session'),
  },
  BASE_SCHEMA_OPTIONS
);

/**
 * TTL index: Mongo deletes expired sessions on its own, so a logged-out laptop
 * does not leave a row behind forever. Deliberately no `versioned()` — sessions
 * are never edited by a user, so optimistic concurrency has nothing to protect.
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
/** "Active sessions" list on the security page. */
sessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 });

export const Session = defineModel<SessionDoc>('Session', sessionSchema);
