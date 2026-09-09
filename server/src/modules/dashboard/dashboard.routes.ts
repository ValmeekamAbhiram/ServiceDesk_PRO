/**
 * ServiceDesk Pro — dashboard route.
 *
 * One `GET`, gated on `ticket:read:own` — the permission every role holds. The
 * dashboard is a summary of tickets, so anyone who may see a ticket may see a summary
 * of the ones they can see, and the service scopes the numbers with the ticket list's
 * own filter. `analytics:view` is checked inside the service instead of here, because
 * it governs one field of the response (`technicianLoad`) rather than access to it.
 *
 * No query parameters, so no schema: the window sizes are the server's choice. That is
 * not laziness about flexibility — it means no caller can ask for a range wide enough
 * to turn this into a full-collection scan.
 */

import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission } from '@/middleware';
import * as dashboardService from '@/modules/dashboard/dashboard.service';
import { handler } from '@/utils/handler';
import { ok } from '@/utils/respond';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate());

dashboardRouter.get(
  '/',
  requirePermission(Permission.TICKET_READ_OWN),
  handler(async (req, res) => ok(res, await dashboardService.getDashboard(requireActor(req))))
);
