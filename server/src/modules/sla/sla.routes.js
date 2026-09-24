/**
 * ServiceDesk Pro — SLA policy routes.
 *
 * `GET` is open to any signed-in user, because the policy is the desk's published
 * commitment rather than a secret: an employee is entitled to know that an urgent
 * ticket is answered within fifteen working minutes, and the ticket page shows the
 * budget beside the countdown. `PATCH` needs `settings:manage`, which only an
 * administrator holds.
 *
 * There is no `POST` and no `DELETE`. Exactly one policy document exists, created from
 * the schema defaults the first time anything reads it — so there is nothing to create
 * and deleting it would leave every ticket without deadlines.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission, validate } from '@/middleware';
import { getSlaPolicy, saveSlaPolicy, toSlaPolicyDto } from '@/modules/sla/sla-policy.service';
import { updateSlaPolicySchema, } from '@/modules/sla/sla-policy.schema';
import { handler } from '@/utils/handler';
import { bodyOf } from '@/utils/input';
import { ok } from '@/utils/respond';
export const slaRouter = Router();
slaRouter.use(authenticate());
slaRouter.get('/', handler(async (_req, res) => ok(res, toSlaPolicyDto(await getSlaPolicy()))));
slaRouter.patch('/', requirePermission(Permission.SETTINGS_MANAGE), validate(updateSlaPolicySchema), handler(async (req, res) => ok(res, await saveSlaPolicy(bodyOf(req), requireActor(req)))));
