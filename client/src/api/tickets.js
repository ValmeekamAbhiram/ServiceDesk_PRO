import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';
const asParams = (query) => ({
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
export function useTickets(query, enabled = true) {
    return useQuery({
        queryKey: keys.tickets.list(query),
        queryFn: () => api.get('/tickets', asParams(query)),
        enabled,
        /* Keeps the previous page visible while the next one loads, so paging and
         * filtering do not blank the table on every keystroke. */
        placeholderData: (previous) => previous,
    });
}
export function useTicket(id) {
    return useQuery({
        queryKey: keys.tickets.detail(id ?? ''),
        queryFn: () => api.get(`/tickets/${id}`),
        enabled: Boolean(id),
    });
}
export function useTicketComments(id) {
    return useQuery({
        queryKey: keys.tickets.comments(id ?? ''),
        queryFn: () => api.get(`/tickets/${id}/comments`, { limit: 100 }),
        enabled: Boolean(id),
    });
}
/** Everything a ticket write should refresh, in one place. */
function invalidateTicket(id) {
    void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
    void queryClient.invalidateQueries({ queryKey: keys.dashboard.all });
    if (id)
        void queryClient.invalidateQueries({ queryKey: keys.tickets.comments(id) });
}
export function useCreateTicket() {
    return useMutation({
        meta: { silent: true },
        mutationFn: ({ input, files }) => {
            if (files.length === 0)
                return api.post('/tickets', input);
            /* Multipart only when there is actually a file: a JSON body is easier to debug
             * and the server accepts either. */
            const form = new FormData();
            form.append('title', input.title);
            form.append('description', input.description);
            form.append('categoryId', input.categoryId);
            if (input.priority)
                form.append('priority', input.priority);
            if (input.assetId)
                form.append('assetId', input.assetId);
            for (const file of files)
                form.append('files', file);
            return api.postForm('/tickets', form);
        },
        onSuccess: () => invalidateTicket(),
    });
}
export function useUpdateTicket(id) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.patch(`/tickets/${id}`, input),
        onSuccess: () => invalidateTicket(id),
    });
}
export function useChangeStatus(id) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.patch(`/tickets/${id}/status`, input),
        onSuccess: () => invalidateTicket(id),
    });
}
export function useAssignTicket(id) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.patch(`/tickets/${id}/assign`, input),
        onSuccess: () => invalidateTicket(id),
    });
}
export function useReopenTicket(id) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.post(`/tickets/${id}/reopen`, input),
        onSuccess: () => invalidateTicket(id),
    });
}
export function useAddComment(id) {
    const client = useQueryClient();
    return useMutation({
        meta: { silent: true },
        mutationFn: ({ input, files }) => {
            if (files.length === 0)
                return api.post(`/tickets/${id}/comments`, input);
            const form = new FormData();
            form.append('body', input.body);
            if (input.visibility)
                form.append('visibility', input.visibility);
            for (const file of files)
                form.append('files', file);
            return api.postForm(`/tickets/${id}/comments`, form);
        },
        onSuccess: () => {
            /* The ticket itself changes too: a first reply stops the response SLA clock and
             * the comment count is on the list row. */
            void client.invalidateQueries({ queryKey: keys.tickets.comments(id) });
            invalidateTicket(id);
        },
    });
}
