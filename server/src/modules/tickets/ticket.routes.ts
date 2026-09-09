/**
 * ServiceDesk Pro — ticket routes.
 *
 * `authenticate()` is applied to the whole router, so no individual route can be
 * added without it. Beyond that, two things are worth understanding about the guards
 * below, because they are not interchangeable:
 *
 *  - **`requirePermission` decides who may call the endpoint; the service decides
 *    which rows they see.** The read routes name `ticket:read:own` and
 *    `ticket:read:all` (OR semantics) to document what they need, but every role holds
 *    the first — so the guard is not what protects other people's tickets.
 *    `scopeFilter()` in the service is, and it does so by narrowing the query rather
 *    than by rejecting a response after the fact.
 *  - **`/reopen` carries no permission guard on purpose.** An employee holds no
 *    `ticket:update`, so guarding it with that would lock a requester out of their own
 *    ticket; guarding it with a permission everyone has would look like protection
 *    while providing none. The rule — requester, or staff — is stated once in
 *    `ticketService.reopen()`, where it can be read and tested.
 *
 * Route order matters: `/:id/...` sub-paths are registered after `/:id` handlers of a
 * different method, and no route pattern here can shadow another.
 *
 * The two routes that accept files run `acceptFiles()` **before** `validate()`, and
 * they have to: a multipart body does not exist until multer has parsed it, so
 * validating first would see an empty `req.body` and reject every upload. The
 * consequence is that files are on disk before the request is known to be valid,
 * which is what `cleanupOnFailure()` is there to undo.
 */

import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requirePermission, uploadRateLimit, validate } from '@/middleware';
import { acceptFiles, cleanupOnFailure } from '@/modules/attachments/upload.middleware';
import * as controller from '@/modules/tickets/ticket.controller';
import {
  addCommentSchema,
  assignTicketSchema,
  changeStatusSchema,
  createTicketSchema,
  listCommentsSchema,
  listTicketsSchema,
  reopenTicketSchema,
  ticketIdSchema,
  updateTicketSchema,
} from '@/modules/tickets/ticket.schema';

export const ticketRouter = Router();

ticketRouter.use(authenticate());

const canRead = requirePermission(Permission.TICKET_READ_OWN, Permission.TICKET_READ_ALL);
/** Applied to the routes that take files, in this order, for the reason in the header. */
const withFiles = [uploadRateLimit(), cleanupOnFailure(), acceptFiles('files')];

ticketRouter.get('/', canRead, validate(listTicketsSchema), controller.list);
ticketRouter.post(
  '/',
  requirePermission(Permission.TICKET_CREATE),
  ...withFiles,
  validate(createTicketSchema),
  controller.create
);

ticketRouter.get('/:id', canRead, validate(ticketIdSchema), controller.getById);
ticketRouter.patch(
  '/:id',
  requirePermission(Permission.TICKET_UPDATE),
  validate(updateTicketSchema),
  controller.update
);

ticketRouter.patch(
  '/:id/status',
  requirePermission(Permission.TICKET_UPDATE),
  validate(changeStatusSchema),
  controller.changeStatus
);
ticketRouter.patch(
  '/:id/assign',
  requirePermission(Permission.TICKET_ASSIGN),
  validate(assignTicketSchema),
  controller.assign
);
ticketRouter.post('/:id/reopen', validate(reopenTicketSchema), controller.reopen);

ticketRouter.get('/:id/comments', canRead, validate(listCommentsSchema), controller.listComments);
ticketRouter.post(
  '/:id/comments',
  canRead,
  ...withFiles,
  validate(addCommentSchema),
  controller.addComment
);
