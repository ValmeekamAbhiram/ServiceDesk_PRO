/**
 * ServiceDesk Pro — the dashboard.
 *
 * Everything on this page comes from one request, and the request is scoped to the
 * caller server-side. There is no client-side scope switch, role inference, or
 * synthetic data. Summary callouts below are arithmetic over the returned DTO only.
 */

import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { KpiDto, TimeSeriesPointDto } from '@shared/types';
import { formatNumber } from '@shared/utils';
import { useDashboard } from '@/api/dashboard';
import { BreakdownBars, VolumeChart } from '@/components/domain/DashboardCharts';
import { TechnicianLoadTable } from '@/components/domain/TechnicianLoadTable';
import { TicketRow } from '@/components/domain/TicketRow';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/cn';

function formatKpi(kpi: KpiDto): string {
  if (kpi.format === 'percent') return `${kpi.value}%`;
  if (kpi.format === 'hours') return `${kpi.value} h`;
  return formatNumber(kpi.value);
}

function KpiCard({ kpi }: { kpi: KpiDto }) {
  const change = kpi.changePercent;
  const improving = change === null ? null : kpi.higherIsBetter ? change >= 0 : change <= 0;
  const Icon = change === null ? ArrowRight : change < 0 ? TrendingDown : TrendingUp;
  const direction = change === null ? '' : change < 0 ? 'down' : change > 0 ? 'up' : 'unchanged';

  return (
    <article className="relative overflow-hidden rounded-card border border-line bg-surface px-4 py-3.5 shadow-card">
      <div
        className={cn(
          'absolute inset-y-0 left-0 w-0.5',
          improving === true && 'bg-success-solid',
          improving === false && 'bg-danger-solid',
          improving === null && 'bg-line-strong'
        )}
      />
      <p className="stat-label">{kpi.label}</p>
      <p className="stat-value tabular">{formatKpi(kpi)}</p>
      <p
        className={cn(
          'mt-1.5 flex min-h-4 items-center gap-1 text-2xs font-medium',
          improving === true && 'text-success-fg',
          improving === false && 'text-danger-fg',
          improving === null && 'text-ink-subtle'
        )}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {change === null ? (
          'Current snapshot'
        ) : (
          <>
            <span className="sr-only">{direction} </span>
            <span className="tabular">{Math.abs(change)}%</span>
            <span className="font-normal text-ink-subtle">vs prior period</span>
          </>
        )}
      </p>
    </article>
  );
}

interface FlowSummary {
  created: number;
  resolved: number;
  net: number;
}

function summarizeFlow(points: TimeSeriesPointDto[]): FlowSummary {
  return points.reduce(
    (summary, point) => ({
      created: summary.created + point.created,
      resolved: summary.resolved + point.resolved,
      net: summary.net + point.created - point.resolved,
    }),
    { created: 0, resolved: 0, net: 0 }
  );
}

function FlowSummary({ summary }: { summary: FlowSummary }) {
  const Icon = summary.net > 0 ? ArrowUpRight : summary.net < 0 ? ArrowDownRight : ArrowRight;
  const netLabel = summary.net > 0 ? `+${summary.net}` : String(summary.net);

  return (
    <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface-sunken/60">
      <div className="px-3 py-2">
        <dt className="text-2xs font-medium text-ink-subtle">Created</dt>
        <dd className="mt-0.5 tabular text-sm font-semibold text-ink">{formatNumber(summary.created)}</dd>
      </div>
      <div className="px-3 py-2">
        <dt className="text-2xs font-medium text-ink-subtle">Resolved</dt>
        <dd className="mt-0.5 tabular text-sm font-semibold text-ink">{formatNumber(summary.resolved)}</dd>
      </div>
      <div className="px-3 py-2">
        <dt className="text-2xs font-medium text-ink-subtle">Net intake</dt>
        <dd
          className={cn(
            'mt-0.5 flex items-center gap-1 tabular text-sm font-semibold',
            summary.net > 0
              ? 'text-warning-fg'
              : summary.net < 0
                ? 'text-success-fg'
                : 'text-ink'
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {netLabel}
          <span className="sr-only"> tickets over the displayed period</span>
        </dd>
      </div>
    </dl>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading operations dashboard">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-8 w-28 sm:block" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[6.75rem]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
        <Skeleton className="h-[23rem]" />
        <Skeleton className="h-[23rem]" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const dashboard = useDashboard();
  const now = useNow();

  if (dashboard.isLoading) return <DashboardLoading />;

  if (dashboard.isError || !dashboard.data) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="Could not load the dashboard"
          message="The latest operational data is unavailable. Check your connection and try again."
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={dashboard.isFetching}
              onClick={() => void dashboard.refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </Button>
          }
        />
      </Card>
    );
  }

  const data = dashboard.data;
  const flow = summarizeFlow(data.volume);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-brand-600">
            Operations command center
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">
            Service desk overview
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-ink-muted">
            Live workload, service performance, and SLA exposure within your access scope.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={dashboard.isFetching}
          onClick={() => void dashboard.refetch()}
          aria-label="Refresh dashboard data"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </header>

      <section aria-labelledby="performance-heading">
        <h2 id="performance-heading" className="sr-only">Performance indicators</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]" aria-label="Workload analysis">
        <Card>
          <CardHeader
            title="Ticket flow"
            subtitle="Created versus resolved across the last 14 business days"
            action={
              <div className="flex items-center gap-3 text-2xs text-ink-muted" aria-label="Chart legend">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-brand-600" aria-hidden="true" />
                  Created
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-success-solid" aria-hidden="true" />
                  Resolved
                </span>
              </div>
            }
          />
          <CardBody className="space-y-3">
            <FlowSummary summary={flow} />
            <VolumeChart points={data.volume} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Queue composition" subtitle="Current tickets by workflow state" />
          <CardBody>
            <BreakdownBars rows={data.byStatus} kind="status" />
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Queue breakdowns">
        <Card>
          <CardHeader title="Priority mix" subtitle="Current tickets by assigned priority" />
          <CardBody>
            <BreakdownBars rows={data.byPriority} kind="priority" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Category demand" subtitle="Highest-volume categories in scope" />
          <CardBody>
            <BreakdownBars rows={data.byCategory} kind="category" />
          </CardBody>
        </Card>
      </section>

      {data.technicianLoad.length > 0 && (
        <Card>
          <CardHeader title="Technician capacity" subtitle="Open workload, seven-day output, and service risk" />
          <TechnicianLoadTable rows={data.technicianLoad} />
        </Card>
      )}

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              Needs attention
              {data.atRisk.length > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger-bg px-1.5 py-0.5 text-2xs font-semibold tabular text-danger-fg ring-1 ring-inset ring-danger-border">
                  {data.atRisk.length}
                </span>
              )}
            </span>
          }
          subtitle="Open tickets nearest to or beyond their resolution deadline"
          action={
            /* The list can filter on `breached`; "at risk" is evaluated live and is not
               a stored filter, so this link honestly narrows only to breached work. */
            <Link to="/tickets?breached=true" className="link text-xs">
              <span className="inline-flex items-center gap-1">
                View breached
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </Link>
          }
        />
        {data.atRisk.length === 0 ? (
          <CardBody>
            <p className="py-6 text-center text-xs text-ink-subtle">Nothing is at risk right now.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-hover table-compact">
              <caption className="sr-only">Tickets at risk of or already breaching their resolution SLA</caption>
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
                {data.atRisk.map((ticket) => (
                  <TicketRow key={ticket.id} ticket={ticket} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
