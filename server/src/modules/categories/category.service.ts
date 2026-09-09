/**
 * ServiceDesk Pro — categories.
 *
 * Reference data, small enough that the whole set is returned unpaginated: the ticket
 * form needs every option in one request, and a helpdesk with more than a few dozen
 * categories has a taxonomy problem rather than a paging problem.
 *
 * Two rules shape the write paths:
 *
 *  - **Deactivate, never delete.** A category is referenced by every ticket ever
 *    raised under it. Removing the row would leave those tickets pointing at nothing;
 *    `active: false` takes it out of the picker while the history stays readable. There
 *    is therefore no delete endpoint at all.
 *  - **`slug` is derived from `name`, and it is the unique key.** Two categories called
 *    "Network" are a data-entry mistake, not a taxonomy, so the unique index refuses
 *    the second one and the duplicate surfaces as a 409 on the `name` field.
 */

import { AuditAction, AuditEntity } from '@shared/enums';
import type { CategoryDto } from '@shared/types';
import type { ActorContext } from '@/core/actor';
import { logger } from '@/config/logger';
import { Category, toObjectId, type CategoryDoc } from '@/models';
import { diff, record } from '@/modules/audit/audit.service';
import { DuplicateError, assertFound } from '@/utils/errors';
import type { CategoryInputBody } from '@/modules/categories/category.schema';

const log = logger.child({ module: 'category.service' });

export function toCategoryDto(category: CategoryDoc): CategoryDto {
  return {
    id: String(category._id),
    name: category.name,
    description: category.description,
    color: category.color,
    defaultPriority: category.defaultPriority,
    keywords: category.keywords,
    sortOrder: category.sortOrder,
    active: category.active,
    ticketCount: category.ticketCount,
  };
}

/**
 * "Network & VPN" → "network-vpn". Deliberately lossy: it is an identifier, not a
 * display value, and `name` is what anybody reads.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * `includeInactive` is what separates the admin's table from everyone else's picker.
 * The route decides which to ask for; a non-admin never gets the choice.
 */
export async function list(options: { includeInactive: boolean }): Promise<CategoryDto[]> {
  const rows = await Category.find(options.includeInactive ? {} : { active: true }).sort({
    sortOrder: 1,
    name: 1,
  });
  return rows.map(toCategoryDto);
}

export async function create(input: CategoryInputBody, actor: ActorContext): Promise<CategoryDto> {
  const slug = slugify(input.name);
  if (await Category.exists({ slug })) {
    throw new DuplicateError('A category with that name already exists.', [
      { path: 'name', message: 'Already in use.' },
    ]);
  }

  const category = await Category.create({
    name: input.name,
    slug,
    description: input.description ?? null,
    ...(input.color ? { color: input.color } : {}),
    ...(input.defaultPriority ? { defaultPriority: input.defaultPriority } : {}),
    ...(input.keywords ? { keywords: input.keywords } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    active: input.active ?? true,
  });

  log.info(
    { requestId: actor.requestId, categoryId: String(category._id), slug },
    'category created'
  );
  await record(
    {
      action: AuditAction.SETTINGS_UPDATED,
      entityType: AuditEntity.CATEGORY,
      entityId: String(category._id),
      entityLabel: category.name,
      summary: `Added the ${category.name} category`,
    },
    actor
  );

  return toCategoryDto(category);
}

/**
 * Renaming re-derives the slug, so the identifier keeps matching the name. The
 * uniqueness check runs again for the new slug, excluding this document — otherwise
 * changing a category's colour would report the category as a duplicate of itself.
 */
const AUDITED_CATEGORY_FIELDS = [
  'name',
  'slug',
  'description',
  'defaultPriority',
  'sortOrder',
  'active',
] as const;

function auditSnapshot(category: CategoryDoc): Record<string, unknown> {
  return {
    name: category.name,
    slug: category.slug,
    description: category.description,
    defaultPriority: category.defaultPriority,
    sortOrder: category.sortOrder,
    active: category.active,
  };
}

export async function update(
  id: string,
  input: Partial<CategoryInputBody>,
  actor: ActorContext
): Promise<CategoryDto> {
  const found = await Category.findById(toObjectId(id));
  const category = assertFound(found, 'Category');
  const before = auditSnapshot(category);

  if (input.name !== undefined && input.name !== category.name) {
    const slug = slugify(input.name);
    if (await Category.exists({ slug, _id: { $ne: category._id } })) {
      throw new DuplicateError('A category with that name already exists.', [
        { path: 'name', message: 'Already in use.' },
      ]);
    }
    category.name = input.name;
    category.slug = slug;
  }

  if (input.description !== undefined) category.description = input.description;
  if (input.color !== undefined) category.color = input.color;
  if (input.defaultPriority !== undefined) category.defaultPriority = input.defaultPriority;
  if (input.keywords !== undefined) category.keywords = input.keywords;
  if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
  if (input.active !== undefined) category.active = input.active;

  await category.save();
  log.info({ requestId: actor.requestId, categoryId: id }, 'category updated');
  /* `active` is the one that matters here. There is no delete — retiring a category
   * hides it from the new-ticket form while the tickets already filed under it keep
   * their label — so "why can nobody pick Hardware any more" is an audit question. */
  await record(
    {
      action: AuditAction.SETTINGS_UPDATED,
      entityType: AuditEntity.CATEGORY,
      entityId: id,
      entityLabel: category.name,
      summary: `Edited the ${category.name} category`,
      changes: diff(before, auditSnapshot(category), AUDITED_CATEGORY_FIELDS),
    },
    actor
  );

  return toCategoryDto(category);
}
