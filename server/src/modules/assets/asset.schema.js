/**
 * ServiceDesk Pro — asset request schemas.
 *
 * Three things here are worth more than a glance:
 *
 *  - **`serialNumber` normalises `''` to `null`.** The unique index is partial, on
 *    `{ serialNumber: { $type: 'string' } }`, so a stored empty string *is* a value
 *    and the second cable tray submitted with a blank serial box would collide with
 *    the first. `nullableTextField` does that conversion, which is exactly why it
 *    exists.
 *  - **`version` is required on update and absent from create.** Assets are edited by
 *    admins from a form that was loaded some time ago; without the token, the slower
 *    of two people editing the same laptop silently wins. Create has nothing to
 *    conflict with.
 *  - **The list defaults to `name` ascending**, unlike tickets, which default to
 *    newest first. A ticket queue is a feed and a hardware inventory is a directory;
 *    "Z first" is not a useful default for a directory.
 */
import { z } from 'zod';
import { ASSET_STATUSES, ASSET_TYPES, AssetStatus, AssetType } from '@shared/enums';
import { nullableTextField, objectIdField, queryEnumList, queryLimit, queryPage, querySearch, textField, } from '@/utils/zod';
/** `null` unassigns; omitted leaves the current holder alone. */
const optionalUserRef = objectIdField.nullable().optional();
const assetBody = z.object({
    name: textField(2, 160, 'Give the asset a name.'),
    type: z.nativeEnum(AssetType),
    status: z.nativeEnum(AssetStatus).optional(),
    serialNumber: nullableTextField(120),
    manufacturer: nullableTextField(80),
    model: nullableTextField(120),
    location: nullableTextField(120),
    assignedToId: optionalUserRef,
    purchaseDate: z.coerce.date().nullable().optional(),
    /* An integer count of the smallest currency unit would be better, but the DTO says
     * `number` and a purchase price is not arithmetic anyone bills from. */
    purchaseCost: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
    warrantyExpiryDate: z.coerce.date().nullable().optional(),
    notes: nullableTextField(2000),
});
export const createAssetSchema = { body: assetBody };
export const updateAssetSchema = {
    params: z.object({ id: objectIdField }),
    body: assetBody
        .partial()
        .extend({ version: z.coerce.number().int().min(0) })
        .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
        message: 'Nothing to update.',
    }),
};
export const assetIdSchema = { params: z.object({ id: objectIdField }) };
const ASSET_SORT_FIELDS = ['name', 'tag', 'createdAt', 'warrantyExpiryDate'];
export const listAssetsSchema = {
    query: z.object({
        page: queryPage,
        limit: queryLimit,
        q: querySearch,
        type: queryEnumList(ASSET_TYPES),
        status: queryEnumList(ASSET_STATUSES),
        assignedToId: objectIdField.optional(),
        /**
         * The warranty radar. `0` is meaningful — "already expired" — so the lower bound
         * is 0 and the field is only absent when nobody asked.
         */
        warrantyWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
        sortBy: z.enum(ASSET_SORT_FIELDS).default('name'),
        sortOrder: z.enum(['asc', 'desc']).default('asc'),
    }),
};
