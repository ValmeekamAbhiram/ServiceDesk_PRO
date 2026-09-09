import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddCommentRequest,
  AssignTicketRequest,
  ChangeTicketStatusRequest,
  CreateTicketRequest,
  Paginated,
  TicketCommentDto,
  TicketDto,
  TicketListItemDto,
  TicketListQuery,
  UpdateTicketRequest,
} from '@shared/types';
import { api, type QueryParams } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';

/**
 * Ticket reads and writes.
 *
 * Every mutation invalidates `keys.tickets.all` rather than patching the cache by hand.
 * A ticket write changes more than the ticket — the dashboard's counters, the SLA state,
 * the timeline, the assignee's counts — and hand-rolled cache surgery that gets one of
 * those wrong shows the user a number that is quietly false. Refetching is a request the
 * server answers authoritatively.
 */

export type TicketQuery = TicketListQuery & {
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'dueAt' | 'number';
  sortOrder?: 'asc' | 'desc';
};

const asParams = (query: TicketQuery): QueryParams => ({
  page: query.page,
  limit: query.limit,
  sortBy: query.sortBy,
  sortOrder: query.sortOrder,
  q: query.q,
  status: query.status,
  priority: query.priority,
  categoryId: query.categoryId,
  assigneeId: query.assigneeId,
  requesterId: query.requesterId,
  assetId: query.assetId,
  scope: query.scope,
  breached: query.breached,
  createdFrom: query.createdFrom,
  createdTo: query.createdTo,
});

export function useTickets(query: TicketQuery, enabled = true) {
  return useQuery({
    queryKey: keys.tickets.list(query),
    queryFn: () => api.get<Paginated<TicketListItemDto>>('/tickets', asParams(query)),
    enabled,
    /* Keeps the previous page visible while the next one loads, so paging and
     * filtering do not blank the table on every keystroke. */
    placeholderData: (previous) => previous,
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: keys.tickets.detail(id ?? ''),
    queryFn: () => api.get<TicketDto>(`/tickets/${id}`),
    enabled: Boolean(id),
  });
}

export function useTicketComments(id: string | undefined) {
  return useQuery({
    queryKey: keys.tickets.comments(id ?? ''),
    queryFn: () => api.get<Paginated<TicketCommentDto>>(`/tickets/${id}/comments`, { limit: 100 }),
    enabled: Boolean(id),
  });
}

/** Everything a ticket write should refresh, in one place. */
function invalidateTicket(id?: string): void {
  void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
  void queryClient.invalidateQueries({ queryKey: keys.dashboard.all });
  if (id) void queryClient.invalidateQueries({ queryKey: keys.tickets.comments(id) });
}

export function useCreateTicket() {
  return useMutation({
    meta: { silent: true },
    mutationFn: ({ input, files }: { input: CreateTicketRequest; files: File[] }) => {
      if (files.length === 0) return api.post<TicketDto>('/tickets', input);

      /* Multipart only when there is actually a file: a JSON body is easier to debug
       * and the server accepts either. */
      const form = new FormData();
      form.append('title', input.title);
      form.append('description', input.description);
      form.append('categoryId', input.categoryId);
      if (input.priority) form.append('priority', input.priority);
      if (input.assetId) form.append('assetId', input.assetId);
      for (const file of files) form.append('files', file);
      return api.postForm<TicketDto>('/tickets', form);
    },
    onSuccess: () => invalidateTicket(),
  });
}

export function useUpdateTicket(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: UpdateTicketRequest) => api.patch<TicketDto>(`/tickets/${id}`, input),
    onSuccess: () => invalidateTicket(id),
  });
}

export function useChangeStatus(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: ChangeTicketStatusRequest) =>
      api.patch<TicketDto>(`/tickets/${id}/status`, input),
    onSuccess: () => invalidateTicket(id),
  });
}

export function useAssignTicket(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: AssignTicketRequest) => api.patch<TicketDto>(`/tickets/${id}/assign`, input),
    onSuccess: () => invalidateTicket(id),
  });
}

export function useReopenTicket(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { note?: string; version: number }) =>
      api.post<TicketDto>(`/tickets/${id}/reopen`, input),
    onSuccess: () => invalidateTicket(id),
  });
}

export function useAddComment(id: string) {
  const client = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: ({ input, files }: { input: AddCommentRequest; files: File[] }) => {
      if (files.length === 0) return api.post<TicketCommentDto>(`/tickets/${id}/comments`, input);

      const form = new FormData();
      form.append('body', input.body);
      if (input.visibility) form.append('visibility', input.visibility);
      for (const file of files) form.append('files', file);
      return api.postForm<TicketCommentDto>(`/tickets/${id}/comments`, form);
    },
    onSuccess: () => {
      /* The ticket itself changes too: a first reply stops the response SLA clock and
       * the comment count is on the list row. */
      void client.invalidateQueries({ queryKey: keys.tickets.comments(id) });
      invalidateTicket(id);
    },
  });
}
