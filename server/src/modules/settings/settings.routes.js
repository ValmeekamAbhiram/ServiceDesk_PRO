/**
 * ServiceDesk Pro — system settings routes.
 *
 * `GET` is open to any signed-in user because the client reads the organisation name
 * for the header and the two effective feature flags to decide which navigation items
 * exist. None of that is a secret, and hiding it would only mean the app renders a
 * suggestions panel on a deployment where suggestions are switched off.
 *
 * `PATCH` needs `settings:manage`. There is no `POST` and no `DELETE`: exactly one
 * settings document exists, created from schema defaults on first read.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission, validate } from '@/middleware';
import { getSystemSettings, saveSettings, toSettingsDto, } from '@/modules/settings/settings.service';
import { updateSettingsSchema, } from '@/modules/settings/settings.schema';
import { handler } from '@/utils/handler';
import { bodyOf } from '@/utils/input';
import { ok } from '@/utils/respond';
export const settingsRouter = Router();
settingsRouter.use(authenticate());
settingsRouter.get('/', handler(async (_req, res) => ok(res, toSettingsDto(await getSystemSettings()))));
settingsRouter.patch('/', requirePermission(Permission.SETTINGS_MANAGE), validate(updateSettingsSchema), handler(async (req, res) => ok(res, await saveSettings(bodyOf(req), requireActor(req)))));
