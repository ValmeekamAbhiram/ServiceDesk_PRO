import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api';
import { toast } from '@/stores/toast.store';

/**
 * One `QueryClient`, with two global policies worth stating plainly.
 *
 * **Retries are for network failures only.** A 403 or a 404 will answer the same way
 * however many times it is asked, and retrying a rejected write is how a "create ticket"
 * that failed validation becomes three tickets. Only a request that never got an answer
 * is retried, and only once.
 *
 * **Every failed mutation surfaces the server's own message.** The API writes error
 * messages to be read by a user, so they are shown verbatim; the client never invents a
 * reason and never shows a stack trace. A form that renders the error itself opts out
 * with `meta: { silent: true }` so the message does not appear twice.
 */

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return error instanceof ApiClientError && error.status === null;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      /* Live updates arrive over the socket, so polling would only duplicate them. */
      refetchInterval: false,
    },
    mutations: { retry: false },
  },

  queryCache: new QueryCache({
    onError: (error, query) => {
      /* A failed background refetch of data already on screen is not worth a toast;
       * a first load that fails is rendered as an error state by the page itself. */
      if (query.state.data !== undefined && error instanceof ApiClientError) {
        toast.error(error.message);
      }
    },
  }),

  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return;
      toast.error(error instanceof ApiClientError ? error.message : 'Something went wrong.');
    },
  }),
});

/**
 * Query keys in one place.
 *
 * Written as a tree so an invalidation can be as coarse or as precise as it needs to be:
 * `keys.tickets.all` after a status change refetches every ticket list and detail,
 * while `keys.tickets.detail(id)` touches only the page being looked at.
 */
export const keys = {
  auth: { me: ['auth', 'me'] as const },
  tickets: {
    all: ['tickets'] as const,
    list: (query: unknown) => ['tickets', 'list', query] as const,
    detail: (id: string) => ['tickets', 'detail', id] as const,
    comments: (id: string) => ['tickets', 'comments', id] as const,
  },
  categories: {
    all: ['categories'] as const,
    /* Two caches, not one. The admin table asks for retired categories and the pickers
     * must not receive them, and `invalidateQueries({ queryKey: ['categories'] })`
     * still refreshes both. */
    list: (includeInactive: boolean) => ['categories', { includeInactive }] as const,
  },
  assets: {
    all: ['assets'] as const,
    list: (query: unknown) => ['assets', 'list', query] as const,
    detail: (id: string) => ['assets', 'detail', id] as const,
  },
  articles: {
    all: ['articles'] as const,
    list: (query: unknown) => ['articles', 'list', query] as const,
    detail: (id: string) => ['articles', 'detail', id] as const,
    search: (q: string) => ['articles', 'search', q] as const,
  },
  users: {
    all: ['users'] as const,
    list: (query: unknown) => ['users', 'list', query] as const,
    assignees: ['users', 'assignees'] as const,
  },
  dashboard: { all: ['dashboard'] as const },
  /* One key, no list variant: there is exactly one policy document and one settings
   * document, so there is nothing to key a page or a filter by. */
  slaPolicy: ['sla-policy'] as const,
  settings: ['settings'] as const,
  demoClock: ['demo', 'clock'] as const,
  audit: {
    all: ['audit'] as const,
    list: (query: unknown) => ['audit', 'list', query] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (query: unknown) => ['notifications', 'list', query] as const,
  },
};
