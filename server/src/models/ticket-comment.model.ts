/**
 * ServiceDesk Pro — ticket comments.
 *
 * ## `visibility` is the security-sensitive field here
 *
 * An INTERNAL note is where a technician writes "third time this month, escalating
 * to their manager" — visible to staff, never to the person who raised the ticket.
 * The rule is enforced twice, in two independent places, because a single filter
 * is one refactor away from being dropped:
 *
 *   1. the query in `commentService.list()` adds `visibility: PUBLIC` for a
 *      non-staff actor, so internal rows never leave the database;
 *   2. the socket emitter publishes an internal comment only to the staff queue
 *      room, never to the requester's personal room.
 *
 * ## `authorLabel`
 *
 * The author's name is copied onto the comment. `populate()` would give the
 * current name, which is usually what you want — but a comment written by
 * someone since deactivated should still say who wrote it, and a deleted user
 * would otherwise render as a blank. One denormalised string removes a whole
 * class of "unknown user" in the timeline.
 */

import { Schema, Types } from 'mongoose';
import { COMMENT_VISIBILITIES, CommentVisibility } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, enumField, ref, requiredRef } from '@/models/helpers';

export interface TicketCommentDoc {
  _id: Types.ObjectId;
  ticketId: Types.ObjectId;
  authorId: Types.ObjectId | null;
  /** Denormalised — see the header. */
  authorLabel: string;
  body: string;
  visibility: CommentVisibility;
  /**
   * Marks the comment that stopped the response SLA clock. Recorded here as well
   * as on the ticket, so "what counted as the first response?" is answerable from
   * the timeline itself.
   */
  isFirstResponse: boolean;
  edited: boolean;
  editedAt: Date | null;
  attachmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ticketCommentSchema = new Schema<TicketCommentDoc>(
  {
    ticketId: requiredRef('Ticket', { index: false }),
    authorId: ref('User'),
    authorLabel: { type: String, required: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 20_000 },
    visibility: enumField(COMMENT_VISIBILITIES, {
      required: true,
      default: CommentVisibility.PUBLIC,
    }),
    isFirstResponse: { type: Boolean, default: false },
    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    attachmentCount: { type: Number, default: 0, min: 0 },
  },
  BASE_SCHEMA_OPTIONS
);

/**
 * The ticket detail view, in order, with `visibility` in the key so the
 * employee-facing variant (`visibility: PUBLIC`) is served from the same index
 * rather than filtered after the fetch.
 */
ticketCommentSchema.index({ ticketId: 1, visibility: 1, createdAt: 1 });

export const TicketComment = defineModel<TicketCommentDoc>('TicketComment', ticketCommentSchema);
