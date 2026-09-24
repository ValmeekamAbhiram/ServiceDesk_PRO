/**
 * ServiceDesk Pro — the ticket queue.
 *
 * Filters live in the URL, not in component state. That is what makes a filtered view
 * shareable, survivable across a refresh, and reachable from a link on the dashboard —
 * and it is why the search box in the top bar can simply navigate here with `?q=`.
 *
 * None of these filters can widen access. The server intersects every one of them with
 * the caller's scope clause under `$and`, so `?requesterId=<somebody else>` returns an
 * empty page rather than their tickets. The `scope` shortcuts exist so the client never
 * has to put its own user id in a query to ask for "mine".
 */
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Filter, Plus, Search, X } from 'lucide-react';
import { Priority, TicketStatus } from '@shared/enums';
import { PRIORITY_META, TICKET_STATUS_META } from '@shared/labels';
import { useTickets } from '@/api/tickets';
import { useCategories } from '@/api/reference';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { TicketRow } from '@/components/domain/TicketRow';
import { useNow } from '@/hooks/useNow';
const PAGE_SIZE = 20;
const SCOPES = [
    { value: 'all', label: 'All I can see' },
    { value: 'mine', label: 'Assigned to me' },
    { value: 'created', label: 'Raised by me' },
    { value: 'unassigned', label: 'Unassigned' },
];
const SORTS = [
    { value: 'createdAt', label: 'Newest first' },
    { value: 'updatedAt', label: 'Recently updated' },
    { value: 'priority', label: 'Priority' },
    { value: 'dueAt', label: 'Resolution deadline' },
    { value: 'number', label: 'Ticket number' },
];
/** The URL is the single source of truth; this reads one query out of it. */
function readQuery(params) {
    const list = (key) => {
        const values = params.getAll(key).flatMap((value) => value.split(',')).filter(Boolean);
        return values.length > 0 ? values : undefined;
    };
    const page = Number(params.get('page') ?? '1');
    return {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: PAGE_SIZE,
        q: params.get('q') ?? undefined,
        status: list('status'),
        priority: list('priority'),
        categoryId: params.get('categoryId') ?? undefined,
        /* Set by the "see all" link on an asset page. There is no control for it in the
         * filter bar — a bare object id is not something anyone types — so the Clear button
         * is how it is removed. */
        assetId: params.get('assetId') ?? undefined,
        scope: params.get('scope') ?? undefined,
        breached: params.get('breached') === 'true' ? true : undefined,
        sortBy: params.get('sortBy') ?? 'createdAt',
        /* Descending suits four of the five: newest, most recently touched, most urgent
         * (`priorityRank` counts up to URGENT) and highest number. A resolution deadline is
         * the exception — the soonest one is the one that matters. */
        sortOrder: params.get('sortBy') === 'dueAt' ? 'asc' : 'desc',
    };
}
export default function TicketList() {
    const [params, setParams] = useSearchParams();
    const query = useMemo(() => readQuery(params), [params]);
    const now = useNow();
    const list = useTickets(query);
    const categories = useCategories();
    /**
     * Every filter change resets to page one. Staying on page seven after narrowing a
     * search is how people end up looking at an empty table and concluding there are no
     * results.
     */
    const setParam = (key, value) => {
        const next = new URLSearchParams(params);
        if (value === null || value === '')
            next.delete(key);
        else
            next.set(key, value);
        if (key !== 'page')
            next.delete('page');
        setParams(next, { replace: true });
    };
    const toggleMulti = (key, value) => {
        const next = new URLSearchParams(params);
        const current = next.getAll(key).flatMap((item) => item.split(',')).filter(Boolean);
        const after = current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value];
        next.delete(key);
        for (const item of after)
            next.append(key, item);
        next.delete('page');
        setParams(next, { replace: true });
    };
    const active = (query.status?.length ?? 0) +
        (query.priority?.length ?? 0) +
        (query.q ? 1 : 0) +
        (query.categoryId ? 1 : 0) +
        (query.assetId ? 1 : 0) +
        (query.breached ? 1 : 0) +
        (query.scope && query.scope !== 'all' ? 1 : 0);
    const items = list.data?.items ?? [];
    const meta = list.data?.meta;
    return (<div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Tickets</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {meta ? `${meta.total} ticket${meta.total === 1 ? '' : 's'}` : 'Loading…'}
            {active > 0 && ` · ${active} filter${active === 1 ? '' : 's'} applied`}
          </p>
        </div>
        <Link to="/tickets/new" className="btn btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true"/>
          New ticket
        </Link>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true"/>
            <Input type="search" defaultValue={query.q ?? ''} placeholder="Search number, subject or description…" aria-label="Search tickets" className="pl-8" 
    /* On submit rather than on change: the server runs a text search and one
     * request per keystroke would be a request per keystroke. */
    onKeyDown={(event) => {
            if (event.key === 'Enter')
                setParam('q', event.currentTarget.value.trim() || null);
        }}/>
          </div>

          <Select aria-label="Scope" value={query.scope ?? 'all'} onChange={(event) => setParam('scope', event.target.value === 'all' ? null : event.target.value)} className="w-auto">
            {SCOPES.map((scope) => (<option key={scope.value} value={scope.value}>
                {scope.label}
              </option>))}
          </Select>

          <Select aria-label="Category" value={query.categoryId ?? ''} onChange={(event) => setParam('categoryId', event.target.value || null)} className="w-auto">
            <option value="">Any category</option>
            {(categories.data ?? []).map((category) => (<option key={category.id} value={category.id}>
                {category.name}
              </option>))}
          </Select>

          <Select aria-label="Sort by" value={query.sortBy ?? 'createdAt'} onChange={(event) => setParam('sortBy', event.target.value)} className="w-auto">
            {SORTS.map((sort) => (<option key={sort.value} value={sort.value}>
                {sort.label}
              </option>))}
          </Select>

          {active > 0 && (<button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              <X className="h-3.5 w-3.5" aria-hidden="true"/>
              Clear
            </button>)}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true"/>
          {Object.values(TicketStatus).map((status) => {
            const on = query.status?.includes(status) ?? false;
            return (<button key={status} type="button" aria-pressed={on} className={on ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'} onClick={() => toggleMulti('status', status)}>
                {TICKET_STATUS_META[status].label}
              </button>);
        })}

          <span className="mx-1 h-4 w-px bg-line" aria-hidden="true"/>

          {Object.values(Priority).map((priority) => {
            const on = query.priority?.includes(priority) ?? false;
            return (<button key={priority} type="button" aria-pressed={on} className={on ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'} onClick={() => toggleMulti('priority', priority)}>
                {PRIORITY_META[priority].label}
              </button>);
        })}

          <span className="mx-1 h-4 w-px bg-line" aria-hidden="true"/>

          <button type="button" aria-pressed={query.breached ?? false} className={query.breached ? 'chip border-danger-border bg-danger-bg text-danger-fg' : 'chip'} onClick={() => setParam('breached', query.breached ? null : 'true')}>
            Breached
          </button>
        </div>
      </Card>

      <Card>
        {list.isLoading ? (<div className="p-4">
            <SkeletonRows rows={8} cols={6}/>
          </div>) : items.length === 0 ? (<EmptyState title={active > 0 ? 'No tickets match these filters' : 'No tickets yet'} message={active > 0
                ? 'Try widening the search, or clear the filters to see everything you have access to.'
                : 'When somebody raises a ticket it will appear here.'} action={active > 0 ? (<button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  Clear filters
                </button>) : (<Link to="/tickets/new" className="btn btn-primary btn-sm">
                  Raise the first one
                </Link>)}/>) : (<>
            <div className="overflow-x-auto">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Requester</th>
                    <th>Assignee</th>
                    <th>Resolve by</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((ticket) => (<TicketRow key={ticket.id} ticket={ticket} now={now}/>))}
                </tbody>
              </table>
            </div>

            {meta && (<Pagination meta={meta} unit="ticket" onPageChange={(page) => setParam('page', String(page))}/>)}
          </>)}
      </Card>
    </div>);
}
