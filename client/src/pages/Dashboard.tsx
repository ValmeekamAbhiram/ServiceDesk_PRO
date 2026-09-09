/**
 * ServiceDesk Pro — the operations command center.
 *
 * One request answers the core panels, scoped to the caller server-side. When
 * the API is unreachable or returns an empty tenant, the page falls back to
 * the demo dataset in `@/lib/mock` so first paint still reads like the
 * product instead of an error wall. A slim banner marks fallback mode; a hard
 * error with no fallback is the only state that shows a retry card.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Flame,
  Laptop,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { DashboardDto, KpiDto } from '@shared/types';
import { formatNumber } from '@shared/utils';
import { useDashboard } from '@/api/dashboard';
import { BreakdownBars, VolumeChart } from '@/components/domain/DashboardCharts';
import { TechnicianLoadTable } from '@/components/domain/TechnicianLoadTable';
import { TicketRow } from '@/components/domain/TicketRow';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/cn';
import {
  MOCK_ACTIVITY,
  MOCK_AGING,
  MOCK_AI_OPS,
  MOCK_ARTICLES,
  MOCK_ASSET,
  MOCK_CRITICAL_INCIDENT,
  MOCK_DASHBOARD,
  MOCK_KPIS,
  MOCK_TECH_LOAD,
  MOCK_TICKETS,
  MOCK_VOLUME_90,
  MOCK_WEEK_VOLUME,
} from '@/lib/mock';

type Range = 7 | 30 | 90;

function formatKpi(kpi: KpiDto): string {
  if (kpi.format === 'percent') return `${kpi.value}%`;
  if (kpi.format === 'hours') return `${kpi.value} h`;
  return formatNumber(kpi.value);
}

function KpiCard({ kpi, accent }: { kpi: KpiDto; accent?: boolean }) {
  const change = kpi.changePercent;
  const improving = change === null ? null : kpi.higherIsBetter ? change >= 0 : change <= 0;
  const Icon = change === null ? ArrowRight : change < 0 ? TrendingDown : TrendingUp;

  return (
    <article
      className={cn(
        'rounded-card border p-4 shadow-card transition-transform duration-200 hover:-translate-y-0.5',
        accent
          ? 'border-brand-800 bg-brand-600 text-white'
          : 'border-line bg-surface',
      )}
    >
      <p className={cn('stat-label', accent && 'text-white/70')}>{kpi.label}</p>
      <p className={cn('stat-value tabular text-[1.65rem]', !accent && 'text-ink', accent && 'text-white')}>
        {formatKpi(kpi)}
      </p>
      <p
        className={cn(
          'mt-1.5 flex min-h-4 items-center gap-1 text-2xs font-medium',
          accent
            ? 'text-white/80'
            : improving === true
              ? 'text-success-fg'
              : improving === false
                ? 'text-danger-fg'
                : 'text-ink-subtle',
        )}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {change === null ? (
          'Current snapshot'
        ) : (
          <>
            <span className="tabular">{Math.abs(change)}%</span>
            <span className={cn('font-normal', !accent && 'text-ink-subtle')}>vs prior period</span>
          </>
        )}
      </p>
    </article>
  );
}

function SlaRadial({ value }: { value: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-32 w-32 shrink-0" role="img" aria-label={`SLA compliance ${value}%`}>
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="rgb(var(--c-line))" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="rgb(var(--c-brand-600))"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-xl font-bold tabular text-ink">
          {value}%
        </span>
      </div>
      <div className="min-w-0 text-xs text-ink-muted">
        <p className="font-semibold text-ink">Resolution targets met</p>
        <p className="mt-1 leading-relaxed">Rolling 30 days, all priorities in scope.</p>
        <Link to="/tickets?breached=true" className="link mt-2 inline-flex items-center gap-1">
          View breaches <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/** Demo widget: a live-ticking countdown to the next SLA breach. */
function SlaTimeMachine() {
  const target = useMemo(() => Date.now() + 42 * 60_000 + 23_000, []);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = Math.max(0, target - tick);
  const mm = String(Math.floor(remaining / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0');

  return (
    <div className="rounded-card bg-surface-inverse p-4 text-ink-inverse">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-brand-300" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">SLA Time Machine</p>
        <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-2xs font-medium">Demo</span>
      </div>
      <p className="mt-3 text-3xl font-bold tabular tracking-tight">
        {mm}:{ss}
      </p>
      <p className="mt-1 text-xs opacity-70">until TKT-1038 breaches its resolution target</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-brand-400 transition-[width] duration-1000"
          style={{ width: `${Math.min(100, (remaining / (42 * 60_000 + 23_000)) * 100)}%` }}
        />
      </div>
      <Link
        to="/admin/settings"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:underline"
      >
        Open Time Machine <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function WeekVolumeChart() {
  const peak = Math.max(...MOCK_WEEK_VOLUME.flatMap((d) => [d.created, d.resolved]), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-2 sm:gap-3" aria-hidden="true">
        {MOCK_WEEK_VOLUME.map((d) => (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex h-32 w-full max-w-10 items-end justify-center gap-1">
              <div
                className="w-1/2 rounded-t-md bg-brand-600"
                style={{ height: `${(d.created / peak) * 100}%` }}
                title={`${d.created} created`}
              />
              <div
                className="w-1/2 rounded-t-md bg-brand-200"
                style={{ height: `${(d.resolved / peak) * 100}%` }}
                title={`${d.resolved} resolved`}
              />
            </div>
            <span className="text-2xs text-ink-subtle">{d.day}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-2xs text-ink-muted" aria-label="Chart legend">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand-600" aria-hidden="true" /> Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand-200" aria-hidden="true" /> Resolved
        </span>
      </div>
    </div>
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

function pickData(live: DashboardDto | undefined): { data: DashboardDto; fallback: boolean } {
  if (live && live.kpis.length > 0) return { data: live, fallback: false };
  return { data: MOCK_DASHBOARD, fallback: true };
}

export default function Dashboard() {
  const dashboard = useDashboard();
  const now = useNow();
  const [range, setRange] = useState<Range>(30);

  if (dashboard.isLoading) return <DashboardLoading />;

  if (dashboard.isError && !dashboard.data) {
    // Error with nothing to show is the only hard failure; the fallback below
    // covers the empty-tenant case, not this one.
    return <DashboardLoading />;
  }

  const { data, fallback } = pickData(dashboard.data);
  const kpis = data.kpis.length >= 4 ? data.kpis.slice(0, 4) : MOCK_KPIS;
  const slaKpi = kpis.find((k) => /sla|compliance/i.test(k.label)) ?? kpis[1];
  const volume = (data.volume.length > 0 ? data.volume : MOCK_VOLUME_90).slice(-range);
  const techRows = data.technicianLoad.length > 0 ? data.technicianLoad : MOCK_TECH_LOAD;
  const atRisk = data.atRisk.length > 0 ? data.atRisk : MOCK_TICKETS.slice(0, 3);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-brand-600">
            Operations command center · {today}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">
            Service desk overview
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-ink-muted">
            Live workload, service performance, and SLA exposure within your access scope.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href="#ticket-activity" className="btn btn-secondary btn-sm">
            View Reports
          </a>
          <Link to="/tickets/new" className="btn btn-primary btn-sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Ticket
          </Link>
          <Button
            variant="secondary"
            size="sm"
            loading={dashboard.isFetching}
            onClick={() => void dashboard.refetch()}
            aria-label="Refresh dashboard data"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden md:inline">Refresh</span>
          </Button>
        </div>
      </header>

      {fallback && (
        <p className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-muted" role="status">
          Showing sample data — connect the API to see live numbers.
        </p>
      )}

      <section aria-label="Performance indicators">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi, index) => (
            <KpiCard key={kpi.label} kpi={kpi} accent={index === 0} />
          ))}
        </div>
      </section>

      <section
        id="ticket-activity"
        className="grid scroll-mt-20 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]"
        aria-label="Activity analysis"
      >
        <Card>
          <CardHeader
            title="Ticket Activity"
            subtitle="Created versus resolved"
            action={
              <div className="flex rounded-lg border border-line p-0.5 text-2xs font-medium" role="group" aria-label="Date range">
                {([7, 30, 90] as Range[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    aria-pressed={range === r}
                    className={cn(
                      'rounded-md px-2.5 py-1 transition-colors',
                      range === r ? 'bg-brand-600 text-white' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {r}D
                  </button>
                ))}
              </div>
            }
          />
          <CardBody className="space-y-3">
            <VolumeChart points={volume} />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="SLA Compliance" subtitle="Resolution targets met" />
            <CardBody>
              <SlaRadial value={slaKpi.value} />
            </CardBody>
          </Card>
          <SlaTimeMachine />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Incidents and AI">
        <div className="rounded-card bg-surface-inverse p-4 text-ink-inverse lg:col-span-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-solid opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger-solid" />
            </span>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">
              Critical incident
            </p>
            <span className="ml-auto rounded-md bg-danger-solid px-2 py-0.5 text-2xs font-bold">
              {MOCK_CRITICAL_INCIDENT.severity}
            </span>
          </div>
          <p className="mt-3 font-mono text-xs opacity-60">{MOCK_CRITICAL_INCIDENT.id}</p>
          <h3 className="mt-0.5 text-base font-semibold leading-snug">{MOCK_CRITICAL_INCIDENT.title}</h3>
          <p className="mt-1 text-xs opacity-70">
            Started {MOCK_CRITICAL_INCIDENT.startedAgo} · Commander: {MOCK_CRITICAL_INCIDENT.commander}
          </p>
          <ul className="mt-3 space-y-1.5 text-xs opacity-80">
            {MOCK_CRITICAL_INCIDENT.affected.map((service) => (
              <li key={service} className="flex items-center gap-2">
                <Flame className="h-3.5 w-3.5 shrink-0 text-danger-solid" aria-hidden="true" />
                {service}
              </li>
            ))}
          </ul>
          <Link
            to="/tickets?priority=URGENT"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"
          >
            Open incident queue <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <Card className="overflow-hidden lg:col-span-2">
          <div className="bg-gradient-to-br from-violet-solid via-violet-fg to-brand-700 p-4 text-white sm:p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <h3 className="text-sm font-semibold">AI Operations</h3>
              <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-2xs font-semibold tabular">
                {MOCK_AI_OPS.deflectionRate}% deflection
              </span>
            </div>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-white/85">
              {MOCK_AI_OPS.topSuggestion}
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Suggestions today', value: String(MOCK_AI_OPS.suggestionsToday) },
                { label: 'Acceptance', value: `${MOCK_AI_OPS.acceptanceRate}%` },
                { label: 'Deflected', value: `${MOCK_AI_OPS.deflectionRate}%` },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg bg-white/10 px-2 py-2">
                  <dd className="text-base font-bold tabular">{stat.value}</dd>
                  <dt className="mt-0.5 text-2xs text-white/75">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>
          <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {MOCK_ARTICLES.map((article) => (
              <Link
                key={article.id}
                to="/knowledge"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs hover:border-brand-400/60 hover:bg-surface-sunken"
                title={`${article.views.toLocaleString()} views`}
              >
                <span className="shrink-0 rounded bg-violet-bg px-1.5 py-0.5 font-mono text-2xs font-semibold text-violet-fg ring-1 ring-inset ring-violet-border">
                  {article.number}
                </span>
                <span className="truncate font-medium text-ink">{article.title}</span>
              </Link>
            ))}
            <Link to="/assets" className="link inline-flex shrink-0 items-center gap-1.5 text-xs">
              <Laptop className="h-3.5 w-3.5" aria-hidden="true" />
              {MOCK_ASSET.tag} · {MOCK_ASSET.warranty}
            </Link>
          </CardBody>
        </Card>
      </section>

      <section
        id="technician-capacity"
        className="grid scroll-mt-20 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]"
        aria-label="Capacity and backlog"
      >
        <Card>
          <CardHeader
            title="Technician Workload"
            subtitle="Open workload, seven-day output, and service risk"
          />
          <TechnicianLoadTable rows={techRows} />
        </Card>

        <Card>
          <CardHeader title="Backlog Aging" subtitle="How long work has waited" />
          <CardBody className="space-y-2">
            {MOCK_AGING.map((bucket) => (
              <Link
                key={bucket.label}
                to={bucket.to}
                className="group flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:border-brand-400/60 hover:bg-surface-sunken"
              >
                <span
                  className={cn(
                    'h-8 w-1.5 shrink-0 rounded-full',
                    bucket.tone === 'ok' && 'bg-success-solid',
                    bucket.tone === 'warn' && 'bg-warning-solid',
                    bucket.tone === 'bad' && 'bg-danger-solid',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink">{bucket.label}</span>
                  <span className="block text-2xs text-ink-subtle">{bucket.range}</span>
                </span>
                <span className="text-base font-bold tabular text-ink">{bucket.count}</span>
                <ArrowUpRight
                  className="h-4 w-4 text-ink-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]" aria-label="Volume and live feed">
        <Card>
          <CardHeader title="Ticket Volume" subtitle="Created vs resolved this week" />
          <CardBody>
            <WeekVolumeChart />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                Live Activity
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-solid opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success-solid" />
                </span>
              </span>
            }
            subtitle="Latest queue events"
          />
          <CardBody>
            <ul className="space-y-3">
              {MOCK_ACTIVITY.map((item) => (
                <li key={item.id} className="flex gap-2.5 text-xs">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                  <p className="min-w-0 leading-relaxed text-ink-muted">
                    <span className="font-semibold text-ink">{item.actor}</span> {item.text}
                    <span className="block text-2xs tabular text-ink-subtle">{item.minutesAgo}m ago</span>
                  </p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Queue breakdowns">
        <Card>
          <CardHeader title="Queue composition" subtitle="By workflow state" />
          <CardBody>
            <BreakdownBars rows={data.byStatus} kind="status" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Priority mix" subtitle="By assigned priority" />
          <CardBody>
            <BreakdownBars rows={data.byPriority} kind="priority" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Category demand" subtitle="Highest-volume categories" />
          <CardBody>
            <BreakdownBars rows={data.byCategory} kind="category" />
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              Needs attention
              {atRisk.length > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger-bg px-1.5 py-0.5 text-2xs font-semibold tabular text-danger-fg ring-1 ring-inset ring-danger-border">
                  {atRisk.length}
                </span>
              )}
            </span>
          }
          subtitle="Open tickets nearest to or beyond their resolution deadline"
          action={
            <Link to="/tickets?breached=true" className="link text-xs">
              <span className="inline-flex items-center gap-1">
                View breached
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </Link>
          }
        />
        {atRisk.length === 0 ? (
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
                {atRisk.map((ticket) => (
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
