/**
 * ServiceDesk Pro — the status history of one ticket.
 *
 * Read straight from `ticket.statusHistory`, which the server embeds on the ticket
 * document. It is append-only there and read-only here: this is the record of what
 * happened, so nothing on this page can edit it.
 *
 * The first entry has `from: null` — that is the ticket being raised, not a transition,
 * and it is worded differently for exactly that reason.
 */

import { relativeTime } from '@shared/utils';
import type { TicketStatusChangeDto } from '@shared/types';
import { ticketStatusMeta } from '@shared/labels';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/domain/MetaBadge';
import { useNow } from '@/hooks/useNow';
import { TONE_SOLID } from '@/lib/tone';
import { cn } from '@/lib/cn';

export function TicketTimeline({ history }: { history: TicketStatusChangeDto[] }) {
  const now = useNow();

  if (history.length === 0) {
    return <p className="text-xs text-ink-subtle">Nothing has happened yet.</p>;
  }

  /* Newest first: the current state of the ticket is the thing people came to read. */
  const entries = [...history].reverse();

  return (
    <ol className="timeline-rail space-y-4">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex gap-3">
          {/* `ml` and `ring-surface` together punch the marker through the rail, which
              `.timeline-rail` paints at a fixed 0.6875rem from the left edge. */}
          <span
            className={cn(
              'mt-1 ml-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-surface',
              TONE_SOLID[ticketStatusMeta(entry.to).tone]
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              {entry.from === null ? (
                <>Raised as <StatusBadge status={entry.to} /></>
              ) : (
                <>
                  <StatusBadge status={entry.from} />
                  <span aria-hidden="true">&rarr;</span>
                  <StatusBadge status={entry.to} />
                </>
              )}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
              <Avatar name={entry.by?.name} size="xs" />
              <span className="truncate">{entry.by?.name ?? 'System'}</span>
              <span aria-hidden="true">&middot;</span>
              <time dateTime={entry.at}>{relativeTime(entry.at, now)}</time>
            </p>
            {entry.note && <p className="text-xs text-ink">{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
