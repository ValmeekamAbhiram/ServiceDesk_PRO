import { useMutation, useQuery } from '@tanstack/react-query';
import type { CategoryDto, CategoryInput, UserRefDto } from '@shared/types';
import { api } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';

/**
 * The two lookup lists every form needs: categories, and the people a ticket may be
 * assigned to.
 *
 * Both are cached for much longer than ticket data. They change when an administrator
 * changes them, not as work happens, and re-fetching the category list on every ticket
 * page would be traffic for nothing.
 *
 * `useAssignees` is the reason the client never builds its own "who is staff" list: the
 * server answers with exactly the users who may hold a ticket, so a role rule lives in
 * one place instead of being re-derived in a dropdown.
 */

const REFERENCE_STALE_MS = 10 * 60_000;

/**
 * `includeInactive` is asked for by the admin table and by nothing else. The server only
 * honours it for a caller holding `settings:manage`, so passing it from a picker would
 * not widen anything — it is a separate cache key here purely so the two callers cannot
 * hand each other the wrong list of rows.
 */
export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: keys.categories.list(includeInactive),
    /* Categories come back as a plain array under `data`, not a paginated envelope. */
    queryFn: () =>
      api.get<CategoryDto[]>('/categories', includeInactive ? { includeInactive: true } : {}),
    staleTime: REFERENCE_STALE_MS,
  });
}

export function useAssignees(enabled = true) {
  return useQuery({
    queryKey: keys.users.assignees,
    queryFn: () => api.get<UserRefDto[]>('/users/assignees'),
    staleTime: REFERENCE_STALE_MS,
    enabled,
  });
}

export function useCreateCategory() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: CategoryInput) => api.post<CategoryDto>('/categories', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.categories.all }),
  });
}

export function useUpdateCategory(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: Partial<CategoryInput>) =>
      api.patch<CategoryDto>(`/categories/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.categories.all });
      /* A renamed category is embedded in every ticket row that names it. */
      void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
    },
  });
}
