/**
 * ServiceDesk Pro — operations dashboard (Donezo card rhythm).
 *
 * Layout mirrors the Donezo reference: header row, 4 KPI cards (first solid
 * dark-green), a 3-card row (Ticket Analytics / SLA Reminders / Critical
 * Incidents), then a second 3-card row (Technician Workload / SLA Performance
 * donut / SLA Time Machine).
 *
 * Data keeps the established pattern: `useDashboard()` live, falling back to
 * `@/lib/mock` when the API is unreachable or the tenant is empty. A slim
 * banner marks fallback mode; a hard error with no fallback shows a retry card.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Bell, Pause, Play, Plus, RefreshCw, RotateCcw, Square, } from 'lucide-react';
import { useDashboard } from '@/api/dashboard';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { MOCK_DASHBOARD, MOCK_KPIS, MOCK_TECH_LOAD, MOCK_TICKETS, MOCK_WEEK_VOLUME, } from '@/lib/mock';
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const STRIPED = 'repeating-linear-gradient(135deg, rgb(var(--c-line-strong)) 0 2px, transparent 2px 6px)';
/* ---------------------------------- data ---------------------------------- */
function pickData(live) {
    if (live && live.kpis.length > 0)
        return { data: live, fallback: false };
    return { data: MOCK_DASHBOARD, fallback: true };
}
function toKpiViews(kpis, fallback) {
    const list = kpis.length >= 4 ? kpis.slice(0, 4) : MOCK_KPIS;
    /* Mock data wears the showcase labels; live data keeps the server's own
     * labels — renaming "Resolved (7 days)" to "SLA attainment" invented metrics. */
    const labels = fallback ? ['Open tickets', 'SLA attainment', 'Active incidents', 'AI deflection'] : [];
    return list.map((kpi, i) => {
        const value = kpi.format === 'percent'
            ? `${kpi.value}%`
            : kpi.format === 'hours'
                ? `${kpi.value} h`
                : String(kpi.value);
        const change = kpi.changePercent;
        const good = change === null ? null : kpi.higherIsBetter ? change >= 0 : change <= 0;
        return {
            label: labels[i] ?? kpi.label,
            value,
            trend: change === null
                ? 'Current snapshot'
                : `${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}% ${good === false ? 'needs attention' : 'from last week'}`,
            trendTone: change === null ? 'flat' : change >= 0 ? 'up' : 'down',
        };
    });
}
/* --------------------------------- pieces --------------------------------- */
function KpiCard({ kpi, solid, index }) {
    return (<article className={cn('relative rounded-2xl border p-5 shadow-sm transition-transform duration-200 hover:-translate-y-0.5', solid ? 'border-brand-800 bg-brand-700 text-white' : 'border-line bg-surface text-ink')}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-sm font-medium', solid ? 'text-white/90' : 'text-ink')}>{kpi.label}</p>
        <Link to={index === 2 ? '/tickets?priority=URGENT' : '/tickets'} aria-label={`Open ${kpi.label}`} className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors', solid
            ? 'border-white/40 bg-white text-ink hover:bg-white/90'
            : 'border-line-strong text-ink hover:bg-surface-sunken')}>
          <ArrowUpRight className="h-4 w-4" aria-hidden="true"/>
        </Link>
      </div>
      <p className={cn('mt-2 text-4xl font-semibold tabular tracking-tight', solid ? 'text-white' : 'text-ink')}>
        {kpi.value}
      </p>
      <p className={cn('mt-2 flex items-center gap-1.5 text-xs', solid ? 'text-white/75' : kpi.trendTone === 'down' ? 'text-danger-fg' : 'text-success-fg')}>
        <span className={cn('grid h-4 w-4 place-items-center rounded border', solid ? 'border-white/30' : 'border-line')} aria-hidden="true">
          <ArrowUpRight className={cn('h-3 w-3', kpi.trendTone === 'down' && 'rotate-90')}/>
        </span>
        {kpi.trend}
      </p>
    </article>);
}
function AnalyticsBars({ values }) {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const peak = Math.max(...values, 1);
    const peakIdx = values.indexOf(peak);
    // Mix from the reference: striped gray + green solids, tallest solid dark.
    const barStyle = (i) => {
        if (i === peakIdx)
            return { background: 'rgb(var(--c-brand-800))' };
        if (i % 3 === 1)
            return { background: 'rgb(var(--c-brand-500))' };
        if (i % 3 === 2)
            return { background: 'rgb(var(--c-brand-300))' };
        return { background: STRIPED, border: '1px solid rgb(var(--c-line-strong))' };
    };
    return (<div className="flex items-end justify-between gap-2 sm:gap-3" role="img" aria-label="Tickets per day this week">
      {values.map((v, i) => (<div key={`${days[i]}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div className="flex h-36 flex-col items-center justify-end">
            {i === peakIdx && (<span className="mb-1 rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tabular text-ink-muted">
                {Math.round((v / peak) * 74) + 26}%
              </span>)}
            <div className="w-9 rounded-full sm:w-11" style={{ height: `${Math.max(18, (v / peak) * 100)}%`, ...barStyle(i) }} title={`${days[i]}: ${v} tickets`}/>
          </div>
          <span className="text-xs font-medium text-ink-subtle">{days[i]}</span>
        </div>))}
    </div>);
}
function SlaDonut({ value }) {
    const clamped = Math.min(100, Math.max(0, value));
    // Semicircular gauge split into completed / in-progress / pending thirds.
    const R = 70;
    const C = Math.PI * R; // half circumference
    const arc = (frac, offset, stroke, extra) => (<circle cx="90" cy="90" r={R} fill="none" stroke={stroke} strokeWidth="26" strokeLinecap="round" strokeDasharray={`${Math.max(0, frac * C - 6)} ${C * 2}`} strokeDashoffset={-offset * C} transform="rotate(180 90 90)" style={extra}/>);
    const done = (clamped / 100) * 0.72;
    const prog = 0.18;
    const pend = Math.max(0, 0.9 - done - prog);
    return (<div>
      <div className="relative mx-auto w-fit" role="img" aria-label={`SLA attainment ${clamped}%`}>
        <svg viewBox="0 0 180 105" className="w-56">
          <defs>
            <pattern id="sla-stripe" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="rgb(var(--c-surface-sunken))"/>
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(var(--c-line-strong))" strokeWidth="2"/>
            </pattern>
          </defs>
          <circle cx="90" cy="90" r={R} fill="none" stroke="rgb(var(--c-line))" strokeWidth="26" strokeDasharray={`${C} ${C * 2}`} transform="rotate(180 90 90)" strokeLinecap="round" opacity={0.6}/>
          {arc(pend, done + prog, 'url(#sla-stripe)')}
          {arc(prog, done, 'rgb(var(--c-brand-800))')}
          {arc(done, 0, 'rgb(var(--c-brand-500))')}
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <p className="text-4xl font-semibold tabular tracking-tight text-ink">{clamped}%</p>
          <p className="text-xs text-ink-subtle">SLA targets met</p>
        </div>
      </div>
      <ul className="mt-3 flex items-center justify-center gap-4 text-xs text-ink-muted">
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden="true"/> Within target
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-800" aria-hidden="true"/> At risk
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-line-strong" style={{ background: STRIPED }} aria-hidden="true"/> Breached
        </li>
      </ul>
    </div>);
}
/** Demo-reactive countdown to the next SLA breach, with adjustable slack. */
function SlaTimeMachine({ ticketNumber }) {
    const BASE = 1 * 3600 + 24 * 60 + 8;
    const [extra, setExtra] = useState(0);
    const [paused, setPaused] = useState(false);
    const [nowTick, setNowTick] = useState(() => Date.now());
    const deadline = useMemo(() => Date.now() + BASE * 1000, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (paused)
            return;
        const t = window.setInterval(() => setNowTick(Date.now()), 1000);
        return () => window.clearInterval(t);
    }, [paused]);
    const remaining = Math.max(0, deadline + extra * 1000 - nowTick);
    const h = String(Math.floor(remaining / 3_600_000)).padStart(2, '0');
    const m = String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, '0');
    const s = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0');
    const bumps = [
        { label: '+15m', ms: 15 * 60_000 },
        { label: '+30m', ms: 30 * 60_000 },
        { label: '+1h', ms: 3_600_000 },
        { label: '+4h', ms: 4 * 3_600_000 },
    ];
    return (<article className="flex flex-col rounded-2xl bg-brand-800 p-5 text-white shadow-sm" aria-label="SLA time machine">
      <p className="text-sm font-semibold">SLA Time Machine</p>
      <p className="mt-0.5 text-xs text-white/65">until {ticketNumber} breaches its resolution target</p>
      <p className="mt-3 font-mono text-4xl font-semibold tabular tracking-tight" aria-live="off">
        {h}:{m}:{s}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
        <div className="h-full rounded-full bg-white/80 transition-[width] duration-1000" style={{ width: `${Math.min(100, (remaining / ((BASE + extra) * 1000 || 1)) * 100)}%` }}/>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Add SLA slack (demo)">
        {bumps.map((b) => (<button key={b.label} type="button" onClick={() => setExtra((e) => e + b.ms / 1000)} className="rounded-full border border-white/30 px-2.5 py-1 text-xs font-medium text-white/90 transition-colors hover:bg-white/10">
            {b.label}
          </button>))}
        <button type="button" onClick={() => setExtra(0)} className="inline-flex items-center gap-1 rounded-full border border-white/30 px-2.5 py-1 text-xs font-medium text-white/90 transition-colors hover:bg-white/10">
          <RotateCcw className="h-3 w-3" aria-hidden="true"/> Reset
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume countdown' : 'Pause countdown'} className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink transition-transform hover:scale-105">
          {paused ? <Play className="h-4 w-4" aria-hidden="true"/> : <Pause className="h-4 w-4" aria-hidden="true"/>}
        </button>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-danger-solid text-white" aria-hidden="true">
          <Square className="h-3.5 w-3.5 fill-current"/>
        </span>
        <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">Demo</span>
      </div>
    </article>);
}
function DashboardLoading() {
    return (<div className="space-y-4" aria-busy="true" aria-label="Loading dashboard" style={{ fontFamily: FONT }}>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44"/>
          <Skeleton className="h-3 w-72 max-w-full"/>
        </div>
        <Skeleton className="hidden h-9 w-56 sm:block"/>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (<Skeleton key={i} className="h-36"/>))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (<Skeleton key={i} className="h-64"/>))}
      </div>
    </div>);
}
/* ---------------------------------- page ---------------------------------- */
export default function Dashboard() {
    const dashboard = useDashboard();
    if (dashboard.isLoading)
        return <DashboardLoading />;
    if (dashboard.isError && !dashboard.data) {
        return (<div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-8 text-center" style={{ fontFamily: FONT }}>
        <Bell className="mx-auto h-8 w-8 text-ink-subtle" aria-hidden="true"/>
        <h1 className="mt-3 text-lg font-semibold text-ink">Dashboard unavailable</h1>
        <p className="mt-1 text-sm text-ink-muted">We couldn't reach the service desk API. Check your connection and try again.</p>
        <button type="button" onClick={() => void dashboard.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
          <RefreshCw className="h-4 w-4" aria-hidden="true"/> Retry
        </button>
      </div>);
    }
    return <DashboardReady data={pickData(dashboard.data).data} fallback={pickData(dashboard.data).fallback} refreshing={dashboard.isFetching} onRefresh={() => void dashboard.refetch()}/>;
}
function DashboardReady({ data, fallback, refreshing, onRefresh, }) {
    const kpis = toKpiViews(data.kpis, fallback);
    const weekValues = (data.volume.length > 0 ? data.volume.slice(-7) : []).map((p) => p.created + p.resolved);
    const analytics = weekValues.length === 7 ? weekValues : MOCK_WEEK_VOLUME.map((d) => d.created + d.resolved);
    const techRows = data.technicianLoad.length > 0 ? data.technicianLoad : MOCK_TECH_LOAD;
    const incidents = (data.atRisk.length > 0 ? data.atRisk : MOCK_TICKETS).slice(0, 5);
    const reminder = (data.atRisk.length > 0 ? data.atRisk : MOCK_TICKETS)[0];
    const slaValue = Math.round(kpis[1] ? Number(String(kpis[1].value).replace('%', '')) || 96.4 : 96.4);
    const queueCount = kpis[0]?.value ?? '128';
    const statusPill = (open, breached) => {
        if (breached > 0)
            return { label: 'At risk', cls: 'bg-danger-bg text-danger-fg ring-danger-border' };
        if (open >= 14)
            return { label: 'In Progress', cls: 'bg-warning-bg text-warning-fg ring-warning-border' };
        return { label: 'Completed', cls: 'bg-success-bg text-success-fg ring-success-border' };
    };
    return (<div className="space-y-4" style={{ fontFamily: FONT }}>
      {/* Header row */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-subtle">Plan, prioritize, and resolve tickets with ease.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-700 px-3.5 py-2 text-sm font-medium text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden="true"/>
            {queueCount} in queue
          </span>
          <Link to="/tickets/new" className="inline-flex items-center gap-1.5 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800">
            <Plus className="h-4 w-4" aria-hidden="true"/> New Ticket
          </Link>
          <Link to="/reports" className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-sunken">
            View Reports
          </Link>
          <button type="button" onClick={onRefresh} aria-label="Refresh dashboard data" className="grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-surface text-ink transition-colors hover:bg-surface-sunken">
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true"/>
          </button>
        </div>
      </header>

      {fallback && (<p className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink-muted" role="status">
          Showing sample data — connect the API to see live numbers.
        </p>)}

      {/* KPI row */}
      <section aria-label="Key metrics">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi, i) => (<KpiCard key={kpi.label} kpi={kpi} solid={i === 0} index={i}/>))}
        </div>
      </section>

      {/* Row: analytics / reminders / incidents */}
      <section className="grid gap-4 lg:grid-cols-3" aria-label="Ticket overview">
        <article className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Ticket Analytics</h2>
          <div className="mt-3">
            <AnalyticsBars values={analytics}/>
          </div>
        </article>

        <article className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">SLA Reminders</h2>
          {reminder ? (<>
              <p className="mt-4 text-lg font-semibold leading-snug text-ink">
                {reminder.sla.breached ? 'Breach review: ' : 'Review at-risk ticket '}
                {reminder.number}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{reminder.title}</p>
              <p className="mt-1 text-xs text-ink-subtle">
                Time: {reminder.sla.resolution.dueAt ? new Date(reminder.sla.resolution.dueAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—'}
                {' — '}
                {reminder.sla.breached ? 'already breached' : 'resolution due'}
              </p>
              <Link to={`/tickets/${reminder.id}`} className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/20" aria-hidden="true">
                  <Play className="h-3 w-3 fill-current"/>
                </span>
                Start Review
              </Link>
            </>) : (<p className="mt-4 py-6 text-center text-sm text-ink-subtle">No SLA reminders right now.</p>)}
        </article>

        <article className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Critical Incidents</h2>
            <Link to="/tickets/new?priority=URGENT" className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-sunken">
              <Plus className="h-3 w-3" aria-hidden="true"/> New
            </Link>
          </div>
          {incidents.length === 0 ? (<p className="py-8 text-center text-sm text-ink-subtle">No critical incidents. The queue is clear.</p>) : (<ul className="mt-3 divide-y divide-line">
              {incidents.map((t) => (<li key={t.id}>
                  <Link to={`/tickets/${t.id}`} className="group flex items-center gap-2.5 py-2.5">
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', t.priority === 'URGENT' ? 'bg-danger-solid' : t.priority === 'HIGH' ? 'bg-warning-solid' : 'bg-brand-400')} aria-hidden="true"/>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink group-hover:underline">{t.title}</span>
                      <span className="block text-xs text-ink-subtle">
                        {t.sla.breached ? 'Breached' : 'Due'}: {t.sla.resolution.dueAt ? new Date(t.sla.resolution.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-subtle">{t.number}</span>
                  </Link>
                </li>))}
            </ul>)}
        </article>
      </section>

      {/* Row: workload / donut / time machine */}
      <section className="grid gap-4 lg:grid-cols-3" aria-label="Team and SLA">
        <article className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Technician Workload</h2>
            <Link to="/tickets" className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-sunken">
              <Plus className="h-3 w-3" aria-hidden="true"/> Assign
            </Link>
          </div>
          {techRows.length === 0 ? (<p className="py-8 text-center text-sm text-ink-subtle">No technician data yet.</p>) : (<ul className="mt-2 divide-y divide-line">
              {techRows.slice(0, 4).map((row) => {
                const pill = statusPill(row.open, row.breached);
                const initials = row.technician.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
                return (<li key={row.technician.id} className="flex items-center gap-3 py-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800" aria-hidden="true">
                      {initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{row.technician.name}</span>
                      <span className="block truncate text-xs text-ink-subtle">
                        {row.open} open · {row.resolvedLast7Days} resolved (7d)
                      </span>
                    </span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', pill.cls)}>
                      {pill.label}
                    </span>
                  </li>);
            })}
            </ul>)}
        </article>

        <article className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">SLA Performance</h2>
          <div className="mt-2">
            <SlaDonut value={slaValue}/>
          </div>
          <Link to="/tickets?breached=true" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            View breaches <ArrowRight className="h-3.5 w-3.5" aria-hidden="true"/>
          </Link>
        </article>

        <SlaTimeMachine ticketNumber={reminder?.number ?? 'TKT-1038'}/>
      </section>
    </div>);
}
