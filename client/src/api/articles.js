/**
 * ServiceDesk Pro — knowledge base hooks.
 *
 * Two read paths, deliberately separate. `useArticles` is the browse list —
 * filtered, paged, sorted, and it returns whole rows. `useArticleSearch` is the
 * text search, which returns hits with a relevance score and no body. They are not
 * one hook with a flag because the shapes differ and a component that renders a
 * score does not want to receive rows that have none.
 *
 * Publishing is its own mutation against its own endpoint. That mirrors the server,
 * where `status` is absent from the write shape precisely so an author cannot publish
 * their own draft by naming the field.
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
    status: query.status,
    categoryId: query.categoryId,
    tag: query.tag,
});
export function useArticles(query) {
    return useQuery({
        queryKey: keys.articles.list(query),
        queryFn: () => api.get('/articles', asParams(query)),
        placeholderData: (previous) => previous,
    });
}
/**
 * `enabled` on a two-character minimum: a one-letter text search matches most of
 * the corpus and is never what the person typing meant.
 */
export function useArticleSearch(q, limit = 5, enabled = true) {
    const term = q.trim();
    return useQuery({
        queryKey: keys.articles.search(`${term}:${limit}`),
        queryFn: () => api.get('/articles/search', { q: term, limit }),
        enabled: enabled && term.length >= 2,
        staleTime: 60_000,
    });
}
export function useArticle(id) {
    return useQuery({
        queryKey: keys.articles.detail(id ?? 'none'),
        queryFn: () => api.get(`/articles/${id}`),
        enabled: Boolean(id),
    });
}
export function useCreateArticle() {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.post('/articles', input),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.articles.all }),
    });
}
export function useUpdateArticle(id) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => api.patch(`/articles/${id}`, input),
        onSuccess: (article) => {
            queryClient.setQueryData(keys.articles.detail(id), article);
            void queryClient.invalidateQueries({ queryKey: keys.articles.all });
        },
    });
}
/**
 * Publish carries the version; retract does not. The asymmetry is the server's, and
 * copying it here keeps the two ends honest: publishing is a review decision about a
 * specific draft, so it must fail if that draft moved under the reviewer, while
 * retracting is a withdrawal that should not be blocked by a stale form.
 */
export function useSetArticlePublished(id) {
    return useMutation({
        meta: { silent: true },
        mutationFn: (input) => input.publish
            ? api.post(`/articles/${id}/publish`, { version: input.version })
            : api.post(`/articles/${id}/retract`, {}),
        onSuccess: (article) => {
            queryClient.setQueryData(keys.articles.detail(id), article);
            void queryClient.invalidateQueries({ queryKey: keys.articles.all });
        },
    });
}
