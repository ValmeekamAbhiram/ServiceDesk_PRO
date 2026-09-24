/**
 * ServiceDesk Pro — category request schemas.
 *
 * `slug` and `ticketCount` are absent from both write shapes: the slug is derived from
 * the name by the service, and the count is maintained by the ticket service. Letting
 * a client send either would mean accepting a value the server is responsible for.
 */
import { z } from 'zod';
import { Priority } from '@shared/enums';
import { nullableTextField, objectIdField, queryBoolean, textField } from '@/utils/zod';
/** A CSS hex colour. Validated because it is interpolated into a style attribute. */
const colorField = z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #2563eb');
/**
 * Lower-cased and de-duplicated here, because the offline ticket classifier matches
 * these against a lower-cased title. A keyword list holding both "VPN" and "vpn"
 * would double that term's score for no reason.
 */
const keywordsField = z
    .array(textField(2, 40))
    .max(40)
    .transform((values) => [...new Set(values.map((value) => value.toLowerCase()))]);
const categoryBody = z.object({
    name: textField(2, 120, 'Give the category a name.'),
    description: nullableTextField(500),
    color: colorField.optional(),
    defaultPriority: z.nativeEnum(Priority).optional(),
    keywords: keywordsField.optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
    active: z.boolean().optional(),
});
export const createCategorySchema = { body: categoryBody };
export const updateCategorySchema = {
    params: z.object({ id: objectIdField }),
    body: categoryBody.partial().refine((value) => Object.keys(value).length > 0, {
        message: 'Nothing to update.',
    }),
};
/** Only an admin route passes `includeInactive`; the picker never sees the option. */
export const listCategoriesSchema = {
    query: z.object({ includeInactive: queryBoolean }),
};
