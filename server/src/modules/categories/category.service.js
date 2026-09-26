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
import { logger } from '@/config/logger';
import { Category, toObjectId } from '@/models';
import { diff, record } from '@/modules/audit/audit.service';
import { DuplicateError, assertFound } from '@/utils/errors';
const log = logger.child({ module: 'category.service' });
export function toCategoryDto(category) {
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
export function slugify(name) {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}
export async function ensureDefaultCategories() {
    const count = await Category.countDocuments();
    if (count > 0) return;
    const defaultCategories = [
        {
            name: 'Network & Connectivity',
            slug: 'network',
            description: 'Wi-Fi, VPN, cabling, and anything that will not reach the internet.',
            color: '#2563eb',
            defaultPriority: 'HIGH',
            sortOrder: 10,
            keywords: ['wifi', 'wi-fi', 'vpn', 'internet', 'network', 'ethernet', 'lan', 'router', 'switch', 'dns', 'slow connection', 'cannot connect', 'no internet', 'dropping'],
            active: true,
        },
        {
            name: 'Hardware',
            slug: 'hardware',
            description: 'Laptops, desktops, monitors, docks, keyboards and batteries.',
            color: '#c2410c',
            defaultPriority: 'MEDIUM',
            sortOrder: 20,
            keywords: ['laptop', 'desktop', 'monitor', 'screen', 'keyboard', 'mouse', 'dock', 'battery', 'charger', 'overheating', 'blue screen', 'will not boot', 'fan noise', 'cracked'],
            active: true,
        },
        {
            name: 'Software & Applications',
            slug: 'software',
            description: 'Installs, licences, updates, crashes and Office problems.',
            color: '#7c3aed',
            defaultPriority: 'MEDIUM',
            sortOrder: 30,
            keywords: ['software', 'application', 'excel', 'outlook', 'teams', 'install', 'licence', 'license', 'update', 'crash', 'freezing', 'error message', 'add-in', 'browser'],
            active: true,
        },
        {
            name: 'Accounts & Access',
            slug: 'access',
            description: 'Passwords, lockouts, MFA, shared drives and permissions.',
            color: '#0f766e',
            defaultPriority: 'MEDIUM',
            sortOrder: 40,
            keywords: ['password', 'reset', 'locked out', 'lockout', 'login', 'log in', 'mfa', 'two-factor', 'account', 'access', 'permission', 'shared drive', 'folder', 'sso'],
            active: true,
        },
        {
            name: 'Printing',
            slug: 'printing',
            description: 'Printers, queues, drivers, scanning and consumables.',
            color: '#a16207',
            defaultPriority: 'LOW',
            sortOrder: 50,
            keywords: ['printer', 'print', 'printing', 'scan', 'scanner', 'toner', 'paper jam', 'queue', 'driver', 'duplex'],
            active: true,
        },
        {
            name: 'Email & Communication',
            slug: 'email',
            description: 'Mailboxes, distribution lists, spam and calendar invitations.',
            color: '#be185d',
            defaultPriority: 'MEDIUM',
            sortOrder: 60,
            keywords: ['email', 'mailbox', 'inbox', 'spam', 'phishing', 'calendar', 'invite', 'distribution list', 'signature', 'attachment', 'quota'],
            active: true,
        },
        {
            name: 'General IT Inquiry',
            slug: 'general',
            description: 'General IT assistance and queries.',
            color: '#64748b',
            defaultPriority: 'LOW',
            sortOrder: 70,
            keywords: ['help', 'query', 'question', 'general', 'other'],
            active: true,
        },
    ];
    try {
        await Category.insertMany(defaultCategories);
    } catch {
        // Safe to ignore duplicate or race condition
    }
}
/**
 * `includeInactive` is what separates the admin's table from everyone else's picker.
 * The route decides which to ask for; a non-admin never gets the choice.
 */
export async function list(options) {
    let rows = await Category.find(options.includeInactive ? {} : { active: true }).sort({
        sortOrder: 1,
        name: 1,
    });
    if (rows.length === 0) {
        await ensureDefaultCategories();
        rows = await Category.find(options.includeInactive ? {} : { active: true }).sort({
            sortOrder: 1,
            name: 1,
        });
    }
    return rows.map(toCategoryDto);
}
export async function create(input, actor) {
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
    log.info({ requestId: actor.requestId, categoryId: String(category._id), slug }, 'category created');
    await record({
        action: AuditAction.SETTINGS_UPDATED,
        entityType: AuditEntity.CATEGORY,
        entityId: String(category._id),
        entityLabel: category.name,
        summary: `Added the ${category.name} category`,
    }, actor);
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
];
function auditSnapshot(category) {
    return {
        name: category.name,
        slug: category.slug,
        description: category.description,
        defaultPriority: category.defaultPriority,
        sortOrder: category.sortOrder,
        active: category.active,
    };
}
export async function update(id, input, actor) {
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
    if (input.description !== undefined)
        category.description = input.description;
    if (input.color !== undefined)
        category.color = input.color;
    if (input.defaultPriority !== undefined)
        category.defaultPriority = input.defaultPriority;
    if (input.keywords !== undefined)
        category.keywords = input.keywords;
    if (input.sortOrder !== undefined)
        category.sortOrder = input.sortOrder;
    if (input.active !== undefined)
        category.active = input.active;
    await category.save();
    log.info({ requestId: actor.requestId, categoryId: id }, 'category updated');
    /* `active` is the one that matters here. There is no delete — retiring a category
     * hides it from the new-ticket form while the tickets already filed under it keep
     * their label — so "why can nobody pick Hardware any more" is an audit question. */
    await record({
        action: AuditAction.SETTINGS_UPDATED,
        entityType: AuditEntity.CATEGORY,
        entityId: id,
        entityLabel: category.name,
        summary: `Edited the ${category.name} category`,
        changes: diff(before, auditSnapshot(category), AUDITED_CATEGORY_FIELDS),
    }, actor);
    return toCategoryDto(category);
}
