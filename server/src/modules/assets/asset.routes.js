/**
 * ServiceDesk Pro — asset routes.
 *
 * `GET` needs only `ASSET_READ`, which every role holds, because an employee has to be
 * able to see the laptop they were issued. What they see is narrowed in the service,
 * by filter, not here — see `asset.service.ts`. Writing needs `ASSET_MANAGE`, which
 * only ADMIN holds.
 *
 * There is no `DELETE`: an asset is retired with `PATCH /:id`, because tickets
 * reference it. Same reasoning as categories.
 */
import { Router } from 'express';
import { Permission } from '@shared/enums';
import { authenticate, requireActor, requirePermission, validate } from '@/middleware';
import * as assetService from '@/modules/assets/asset.service';
import { assetIdSchema, createAssetSchema, listAssetsSchema, updateAssetSchema, } from '@/modules/assets/asset.schema';
import { handler } from '@/utils/handler';
import { bodyOf, paramsOf, queryOf } from '@/utils/input';
import { created, ok, paginated } from '@/utils/respond';
export const assetRouter = Router();
assetRouter.use(authenticate());
assetRouter.get('/', requirePermission(Permission.ASSET_READ), validate(listAssetsSchema), handler(async (req, res) => paginated(res, await assetService.list(queryOf(req), requireActor(req)))));
assetRouter.get('/:id', requirePermission(Permission.ASSET_READ), validate(assetIdSchema), handler(async (req, res) => ok(res, await assetService.getById(paramsOf(req).id, requireActor(req)))));
assetRouter.post('/', requirePermission(Permission.ASSET_MANAGE), validate(createAssetSchema), handler(async (req, res) => {
    const asset = await assetService.create(bodyOf(req), requireActor(req));
    return created(res, asset, `/api/assets/${asset.id}`);
}));
assetRouter.patch('/:id', requirePermission(Permission.ASSET_MANAGE), validate(updateAssetSchema), handler(async (req, res) => ok(res, await assetService.update(paramsOf(req).id, bodyOf(req), requireActor(req)))));
