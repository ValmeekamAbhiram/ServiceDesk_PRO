/**
 * ServiceDesk Pro — the asset register.
 *
 * Same shape as the ticket queue and for the same reasons: filters in the URL so a view
 * is shareable, and no filter here can widen access. An employee sees the kit assigned
 * to them because the server narrows the query, not because this page asks it to.
 *
 * The warranty filter is a single number — "expiring inside N days" — because
 * `warrantyDaysRemaining` goes negative once a warranty has lapsed, so one comparison
 * covers both "about to expire" and "expired months ago".
 */

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, ShieldAlert, X } from 'lucide-react';
import { AssetStatus, AssetType, Permission } from '@shared/enums';
import { ASSET_STATUS_META, ASSET_TYPE_META } from '@shared/labels';
import { useAssets, type AssetQuery } from '@/api/assets';
import { useAuthStore } from '@/stores/auth.store';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { AssetStatusBadge, AssetTypeBadge } from '@/components/domain/MetaBadge';
import { WarrantyChip } from '@/components/domain/WarrantyChip';

const PAGE_SIZE = 20;

const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'tag', label: 'Asset tag' },
  { value: 'createdAt', label: 'Newest first' },
  { value: 'warrantyExpiryDate', label: 'Warranty expiry' },
] as const;

/** Offered as a shortcut so the common question — "what lapses this quarter?" — is one click. */
const WARRANTY_WINDOWS = [
  { value: '', label: 'Any warranty' },
  { value: '0', label: 'Already expired' },
  { value: '30', label: 'Expiring in 30 days' },
  { value: '90', label: 'Expiring in 90 days' },
] as const;

export default function AssetList() {
  const [params, setParams] = useSearchParams();
  const canManage = useAuthStore((state) => state.can(Permission.ASSET_MANAGE));

  const query = useMemo<AssetQuery>(() => {
    const types = params.getAll('type') as AssetType[];
    const statuses = params.getAll('status') as AssetStatus[];
    const within = params.get('warrantyWithinDays');
    return {
      page: Number(params.get('page') ?? 1),
      limit: PAGE_SIZE,
      q: params.get('q') ?? undefined,
      type: types.length > 0 ? types : undefined,
      status: statuses.length > 0 ? statuses : undefined,
      warrantyWithinDays: within === null || within === '' ? undefined : Number(within),
      sortBy: (params.get('sortBy') as AssetQuery['sortBy']) ?? 'name',
      /* Names and tags read best A–Z; a date sort wants the nearest first, which for an
       * expiry is also ascending. Only "newest first" inverts. */
      sortOrder: params.get('sortBy') === 'createdAt' ? 'desc' : 'asc',
    };
  }, [params]);

  const assets = useAssets(query);

  /* Any change but paging resets to page one — narrowing a filter while parked on page
   * seven is how people end up staring at an empty table. */
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const toggleMulti = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    const current = next.getAll(key);
    next.delete(key);
    for (const kept of current.filter((entry) => entry !== value)) next.append(key, kept);
    if (!current.includes(value)) next.append(key, value);
    next.delete('page');
    setParams(next, { replace: true });
  };

  const filtered = ['q', 'type', 'status', 'warrantyWithinDays'].some((key) => params.has(key));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-ink">Assets</h1>
          <p className="text-xs text-ink-subtle">
            Company hardware, who has it, and when its warranty runs out.
          </p>
        </div>
        {canManage && (
          <Link to="/assets/new" className="btn btn-primary btn-sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add an asset
          </Link>
        )}
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
            {/* `key` on the default value so a cleared `?q=` actually empties the box. */}
            <Input
              key={params.get('q') ?? ''}
              name="q"
              defaultValue={params.get('q') ?? ''}
              placeholder="Tag, name, serial number…"
              className="pl-8"
              aria-label="Search assets"
            />
          </form>
          <Select
            aria-label="Warranty"
            value={params.get('warrantyWithinDays') ?? ''}
            onChange={(event) => setParam('warrantyWithinDays', event.target.value)}
            className="w-auto"
          >
            {WARRANTY_WINDOWS.map((window) => (
              <option key={window.value} value={window.value}>
                {window.label}
              </option>
            ))}
          </Select>
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

        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.values(AssetStatus).map((status) => {
            const on = params.getAll('status').includes(status);
            return (
              <button
                key={status}
                type="button"
                className={on ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'}
                aria-pressed={on}
                onClick={() => toggleMulti('status', status)}
              >
                {ASSET_STATUS_META[status].label}
              </button>
            );
          })}
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
          {Object.values(AssetType).map((type) => {
            const on = params.getAll('type').includes(type);
            return (
              <button
                key={type}
                type="button"
                className={on ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'}
                aria-pressed={on}
                onClick={() => toggleMulti('type', type)}
              >
                {ASSET_TYPE_META[type].label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        {assets.isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={6} cols={5} />
          </div>
        ) : (assets.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
            title={filtered ? 'Nothing matches those filters' : 'No assets yet'}
            message={
              filtered
                ? 'Widen the search, or clear the filters to see everything you can.'
                : 'Once hardware is registered here it can be linked to tickets.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assigned to</th>
                  <th scope="col">Warranty</th>
                  <th scope="col" className="text-right">
                    Tickets
                  </th>
                </tr>
              </thead>
              <tbody>
                {(assets.data?.items ?? []).map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <Link to={`/assets/${asset.id}`} className="block min-w-0">
                        <span className="tabular block text-2xs text-ink-subtle">{asset.tag}</span>
                        <span className="link block truncate font-medium">{asset.name}</span>
                      </Link>
                    </td>
                    <td>
                      <AssetTypeBadge type={asset.type} />
                    </td>
                    <td>
                      <AssetStatusBadge status={asset.status} />
                    </td>
                    <td className="text-xs text-ink-muted">{asset.assignedTo?.name ?? '—'}</td>
                    <td>
                      <WarrantyChip asset={asset} />
                    </td>
                    <td className="tabular text-right text-xs text-ink-muted">
                      {asset.openTicketCount > 0 ? (
                        <span className="font-semibold text-ink">{asset.openTicketCount} open</span>
                      ) : (
                        asset.ticketCount
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {assets.data && (
          <Pagination
            meta={assets.data.meta}
            unit="asset"
            onPageChange={(page) => setParam('page', String(page))}
          />
        )}
      </Card>
    </div>
  );
}
