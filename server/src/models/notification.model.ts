/**
 * ServiceDesk Pro — in-app notifications.
 *
 * ## Persisted first, emitted second
 *
 * Every notification is written to this collection and *then* pushed over
 * Socket.IO. The socket is an accelerator over a durable store, never the store
 * itself: a technician whose laptop was asleep when their ticket was assigned
 * must still see it when they open the app. If the emit is all there is, the
 * notification simply never happened for them.
 *
 * ## One row per recipient
 *
 * Fan-out is at write time rather than at read time, because read state is
 * per-person. A single row with a `recipientIds` array would need a parallel
 * "who has read it" array, and marking one notification read would then be a
 * write to a document several other people are also writing to.
 */

import { Schema, Types } from 'mongoose';
import { NOTIFICATION_TYPES, NotificationType } from '@shared/enums';
import {
  BASE_SCHEMA_OPTIONS,
  defineModel,
  enumField,
  ref,
  requiredRef,
} from '@/models/helpers';

export interface NotificationDoc {
  _id: Types.ObjectId;
  recipientId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  /** Who caused it. Null for anything the SLA monitor raised. */
  actorId: Types.ObjectId | null;
  /** Client-side route to open, e.g. `/tickets/65f…`. */
  link: string | null;
  read: boolean;
  readAt: Date | null;
  /**
   * Notifications are swept after 60 days. Without a TTL this becomes the
   * largest collection in the database, and nobody has ever wanted to read a
   * two-month-old "status changed" alert.
   */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    recipientId: requiredRef('User', { index: false }),
    type: enumField(NOTIFICATION_TYPES, { required: true }),
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 1000 },
    actorId: ref('User', { index: false }),
    link: { type: String, default: null, maxlength: 300 },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  BASE_SCHEMA_OPTIONS
);

/** The bell menu: my notifications, newest first, unread grouped. */
notificationSchema.index({ recipientId: 1, read: 1, createdAt: -1 });
/** Mongo sweeps expired rows itself — see `expiresAt`. */
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Notification = defineModel<NotificationDoc>('Notification', notificationSchema);
