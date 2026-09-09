/**
 * ServiceDesk Pro — notification request schemas.
 *
 * Small, because there is almost nothing a client may say about a notification.
 * There is no create shape: notifications are raised by the server in response to
 * something that happened, and an endpoint that let a client post one would let
 * anybody put arbitrary text in somebody else's bell menu. There is no update shape
 * either — `read` is the only mutable field and it has its own route.
 *
 * `recipientId` is absent for the same reason it is absent from every filter the
 * client can influence: whose notifications you get is settled by the authenticated
 * identity, in the service.
 */

import { z } from 'zod';
import { objectIdField, queryBoolean, queryLimit, queryPage } from '@/utils/zod';

const listQuery = z.object({
  page: queryPage,
  limit: queryLimit,
  /** `?unreadOnly=true` — the bell menu's default view. */
  unreadOnly: queryBoolean,
});

export const listNotificationsSchema = { query: listQuery };

/**
 * `POST /read-all` takes the same query as the list, because it answers with the
 * refreshed page and the caller should get back the view it was already showing.
 */
export const markAllReadSchema = { query: listQuery };

export const notificationIdSchema = { params: z.object({ id: objectIdField }) };

export type ListNotificationsInput = z.infer<typeof listQuery>;
