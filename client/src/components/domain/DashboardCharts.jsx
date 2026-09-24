/**
 * ServiceDesk Pro — dashboard charts.
 *
 * Recharts needs colours, not classes, so series use the same semantic CSS variables
 * as badges. Breakdowns stay as labelled HTML bars: this small ranked set is clearer
 * and more accessible than a pie, and exposes exact counts without interaction.
 */
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';
import { priorityMeta, ticketStatusMeta } from '@shared/labels';
import { cn } from '@/lib/cn';
import { TONE_SOLID, TONE_VAR } from '@/lib/tone';
const AXIS = 'rgb(var(--c-ink-subtle))';
const GRID = 'rgb(var(--c-line))';
function shortDate(iso) {
    const date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? iso
        : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function tooltipDate(label, payload) {
    const iso = payload[0]?.payload?.date;
    if (!iso)
        return String(label);
    const date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? String(label)
        : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
export function VolumeChart({ points }) {
    if (points.length === 0) {
        return <p className="py-12 text-center text-xs text-ink-subtle">No activity yet.</p>;
    }
    const data = points.map((point) => ({ ...point, label: shortDate(point.date) }));
    const tickInterval = data.length > 10 ? 2 : 0;
    return (<figure>
      <div className="h-56 w-full sm:h-64" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
            <defs>
              <linearGradient id="sdp-created" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TONE_VAR.primary} stopOpacity={0.26}/>
                <stop offset="100%" stopColor={TONE_VAR.primary} stopOpacity={0.01}/>
              </linearGradient>
              <linearGradient id="sdp-resolved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TONE_VAR.success} stopOpacity={0.2}/>
                <stop offset="100%" stopColor={TONE_VAR.success} stopOpacity={0.01}/>
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="label" interval={tickInterval} minTickGap={18} tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false}/>
            <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={36}/>
            <Tooltip cursor={{ stroke: AXIS, strokeDasharray: '3 3', strokeWidth: 1 }} labelFormatter={tooltipDate} contentStyle={{
            background: 'rgb(var(--c-surface-raised))',
            border: '1px solid rgb(var(--c-line))',
            borderRadius: 10,
            boxShadow: '0 8px 20px rgb(var(--c-shadow) / 0.14)',
            fontSize: 12,
            color: 'rgb(var(--c-ink))',
        }} itemStyle={{ color: 'rgb(var(--c-ink))' }}/>
            <Area type="monotone" dataKey="created" name="Created" stroke={TONE_VAR.primary} strokeWidth={2} fill="url(#sdp-created)" activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--c-surface-raised))' }}/>
            <Area type="monotone" dataKey="resolved" name="Resolved" stroke={TONE_VAR.success} strokeWidth={2} fill="url(#sdp-resolved)" activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--c-surface-raised))' }}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        Created and resolved ticket counts by day. Exact values are available in the table below.
      </figcaption>
      <details className="mt-1 text-xs text-ink-muted">
        <summary className="w-fit cursor-pointer rounded text-2xs font-medium text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60">
          View data table
        </summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-line">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">Created</th>
                <th className="text-right">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (<tr key={point.date}>
                  <td>{point.label}</td>
                  <td className="tabular text-right">{point.created}</td>
                  <td className="tabular text-right">{point.resolved}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>);
}
function toneFor(row, kind) {
    if (kind === 'status')
        return ticketStatusMeta(row.key).tone;
    if (kind === 'priority')
        return priorityMeta(row.key).tone;
    return 'primary';
}
export function BreakdownBars({ rows, kind, }) {
    if (rows.length === 0) {
        return <p className="py-8 text-center text-xs text-ink-subtle">Nothing to show yet.</p>;
    }
    /* Bars are relative to the largest row, not the total. The adjacent share gives the
     * absolute context while keeping smaller rows visible. */
    const peak = Math.max(...rows.map((row) => row.count), 1);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return (<ul className="space-y-3">
      {rows.map((row) => {
            const share = total === 0 ? 0 : Math.round((row.count / total) * 100);
            const width = Math.round((row.count / peak) * 100);
            return (<li key={row.key}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-medium text-ink-muted">{row.label}</span>
              <span className="shrink-0 text-2xs text-ink-subtle">
                <span className="tabular font-semibold text-ink">{row.count}</span>
                <span className="ml-1.5 tabular">{share}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={`${row.label}: ${row.count}, ${share}% of shown total`}>
              <div className={cn('h-full min-w-px rounded-full', TONE_SOLID[toneFor(row, kind)])} style={{
                    width: `${width}%`,
                    ...(kind === 'category' && row.color ? { backgroundColor: row.color } : {}),
                }}/>
            </div>
          </li>);
        })}
    </ul>);
}
