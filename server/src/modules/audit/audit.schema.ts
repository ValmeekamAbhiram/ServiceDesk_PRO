/**
 * ServiceDesk Pro — audit list query.
 *
 * Read-only by construction: there is no create shape and no update shape, because an
 * endpoint that accepted either would defeat the point of the collection. The only
 * thing a client may say about the trail is which slice of it to show.
 *
 * `entityId` and `actorId` are validated as object ids rather than passed through, so a
 * filter cannot smuggle an operator object into a Mongo query.
 */

import { z } from 'zod';
import { AuditAction, AuditEntity } from '@shared/enums';
import { objectIdField, queryDate, queryLimit, queryPage } from '@/utils/zod';

const listQuery = z.object({
  page: queryPage,
  limit: queryLimit,
  action: z.nativeEnum(AuditAction).optional(),
  entityType: z.nativeEnum(AuditEntity).optional(),
  entityId: objectIdField.optional(),
  actorId: objectIdField.optional(),
  /** Inclusive lower bound, exclusive upper — see `list()`. */
  from: queryDate,
  to: queryDate,
});

export const listAuditSchema = { query: listQuery };

export type ListAuditInput = z.infer<typeof listQuery>;
