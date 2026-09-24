/**
 * ServiceDesk Pro — user administration routes.
 *
 * `USER_READ` is a technician's permission as well as an admin's, because assigning a
 * ticket means choosing a person. `USER_MANAGE` — the single `PATCH` — is ADMIN alone.
 *
 * There is no `POST` and no `DELETE`. People register themselves and an administrator
 * grants the role; an account is switched to `INACTIVE` rather than removed. Both are
 * explained in `user.schema.ts` and `user.service.ts` respectively.
 *
 * `PATCH /me` is the one write here that needs no permission beyond being signed in:
 * every account may correct its own name, job title and phone. Its body is a *narrower*
 * schema that does not accept `role` or `status`, so self-promotion is not something the
 * route can be talked into — the field simply is not there.
 *
 * `/assignees` and `/me` are declared before `/:id`, or Express would try to parse those
 * words as object ids and answer 400 to a valid request.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission, validate } from '@/middleware';
import * as userService from '@/modules/users/user.service';
import { listUsersSchema, updateOwnProfileSchema, updateUserSchema, userIdSchema, } from '@/modules/users/user.schema';
import { handler } from '@/utils/handler';
import { bodyOf, paramsOf, queryOf } from '@/utils/input';
import { ok, paginated } from '@/utils/respond';
export const userRouter = Router();
userRouter.use(authenticate());
userRouter.get('/', requirePermission(Permission.USER_READ), validate(listUsersSchema), handler(async (req, res) => paginated(res, await userService.list(queryOf(req)))));
userRouter.get('/assignees', requirePermission(Permission.USER_READ), handler(async (_req, res) => ok(res, await userService.listAssignees())));
userRouter.patch('/me', validate(updateOwnProfileSchema), handler(async (req, res) => {
    const actor = requireActor(req);
    /* Straight through the one update path. The narrow body means there is no role or
     * status to strip, so this needs no special-casing in the service. */
    return ok(res, await userService.update(actor.user.id, bodyOf(req), actor));
}));
userRouter.get('/:id', requirePermission(Permission.USER_READ), validate(userIdSchema), handler(async (req, res) => ok(res, await userService.getById(paramsOf(req).id))));
userRouter.patch('/:id', requirePermission(Permission.USER_MANAGE), validate(updateUserSchema), handler(async (req, res) => ok(res, await userService.update(paramsOf(req).id, bodyOf(req), requireActor(req)))));
