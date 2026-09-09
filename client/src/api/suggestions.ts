/**
 * ServiceDesk Pro — the ticket suggestion hook.
 *
 * A mutation, not a query, and that is the point: it fires when the person writing a
 * ticket asks for it, never on a timer and never on every keystroke. The result is
 * held in component state and applied only if they click "use this". Nothing here
 * writes to a ticket.
 *
 * `SERVICE_UNAVAILABLE` is the honest answer when suggestions are switched off in
 * settings, so the caller shows the panel as unavailable rather than as an error.
 */

import { useMutation } from '@tanstack/react-query';
import type { TicketSuggestionDto, TicketSuggestionRequest } from '@shared/types';
import { api } from '@/lib/api';

export function useTicketSuggestion() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: TicketSuggestionRequest) =>
      api.post<TicketSuggestionDto>('/suggestions/ticket', input),
  });
}
