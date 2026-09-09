/**
 * ServiceDesk Pro — notification routes.
 *
 * There is no `requirePermission` on any of these, and that is deliberate rather
 * than an omission. Every role has notifications, so a permission would grant
 * everybody the same thing and say nothing about authorization. What actually
 * matters — *whose* notifications these are — cannot be expressed as a permission
 * at all: it is `recipientId: actor.user.id`, applied inside every query in the
 * service. `requireResourceOwnership` is not usable here either, because ownership
 * lives in the document rather than in the URL.
 *
 * There is no `DELETE`. Notifications expire on their own after 60 days (the TTL
 * index on the model), so a delete route would only add a way to lose history.
 */

import { Router } from 'express';
import { authenticate, requireActor, validate } from '@/middleware';
import * as notificationService from '@/modules/notifications/notification.service';
import {
  listNotificationsSchema,
  markAllReadSchema,
  notificationIdSchema,
  type ListNotificationsInput,
} from '@/modules/notifications/notification.schema';
import { handler } from '@/utils/handler';
import { paramsOf, queryOf } from '@/utils/input';
import { ok } from '@/utils/respond';

export const notificationRouter = Router();

notificationRouter.use(authenticate());

notificationRouter.get(
  '/',
  validate(listNotificationsSchema),
  handler(async (req, res) =>
    ok(res, await notificationService.list(queryOf<ListNotificationsInput>(req), requireActor(req)))
  )
);

/*
 * `/read-all` cannot collide with `/:id/read`, which is two segments deep — but it
 * would collide with a one-segment `/:id` route, so it is declared first. Anyone
 * adding `GET /:id` or `DELETE /:id` below inherits the right order instead of a
 * 400 on a perfectly well-formed `POST /read-all`.
 */
notificationRouter.post(
  '/read-all',
  validate(markAllReadSchema),
  handler(async (req, res) =>
    ok(
      res,
      await notificationService.markAllRead(queryOf<ListNotificationsInput>(req), requireActor(req))
    )
  )
);

notificationRouter.post(
  '/:id/read',
  validate(notificationIdSchema),
  handler(async (req, res) =>
    ok(res, await notificationService.markRead(paramsOf<{ id: string }>(req).id, requireActor(req)))
  )
);
