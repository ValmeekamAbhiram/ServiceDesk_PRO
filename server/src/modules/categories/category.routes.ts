/**
 * ServiceDesk Pro — category routes.
 *
 * `GET /` is open to any signed-in user because the ticket form cannot work without
 * it. `includeInactive` is only honoured for a caller holding `settings:manage`, so an
 * employee's picker shows current categories and an admin's table shows retired ones
 * too — one endpoint, and the privilege decides the rows rather than the query string.
 *
 * There is no `DELETE`: categories are deactivated. See `category.service.ts`.
 */

import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission, validate } from '@/middleware';
import * as categoryService from '@/modules/categories/category.service';
import {
  createCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
  type CategoryInputBody,
  type ListCategoriesInput,
} from '@/modules/categories/category.schema';
import { can } from '@/core/actor';
import { handler } from '@/utils/handler';
import { bodyOf, paramsOf, queryOf } from '@/utils/input';
import { created, ok } from '@/utils/respond';

export const categoryRouter = Router();

categoryRouter.use(authenticate());

categoryRouter.get(
  '/',
  validate(listCategoriesSchema),
  handler(async (req, res) => {
    const actor = requireActor(req);
    const asked = queryOf<ListCategoriesInput>(req).includeInactive === true;
    return ok(
      res,
      await categoryService.list({
        includeInactive: asked && can(actor, Permission.SETTINGS_MANAGE),
      })
    );
  })
);

categoryRouter.post(
  '/',
  requirePermission(Permission.SETTINGS_MANAGE),
  validate(createCategorySchema),
  handler(async (req, res) =>
    created(res, await categoryService.create(bodyOf<CategoryInputBody>(req), requireActor(req)))
  )
);

categoryRouter.patch(
  '/:id',
  requirePermission(Permission.SETTINGS_MANAGE),
  validate(updateCategorySchema),
  handler(async (req, res) =>
    ok(
      res,
      await categoryService.update(
        paramsOf<{ id: string }>(req).id,
        bodyOf<Partial<CategoryInputBody>>(req),
        requireActor(req)
      )
    )
  )
);
