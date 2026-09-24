/**
 * ServiceDesk Pro — notification hooks.
 *
 * The bell shows unread items; the panel can switch to everything. Both use the same
 * list endpoint with `unreadOnly`, and both come back with `unreadCount` for the whole
 * inbox rather than for the page — which is what the badge needs, since a badge that
 * counted only the first twenty would stop climbing at twenty.
 *
 * Marking one read answers with the refreshed list, so the badge and the row update
 * from the same response instead of from a second request.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';
export function useNotifications(query) {
    return useQuery({
        queryKey: keys.notifications.list(query),
        queryFn: () => api.get('/notifications', {
            page: query.page,
            limit: query.limit,
            unreadOnly: query.unreadOnly,
        }),
        placeholderData: (previous) => previous,
        /* The socket pushes new ones, so a poll would only duplicate them. This refetch
         * covers the window where the tab was in the background. */
        refetchOnWindowFocus: true,
    });
}
export function useMarkNotificationRead(query) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (id) => api.post(`/notifications/${id}/read`, undefined, {
            page: query.page,
            limit: query.limit,
            unreadOnly: query.unreadOnly,
        }),
        onSuccess: (list) => {
            queryClient.setQueryData(keys.notifications.list(query), list);
            void queryClient.invalidateQueries({ queryKey: keys.notifications.all });
        },
    });
}
export function useMarkAllNotificationsRead(query) {
    return useMutation({
        meta: { silent: true },
        mutationFn: () => api.post('/notifications/read-all', undefined, {
            page: query.page,
            limit: query.limit,
            unreadOnly: query.unreadOnly,
        }),
        onSuccess: (list) => {
            queryClient.setQueryData(keys.notifications.list(query), list);
            void queryClient.invalidateQueries({ queryKey: keys.notifications.all });
        },
    });
}
