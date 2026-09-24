/**
 * ServiceDesk Pro — Time Machine routes.
 *
 * Every route here, the read included, requires `demo:control`. That is deliberate:
 * an employee has no use for the panel, and a control that appears in the UI for
 * somebody who cannot press it is worse than one that is absent. The service applies
 * the other two gates — see its header.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission, validate } from '@/middleware';
import { advance, currentClock, jumpTo, reset, } from '@/modules/settings/demo.service';
import { advanceClockSchema, setClockSchema, } from '@/modules/settings/settings.schema';
import { handler } from '@/utils/handler';
import { bodyOf } from '@/utils/input';
import { ok } from '@/utils/respond';
export const demoRouter = Router();
demoRouter.use(authenticate(), requirePermission(Permission.DEMO_CONTROL));
demoRouter.get('/clock', handler(async (_req, res) => ok(res, currentClock())));
demoRouter.post('/clock/advance', validate(advanceClockSchema), handler(async (req, res) => ok(res, await advance(bodyOf(req).minutes, requireActor(req)))));
demoRouter.post('/clock/set', validate(setClockSchema), handler(async (req, res) => ok(res, await jumpTo(bodyOf(req).at, requireActor(req)))));
demoRouter.post('/clock/reset', handler(async (req, res) => ok(res, await reset(requireActor(req)))));
