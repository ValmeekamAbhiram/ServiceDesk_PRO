/**
 * ServiceDesk Pro — attachment routes.
 *
 * Downloads only. Files arrive through the ticket and comment endpoints, because an
 * attachment with no parent has nothing to authorise against — "who may read this
 * file" is answered by the ticket it hangs off.
 */
import { Router } from 'express';
import { authenticate, validate } from '@/middleware';
import { ticketIdSchema } from '@/modules/tickets/ticket.schema';
import * as controller from '@/modules/attachments/attachment.controller';
export const attachmentRouter = Router();
attachmentRouter.use(authenticate());
attachmentRouter.get('/:id', validate(ticketIdSchema), controller.download);
