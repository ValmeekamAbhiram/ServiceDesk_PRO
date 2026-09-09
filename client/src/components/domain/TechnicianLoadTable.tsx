/**
 * ServiceDesk Pro — who is carrying what.
 *
 * Staff-only, and enforced by the server: `technicianLoad` is empty in an employee's
 * dashboard response. Derived utilization bars compare each technician with the
 * busiest returned row; they are relative workload cues, not capacity claims.
 */

import type { TechnicianLoadDto } from '@shared/types';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';

export function TechnicianLoadTable({ rows }: { rows: TechnicianLoadDto[] }) {
  const peakOpen = Math.max(...rows.map((row) => row.open), 1);

  return (
    <div className="overflow-x-auto">
      <table className="table table-compact">
        <caption className="sr-only">Current technician workload and recent service performance</caption>
        <thead>
          <tr>
            <th>Technician</th>
            <th className="min-w-36">Relative workload</th>
            <th className="text-right">Open</th>
            <th className="text-right">Resolved (7d)</th>
            <th className="text-right">Breached</th>
            <th className="text-right">Avg resolution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const workload = Math.round((row.open / peakOpen) * 100);

            return (
              <tr key={row.technician.id}>
                <td>
                  <span className="flex items-center gap-2">
                    <Avatar name={row.technician.name} size="xs" />
                    <span className="truncate text-xs font-medium text-ink">
                      {row.technician.name}
                    </span>
                  </span>
                </td>
                <td>
                  <div
                    className="h-1.5 min-w-28 overflow-hidden rounded-full bg-surface-sunken"
                    role="img"
                    aria-label={`${row.technician.name}: ${workload}% of the highest open workload shown`}
                  >
                    <div
                      className={cn(
                        'h-full min-w-px rounded-full',
                        row.breached > 0 ? 'bg-danger-solid' : 'bg-brand-600'
                      )}
                      style={{ width: `${workload}%` }}
                    />
                  </div>
                </td>
                <td className="tabular text-right text-xs font-semibold text-ink">{row.open}</td>
                <td className="tabular text-right text-xs text-ink-muted">{row.resolvedLast7Days}</td>
                <td
                  className={cn(
                    'tabular text-right text-xs font-semibold',
                    row.breached > 0 ? 'text-danger-fg' : 'text-ink-subtle'
                  )}
                >
                  {row.breached}
                </td>
                <td className="tabular whitespace-nowrap text-right text-xs text-ink-muted">
                  {row.avgResolutionHours === null ? '—' : `${row.avgResolutionHours} h`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
