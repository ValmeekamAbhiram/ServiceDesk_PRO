/**
 * ServiceDesk Pro — user administration hooks.
 *
 * `useUsers` is admin-only on the server; nothing here re-checks that, because a
 * second copy of the rule in the client would be a second place to get it wrong. The
 * page that calls this is behind a permission gate for the sake of not showing a
 * navigation item that 403s, and the 403 is the actual enforcement.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';
const asParams = (query) => ({
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    q: query.q,
    role: query.role,
    status: query.status,
});
export function useUsers(query, enabled = true) {
    return useQuery({
        queryKey: keys.users.list(query),
        queryFn: () => api.get('/users', asParams(query)),
        enabled,
        placeholderData: (previous) => previous,
    });
}
export function useUpdateUser(id) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.patch(`/users/${id}`, input),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: keys.users.all });
            /* A role change moves people in and out of the assignee list, and a name change
             * is embedded in every ticket row that names them. */
            void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
        },
    });
}
/**
 * The self-service edit, against `PATCH /users/me`.
 *
 * Its own hook rather than `useUpdateUser(myId)`, because the endpoint is a different
 * one with a narrower body: no `role` and no `status`, so there is nothing here that
 * could hand somebody a permission. The caller folds the response back into the auth
 * store, since `/auth/me` carries the permission list and this response does not.
 */
export function useUpdateOwnProfile() {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.patch('/users/me', input),
        onSuccess: () => {
            /* A renamed person is embedded in every ticket row and comment that names them. */
            void queryClient.invalidateQueries({ queryKey: keys.users.all });
            void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
        },
    });
}
