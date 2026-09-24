/**
 * ServiceDesk Pro — user administration request schemas.
 *
 * `email` and `password` appear in neither shape, and that is the design rather than an
 * omission:
 *
 *  - **Email is the login identity.** Letting an administrator rewrite it turns "change
 *    a colleague's job title" into "take over their account", and there is no
 *    verification step here to make the new address provably theirs.
 *  - **There is no create-user endpoint at all.** People sign themselves up through
 *    `POST /api/auth/register`; an administrator then grants the role. The alternative
 *    means an admin choosing someone else's password and finding a way to tell them what
 *    it is — with no email delivery in this build, that way is a chat message, which is
 *    worse than the problem it solves. It also keeps password hashing on exactly one
 *    code path.
 *
 * So the only write here is a patch, and what it may touch is: name, role, status, job
 * title, phone.
 */
import { z } from 'zod';
import { Role, UserStatus } from '@shared/enums';
import { nullableTextField, objectIdField, queryLimit, queryPage, querySearch, textField, } from '@/utils/zod';
export const updateUserSchema = {
    params: z.object({ id: objectIdField }),
    body: z
        .object({
        name: textField(2, 120).optional(),
        role: z.nativeEnum(Role).optional(),
        status: z.nativeEnum(UserStatus).optional(),
        jobTitle: nullableTextField(120),
        phone: nullableTextField(40),
    })
        .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' }),
};
/**
 * The self-service shape, for `PATCH /users/me`.
 *
 * It is a separate schema rather than a reuse of `updateUserSchema` with a check bolted
 * on, because the safest way to stop somebody promoting themselves is for the route not
 * to accept the word `role` at all. `assertNotSelfPrivilegeChange` in the service is the
 * belt to this braces: it catches an admin editing their own record through `/:id`.
 */
export const updateOwnProfileSchema = {
    body: z
        .object({
        name: textField(2, 120).optional(),
        jobTitle: nullableTextField(120),
        phone: nullableTextField(40),
    })
        .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' }),
};
const USER_SORT_FIELDS = ['name', 'createdAt', 'assignedTicketCount'];
export const listUsersSchema = {
    query: z.object({
        page: queryPage,
        limit: queryLimit,
        q: querySearch,
        role: z.nativeEnum(Role).optional(),
        status: z.nativeEnum(UserStatus).optional(),
        /* A directory, so alphabetical — the same reasoning as the asset list. */
        sortBy: z.enum(USER_SORT_FIELDS).default('name'),
        sortOrder: z.enum(['asc', 'desc']).default('asc'),
    }),
};
export const userIdSchema = { params: z.object({ id: objectIdField }) };
