/**
 * ServiceDesk Pro — one asset.
 *
 * The ticket history is a real query against `?assetId=`, not the denormalised counters
 * on the asset. The counters exist so a list row can show "2 open" without a lookup per
 * row; here there is one asset and the actual tickets are what somebody came to read —
 * and the ticket endpoint applies the caller's read scope, so an employee looking at a
 * shared printer sees their own tickets against it and not their colleagues'.
 *
 * "Raise a ticket about this" carries the asset id through to the new-ticket form as a
 * query parameter, which is the only piece of state that needs to survive the hop.
 */
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Clock3, Pencil, Plus, ShieldCheck, Ticket } from 'lucide-react';
import { Permission } from '@shared/enums';
import { formatCurrency, relativeTime } from '@shared/utils';
import { useAsset } from '@/api/assets';
import { useTickets } from '@/api/tickets';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { AssetStatusBadge, AssetTypeBadge } from '@/components/domain/MetaBadge';
import { TicketRow } from '@/components/domain/TicketRow';
import { WarrantyChip } from '@/components/domain/WarrantyChip';
import { useNow } from '@/hooks/useNow';
function Row({ label, children }) {
    return (<div className="grid grid-cols-[minmax(6.5rem,0.8fr)_minmax(0,1.2fr)] items-start gap-3 py-2">
      <dt className="shrink-0 text-xs text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-ink">{children}</dd>
    </div>);
}
/** A date without a time: a purchase date has no useful hour attached to it. */
const asDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
export default function AssetDetail() {
    const { id } = useParams();
    const now = useNow();
    const asset = useAsset(id);
    const canManage = useAuthStore((state) => state.can(Permission.ASSET_MANAGE));
    const tickets = useTickets({
        page: 1,
        limit: 10,
        assetId: id,
        sortBy: 'createdAt',
        sortOrder: 'desc',
    });
    if (asset.isLoading) {
        return (<div className="space-y-5" aria-label="Loading asset">
        <Skeleton className="h-28 w-full"/>
        <div className="grid gap-5 sm:grid-cols-3">
          <Skeleton className="h-24 w-full"/>
          <Skeleton className="h-24 w-full"/>
          <Skeleton className="h-24 w-full"/>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-72 w-full"/>
          <Skeleton className="h-80 w-full"/>
        </div>
      </div>);
    }
    if (asset.isError || !asset.data) {
        return (<EmptyState icon={<AlertTriangle className="h-5 w-5" aria-hidden="true"/>} title="That asset is not here" message="It may have been removed, or it may not be one you can see." action={<Link to="/assets" className="btn btn-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true"/>
            Back to assets
          </Link>}/>);
    }
    const data = asset.data;
    return (<div className="space-y-5">
      <header className="rounded-card border border-line bg-surface px-4 py-4 shadow-card sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Link to="/assets" className="btn btn-ghost btn-sm self-start">
            <ArrowLeft className="h-4 w-4" aria-hidden="true"/>
            Assets
          </Link>
          <div className="min-w-0 flex-1 sm:border-l sm:border-line sm:pl-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-surface-sunken px-2 py-1 font-mono text-xs font-semibold text-ink-muted">
                {data.tag}
              </span>
              <AssetStatusBadge status={data.status}/>
            </div>
            <h1 className="mt-2 break-words text-xl font-semibold leading-tight text-ink sm:text-2xl">
              {data.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AssetTypeBadge type={data.type}/>
              <WarrantyChip asset={data}/>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            <Link to={`/tickets/new?assetId=${data.id}`} className="btn btn-secondary btn-sm flex-1 sm:flex-none">
              <Plus className="h-4 w-4" aria-hidden="true"/>
              Raise a ticket
            </Link>
            {canManage && (<Link to={`/assets/${data.id}/edit`} className="btn btn-ghost btn-sm flex-1 sm:flex-none">
                <Pencil className="h-4 w-4" aria-hidden="true"/>
                Edit
              </Link>)}
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Asset summary">
        <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-card">
          <div className="flex items-center gap-2 text-ink-subtle">
            <Ticket className="h-4 w-4" aria-hidden="true"/>
            <span className="text-2xs font-semibold uppercase tracking-wider">Open tickets</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-ink">{data.openTicketCount}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">{data.ticketCount} total linked</p>
        </div>
        <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-card">
          <div className="flex items-center gap-2 text-ink-subtle">
            <ShieldCheck className="h-4 w-4" aria-hidden="true"/>
            <span className="text-2xs font-semibold uppercase tracking-wider">Warranty</span>
          </div>
          <div className="mt-2"><WarrantyChip asset={data}/></div>
          <p className="mt-1 text-xs text-ink-subtle">Until {asDate(data.warrantyExpiryDate)}</p>
        </div>
        <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-card">
          <div className="flex items-center gap-2 text-ink-subtle">
            <Clock3 className="h-4 w-4" aria-hidden="true"/>
            <span className="text-2xs font-semibold uppercase tracking-wider">Last updated</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-ink">{relativeTime(data.updatedAt, now)}</p>
          <p className="mt-1 truncate text-xs text-ink-subtle">{data.assignedTo?.name ?? 'Unassigned'}</p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader title="Ticket history" subtitle={data.openTicketCount > 0
            ? `${data.openTicketCount} still open of ${data.ticketCount}`
            : `${data.ticketCount} in total`} action={data.ticketCount > 0 ? (<Link to={`/tickets?assetId=${data.id}`} className="link text-xs">
                  See all
                </Link>) : undefined}/>
          <CardBody className="p-0">
            {tickets.isLoading ? (<div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full"/>
                <Skeleton className="h-10 w-full"/>
                <Skeleton className="h-10 w-full"/>
              </div>) : tickets.isError ? (<EmptyState icon={<Ticket className="h-5 w-5" aria-hidden="true"/>} title="Ticket history unavailable" message="Linked tickets could not be loaded. The asset details are still available." className="py-9" action={<Button variant="secondary" size="sm" onClick={() => void tickets.refetch()}>
                    Try again
                  </Button>}/>) : (tickets.data?.items.length ?? 0) === 0 ? (<EmptyState icon={<Ticket className="h-5 w-5" aria-hidden="true"/>} title="No linked tickets" message="Nothing has been reported against this asset." className="py-9" action={<Link to={`/tickets/new?assetId=${data.id}`} className="btn btn-secondary btn-sm">
                    <Plus className="h-4 w-4" aria-hidden="true"/>
                    Raise a ticket
                  </Link>}/>) : (<div className="overflow-x-auto">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th scope="col">Ticket</th>
                      <th scope="col">Subject</th>
                      <th scope="col">Status</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Assignee</th>
                      <th scope="col">Resolve by</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tickets.data?.items ?? []).map((ticket) => (
            /* The requester column is dropped: on an asset page the
               interesting question is who is fixing it, not who reported it. */
            <TicketRow key={ticket.id} ticket={ticket} now={now} showRequester={false}/>))}
                  </tbody>
                </table>
              </div>)}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details"/>
            <CardBody>
              <dl className="divide-y divide-line">
                <Row label="Assigned to">{data.assignedTo?.name ?? 'Nobody'}</Row>
                <Row label="Manufacturer">{data.manufacturer ?? '—'}</Row>
                <Row label="Model">{data.model ?? '—'}</Row>
                <Row label="Serial number">
                  <span className="tabular">{data.serialNumber ?? '—'}</span>
                </Row>
                <Row label="Location">{data.location ?? '—'}</Row>
                <Row label="Purchased">{asDate(data.purchaseDate)}</Row>
                {/* `formatCurrency` already renders an em dash for null. */}
                <Row label="Cost">{formatCurrency(data.purchaseCost)}</Row>
                <Row label="Warranty until">{asDate(data.warrantyExpiryDate)}</Row>
                <Row label="Added">
                  <time dateTime={data.createdAt}>{relativeTime(data.createdAt, now)}</time>
                </Row>
              </dl>
            </CardBody>
          </Card>

          {data.notes && (<Card>
              <CardHeader title="Notes"/>
              <CardBody>
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{data.notes}</p>
              </CardBody>
            </Card>)}
        </div>
      </div>
    </div>);
}
