/**
 * ServiceDesk Pro — one ticket as a table row.
 *
 * Shared by the ticket list and the dashboard's "needs attention" panel, so a row
 * means the same thing in both places. The whole row navigates; the number is also a
 * real link so middle-click and "open in new tab" work, which a `div` with an onClick
 * silently breaks.
 */

import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Paperclip } from 'lucide-react';
import type { TicketListItemDto } from '@shared/types';
import { relativeTime } from '@shared/utils';
import { PriorityBadge, StatusBadge } from './MetaBadge';
import { SlaChip } from './SlaCountdown';
import { Avatar } from '@/components/ui/Avatar';

export function TicketRow({
  ticket,
  now,
  showRequester = true,
}: {
  ticket: TicketListItemDto;
  now: number;
  showRequester?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <tr
      onClick={() => navigate(`/tickets/${ticket.id}`)}
      className="cursor-pointer transition-colors hover:bg-brand-50"
    >
      <td className="whitespace-nowrap">
        <Link
          to={`/tickets/${ticket.id}`}
          className="font-mono text-xs font-semibold text-brand-600 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {ticket.number}
        </Link>
      </td>

      <td className="min-w-[16rem] max-w-[26rem]">
        <span className="block truncate font-medium text-ink">{ticket.title}</span>
        <span className="mt-0.5 flex items-center gap-2.5 text-2xs text-ink-subtle">
          {ticket.category && <span className="truncate">{ticket.category.label}</span>}
          {ticket.commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              {ticket.commentCount}
            </span>
          )}
          {ticket.attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              {ticket.attachmentCount}
            </span>
          )}
        </span>
      </td>

      <td>
        <StatusBadge status={ticket.status} />
      </td>
      <td>
        <PriorityBadge priority={ticket.priority} />
      </td>

      {showRequester && (
        <td className="whitespace-nowrap">
          {ticket.requester ? (
            <span className="flex items-center gap-2">
              <Avatar name={ticket.requester.name} size="xs" />
              <span className="truncate text-xs text-ink-muted">{ticket.requester.name}</span>
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">—</span>
          )}
        </td>
      )}

      <td className="whitespace-nowrap">
        {ticket.assignee ? (
          <span className="flex items-center gap-2">
            <Avatar name={ticket.assignee.name} size="xs" />
            <span className="truncate text-xs text-ink-muted">{ticket.assignee.name}</span>
          </span>
        ) : (
          <span className="text-xs text-ink-subtle">Unassigned</span>
        )}
      </td>

      <td className="whitespace-nowrap">
        <SlaChip target={ticket.sla.resolution} />
      </td>

      <td className="whitespace-nowrap text-xs text-ink-subtle">
        {relativeTime(ticket.updatedAt, now)}
      </td>
    </tr>
  );
}
