/**
 * ServiceDesk Pro — the user directory, and the one place roles are granted.
 *
 * Changing somebody's role is the only write in this application that hands out
 * privilege, so the page is deliberately plain about it: a modal, the current role next
 * to the new one, a note of what the new role can do, and a confirm. No inline dropdown
 * in a table row that promotes an administrator on a mis-click.
 *
 * Two things this page cannot do, because the server has no endpoint for them:
 *
 *  - **Create a user.** People register themselves; an administrator then grants a role.
 *    There is no "invite" button here, since an invite with no email delivery is a
 *    password an admin has to read out over chat.
 *  - **Change an email or a password.** Email is the login identity, and there is no
 *    verification step that could make a new address provably somebody's.
 *
 * Your own row shows the role and status controls disabled with the reason, rather than
 * hiding them: the server refuses a self-promotion and a self-deactivation, and a control
 * that quietly disappears reads like a bug.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, ShieldCheck, Users, X } from 'lucide-react';
import { Role, UserStatus } from '@shared/enums';
import { ROLE_META, USER_STATUS_META } from '@shared/labels';
import { formatNumber, relativeTime } from '@shared/utils';
import type { UserDto } from '@shared/types';
import { useUpdateUser, useUsers, type UserQuery } from '@/api/users';
import { ApiClientError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useNow } from '@/hooks/useNow';
import { toast } from '@/stores/toast.store';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { RoleBadge, UserStatusBadge } from '@/components/domain/MetaBadge';

const PAGE_SIZE = 20;

const SORTS = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'createdAt', label: 'Newest first' },
  { value: 'assignedTicketCount', label: 'Busiest first' },
] as const;

/** What a pending change is, before it is confirmed. */
type Pending =
  | { user: UserDto; kind: 'role'; role: Role }
  | { user: UserDto; kind: 'status'; status: UserStatus };

export default function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const me = useAuthStore((state) => state.user);
  const [pending, setPending] = useState<Pending | null>(null);

  const query = useMemo<UserQuery>(
    () => ({
      page: Number(params.get('page') ?? 1),
      limit: PAGE_SIZE,
      q: params.get('q') ?? undefined,
      role: (params.get('role') as Role | null) ?? undefined,
      status: (params.get('status') as UserStatus | null) ?? undefined,
      sortBy: (params.get('sortBy') as UserQuery['sortBy']) ?? 'name',
      sortOrder: params.get('sortBy') === 'name' ? 'asc' : 'desc',
    }),
    [params]
  );

  const users = useUsers(query);
  /* Keyed by the row being changed, so the spinner lands on the right button. */
  const update = useUpdateUser(pending?.user.id ?? '');

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const filtered = ['q', 'role', 'status'].some((key) => params.has(key));
  const rows = users.data?.items ?? [];

  const apply = async () => {
    if (!pending) return;
    try {
      await update.mutateAsync(
        pending.kind === 'role' ? { role: pending.role } : { status: pending.status }
      );
      toast.success(
        pending.kind === 'role'
          ? `${pending.user.name} is now ${ROLE_META[pending.role].label.toLowerCase()}.`
          : pending.status === UserStatus.INACTIVE
            ? `${pending.user.name} can no longer sign in.`
            : `${pending.user.name} can sign in again.`
      );
      setPending(null);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'That change could not be saved.');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">People</h1>
        <p className="text-xs text-ink-subtle">
          Everyone who has registered, and what they are allowed to do. Accounts are created by
          signing up — this page grants the role afterwards.
        </p>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-[14rem] flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              const field = event.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
              setParam('q', field?.value.trim() ?? null);
            }}
          >
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden="true"
            />
            <Input
              key={params.get('q') ?? ''}
              name="q"
              defaultValue={params.get('q') ?? ''}
              placeholder="Name or email…"
              className="pl-8"
              aria-label="Search people"
            />
          </form>
          <Select
            aria-label="Sort by"
            value={query.sortBy}
            onChange={(event) => setParam('sortBy', event.target.value)}
            className="w-auto"
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </Select>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
              <X className="h-4 w-4" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {Object.values(Role).map((role) => {
            const on = params.get('role') === role;
            return (
              <button
                key={role}
                type="button"
                className={on ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'}
                aria-pressed={on}
                onClick={() => setParam('role', on ? null : role)}
              >
                {ROLE_META[role].label}
              </button>
            );
          })}
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
          {Object.values(UserStatus).map((status) => {
            const on = params.get('status') === status;
            return (
              <button
                key={status}
                type="button"
                className={on ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'}
                aria-pressed={on}
                onClick={() => setParam('status', on ? null : status)}
              >
                {USER_STATUS_META[status].label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        {users.isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={6} cols={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
            title={filtered ? 'Nobody matches those filters' : 'Nobody has registered yet'}
            message={filtered ? 'Clear the filters to see the whole directory.' : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Open</th>
                  <th scope="col" className="text-right">Assigned</th>
                  <th scope="col">Joined</th>
                  <th scope="col" className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => {
                  const isSelf = user.id === me?.id;
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={user.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {user.name}
                              {isSelf && <span className="ml-1.5 text-2xs text-ink-subtle">(you)</span>}
                            </p>
                            <p className="truncate text-2xs text-ink-subtle">{user.email}</p>
                            {user.jobTitle && <p className="truncate text-2xs text-ink-subtle">{user.jobTitle}</p>}
                          </div>
                        </div>
                      </td>
                      <td><RoleBadge role={user.role} /></td>
                      <td><UserStatusBadge status={user.status} /></td>
                      <td className="text-right tabular-nums">{formatNumber(user.openTicketCount)}</td>
                      <td className="text-right tabular-nums">{formatNumber(user.assignedTicketCount)}</td>
                      <td className="whitespace-nowrap text-xs text-ink-subtle">
                        <time dateTime={user.createdAt}>{relativeTime(user.createdAt, now)}</time>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          {/* Disabled with the reason on your own row: the server refuses
                            * both of these for the account making the request, and that
                            * refusal is what keeps the last administrator from locking
                            * everybody out. */}
                          <Select
                            aria-label={`Role for ${user.name}`}
                            className="w-auto"
                            disabled={isSelf}
                            title={isSelf ? 'Ask another administrator to change your own role.' : undefined}
                            value={user.role}
                            onChange={(event) =>
                              setPending({ user, kind: 'role', role: event.target.value as Role })
                            }
                          >
                            {Object.values(Role).map((role) => (
                              <option key={role} value={role}>
                                {ROLE_META[role].label}
                              </option>
                            ))}
                          </Select>
                          <Button
                            size="sm"
                            variant={user.status === UserStatus.ACTIVE ? 'secondary' : 'primary'}
                            disabled={isSelf}
                            title={isSelf ? 'You cannot deactivate your own account.' : undefined}
                            onClick={() =>
                              setPending({
                                user,
                                kind: 'status',
                                status:
                                  user.status === UserStatus.ACTIVE ? UserStatus.INACTIVE : UserStatus.ACTIVE,
                              })
                            }
                          >
                            {user.status === UserStatus.ACTIVE ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {users.data && (
          <Pagination
            meta={users.data.meta}
            unit="user"
            onPageChange={(page) => setParam('page', String(page))}
          />
        )}
      </Card>

      {/* One modal for both changes. It names what the new role can do, because
        * "Technician" does not tell an administrator that it grants sight of every
        * ticket in the company. */}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.kind === 'role' ? 'Change this person’s role?' : pending?.status === UserStatus.INACTIVE ? 'Deactivate this account?' : 'Reactivate this account?'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={pending?.kind === 'status' && pending.status === UserStatus.INACTIVE ? 'danger' : 'primary'}
              loading={update.isPending}
              onClick={() => void apply()}
            >
              Confirm
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Avatar name={pending.user.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{pending.user.name}</p>
                <p className="truncate text-2xs text-ink-subtle">{pending.user.email}</p>
              </div>
            </div>

            {pending.kind === 'role' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <RoleBadge role={pending.user.role} />
                  <span className="text-ink-subtle" aria-hidden="true">→</span>
                  <RoleBadge role={pending.role} />
                </div>
                <div className="rounded-lg border border-info-border bg-info-bg px-3 py-2 text-xs text-info-fg">
                  <p className="inline-flex items-center gap-1.5 font-medium">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {ROLE_META[pending.role].label}
                  </p>
                  <p className="mt-1">{ROLE_META[pending.role].description}</p>
                </div>
              </div>
            ) : pending.status === UserStatus.INACTIVE ? (
              <p className="text-ink-muted">
                They will be signed out and will not be able to sign in again. Their tickets, comments
                and history are kept exactly as they are.
              </p>
            ) : (
              <p className="text-ink-muted">They will be able to sign in again with their existing password.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
