/**
 * ServiceDesk Pro — user administration.
 *
 * ## The one invariant: there is always at least one active administrator
 *
 * It is enforced with a rule that is much simpler than counting admins, and which
 * happens to be the right rule on its own merits: **nobody may change their own role or
 * their own status.** Only an administrator can reach these writes at all, so after any
 * successful write the administrator who made it is still an active administrator. The
 * set of active admins therefore cannot be emptied, and no query is needed to prove it.
 *
 * Counting instead — "refuse if this would leave zero admins" — would need a count
 * inside the same operation to be correct under concurrency, and would still allow the
 * last admin to lock themselves out of everything else while remaining nominally an
 * admin. The self-edit ban is one comparison and needs no transaction. A second
 * administrator can always demote the first; what nobody can do is demote themselves.
 *
 * ## Deactivating is not deleting, and does not revoke anything
 *
 * `status: INACTIVE` is the off switch, because tickets, comments and assets all
 * reference the user and deleting the row would leave that history pointing at nothing.
 * There is no session revocation here on purpose: `authenticate()` re-reads the user on
 * every single request and refuses anyone who is not ACTIVE, and `login()` refuses them
 * too. That is strictly stronger than revoking the sessions that happen to exist right
 * now — it also covers the ones they would create next.
 *
 * ## Reading is not admin-only
 *
 * `USER_READ` belongs to technicians as well, because assigning a ticket means choosing
 * from a list of people. `USER_MANAGE` — the writes — is ADMIN alone. Both come from
 * `ROLE_PERMISSIONS`; neither is decided here.
 */

import type { FilterQuery, SortOrder } from 'mongoose';
import { AuditAction, AuditEntity, STAFF_ROLES, UserStatus } from '@shared/enums';
import type { Paginated, UserDto } from '@shared/types';
import { logger } from '@/config/logger';
import { isSelf, type ActorContext } from '@/core/actor';
import { User, toObjectId, type UserDoc } from '@/models';
import { diff, record } from '@/modules/audit/audit.service';
import { toUserDto } from '@/modules/users/user.mapper';
import { ForbiddenError, assertFound } from '@/utils/errors';
import { resolvePaging, toPaginated } from '@/utils/respond';
import type { ListUsersInput, UpdateUserInput } from '@/modules/users/user.schema';

const log = logger.child({ module: 'user.service' });

/** Never `passwordHash`. It is `select: false` on the schema; this is belt and braces. */
const USER_FIELDS =
  'name email role status jobTitle phone openTicketCount assignedTicketCount createdAt version';

const SORT_FIELDS: Record<ListUsersInput['sortBy'], string> = {
  name: 'name',
  createdAt: 'createdAt',
  assignedTicketCount: 'assignedTicketCount',
};

export async function list(query: ListUsersInput): Promise<Paginated<UserDto>> {
  const { page, limit, skip } = resolvePaging(query);

  const filter: FilterQuery<UserDoc> = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  /* The text index covers name and email, so searching for a fragment of either works
   * without a regex — and without the escaping problem a regex over user input brings. */
  if (query.q) filter.$text = { $search: query.q };

  const direction: SortOrder = query.sortOrder === 'asc' ? 1 : -1;
  const sort: Record<string, SortOrder | { $meta: 'textScore' }> = query.q
    ? { score: { $meta: 'textScore' }, _id: -1 }
    : { [SORT_FIELDS[query.sortBy]]: direction, _id: direction };

  const cursor = User.find(filter).select(USER_FIELDS).sort(sort as never).skip(skip).limit(limit);
  const [rows, total] = await Promise.all([cursor.exec(), User.countDocuments(filter)]);

  return toPaginated(rows.map(toUserDto), page, limit, total);
}

export async function getById(id: string): Promise<UserDto> {
  const found = await User.findById(toObjectId(id)).select(USER_FIELDS);
  return toUserDto(assertFound(found, 'User'));
}

/**
 * The self-edit ban from the header. Name, job title and phone are fine to change on
 * your own record; role and status are not, and those two are the ones that could lock
 * everybody out.
 */
function assertNotSelfPrivilegeChange(id: string, input: UpdateUserInput, actor: ActorContext): void {
  if (!isSelf(actor, id)) return;
  if (input.role !== undefined && input.role !== actor.user.role) {
    throw new ForbiddenError('You cannot change your own role. Ask another administrator.');
  }
  if (input.status !== undefined && input.status !== UserStatus.ACTIVE) {
    throw new ForbiddenError('You cannot deactivate your own account.');
  }
}

/**
 * `email` is absent because nothing here can change it, and `passwordHash` is absent
 * because `diff()` would refuse it anyway — see `SECRET_FIELD` in the audit service.
 * The email still reaches the entry as `entityLabel`, which is what makes a row
 * readable after the account it refers to has been renamed.
 */
const AUDITED_USER_FIELDS = ['name', 'role', 'status', 'jobTitle', 'phone'] as const;

function auditSnapshot(user: UserDoc): Record<string, unknown> {
  return {
    name: user.name,
    role: user.role,
    status: user.status,
    jobTitle: user.jobTitle,
    phone: user.phone,
  };
}

export async function update(
  id: string,
  input: UpdateUserInput,
  actor: ActorContext
): Promise<UserDto> {
  assertNotSelfPrivilegeChange(id, input, actor);

  const found = await User.findById(toObjectId(id)).select(USER_FIELDS);
  const user = assertFound(found, 'User');

  const previousRole = user.role;
  const before = auditSnapshot(user);
  if (input.name !== undefined) user.name = input.name;
  if (input.role !== undefined) user.role = input.role;
  if (input.status !== undefined) user.status = input.status;
  if (input.jobTitle !== undefined) user.jobTitle = input.jobTitle;
  if (input.phone !== undefined) user.phone = input.phone;

  await user.save();

  /* Role changes are logged with both ends of the change. This is the one write in the
   * application that hands out privilege, so "who was made an admin, and when" needs to
   * be answerable from the log even before the audit trail exists. No token, password or
   * other secret goes in here — only ids and roles. */
  if (input.role !== undefined && input.role !== previousRole) {
    log.warn(
      {
        requestId: actor.requestId,
        userId: id,
        from: previousRole,
        to: input.role,
        byUserId: actor.user.id,
      },
      'user role changed'
    );
  } else {
    log.info({ requestId: actor.requestId, userId: id }, 'user updated');
  }

  /* One entry per edit, not one per field: a request that renames somebody *and* makes
   * them a technician is a single administrative decision, and splitting it into two
   * rows would let a reader mistake it for two. `ROLE_CHANGED` wins when the role moved
   * because that is the entry anyone auditing privilege will filter for. */
  const roleChanged = input.role !== undefined && input.role !== previousRole;
  await record(
    {
      action: roleChanged ? AuditAction.ROLE_CHANGED : AuditAction.USER_UPDATED,
      entityType: AuditEntity.USER,
      entityId: id,
      entityLabel: user.email,
      summary: roleChanged
        ? `Changed ${user.name}'s role from ${previousRole} to ${user.role}`
        : `Edited ${user.name}'s account`,
      changes: diff(before, auditSnapshot(user), AUDITED_USER_FIELDS),
    },
    actor
  );

  return toUserDto(user);
}

/**
 * The technicians a ticket can be assigned to. `GET /api/users?role=TECHNICIAN` answers
 * the same question, but an assignee picker wants every technician in one response
 * rather than a page of them, and it wants only the active ones.
 */
export async function listAssignees(): Promise<UserDto[]> {
  const rows = await User.find({
    role: { $in: STAFF_ROLES },
    status: UserStatus.ACTIVE,
  })
    .select(USER_FIELDS)
    .sort({ assignedTicketCount: 1, name: 1 });
  return rows.map(toUserDto);
}
