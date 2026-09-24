/**
 * ServiceDesk Pro — ticket suggestion route.
 *
 * Mounted at `/api/suggestions` rather than as `POST /api/tickets/suggest`, for two
 * reasons. Express matches in order, so a static path under `/api/tickets` has to be
 * declared before `/:id` or it is swallowed by it — a trap that only shows up when
 * somebody later reorders the file. And keeping it separate makes the boundary
 * visible: nothing in the ticket write path imports this module, so the assistant
 * cannot end up on the path that actually creates a ticket.
 *
 * `POST`, not `GET`, because the ticket text goes in the body. A description belongs
 * in neither a query string nor an access log.
 *
 * `aiRateLimit()` is tighter than the global limiter. With a key configured each call
 * is a paid provider request, and this endpoint is fired from a keystroke handler —
 * the combination that turns a stuck retry loop into an invoice.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { aiRateLimit, authenticate, requireActor, requirePermission, validate, } from '@/middleware';
import { suggestTicketSchema } from '@/modules/suggestions/suggestion.schema';
import * as suggestionService from '@/modules/suggestions/suggestion.service';
import { handler } from '@/utils/handler';
import { ok } from '@/utils/respond';
export const suggestionRouter = Router();
suggestionRouter.use(authenticate());
/**
 * `ticket:create` is the honest gate: this exists to help somebody file a ticket, so
 * whoever may file one may ask for help with it. Nothing is scoped beyond that
 * because nothing user-specific is read — categories and published articles are
 * already readable by every role.
 */
suggestionRouter.post('/ticket', requirePermission(Permission.TICKET_CREATE), aiRateLimit(), validate(suggestTicketSchema), handler(async (req, res) => ok(res, await suggestionService.suggestTicket(requireActor(req), req.body))));
