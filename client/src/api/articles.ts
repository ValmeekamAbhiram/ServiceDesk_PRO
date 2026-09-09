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
import type {
  ArticleDto,
  ArticleInput,
  ArticleListQuery,
  ArticleSearchHitDto,
  Paginated,
} from '@shared/types';
import { api, type QueryParams } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';

export type ArticleQuery = ArticleListQuery & {
  sortBy?: 'updatedAt' | 'publishedAt' | 'viewCount' | 'title';
  sortOrder?: 'asc' | 'desc';
};

const asParams = (query: ArticleQuery): QueryParams => ({
  page: query.page,
  limit: query.limit,
  sortBy: query.sortBy,
  sortOrder: query.sortOrder,
  q: query.q,
  status: query.status,
  categoryId: query.categoryId,
  tag: query.tag,
});

export function useArticles(query: ArticleQuery) {
  return useQuery({
    queryKey: keys.articles.list(query),
    queryFn: () => api.get<Paginated<ArticleDto>>('/articles', asParams(query)),
    placeholderData: (previous) => previous,
  });
}

/**
 * `enabled` on a two-character minimum: a one-letter text search matches most of
 * the corpus and is never what the person typing meant.
 */
export function useArticleSearch(q: string, limit = 5, enabled = true) {
  const term = q.trim();
  return useQuery({
    queryKey: keys.articles.search(`${term}:${limit}`),
    queryFn: () => api.get<ArticleSearchHitDto[]>('/articles/search', { q: term, limit }),
    enabled: enabled && term.length >= 2,
    staleTime: 60_000,
  });
}

export function useArticle(id: string | undefined) {
  return useQuery({
    queryKey: keys.articles.detail(id ?? 'none'),
    queryFn: () => api.get<ArticleDto>(`/articles/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateArticle() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: ArticleInput) => api.post<ArticleDto>('/articles', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.articles.all }),
  });
}

export function useUpdateArticle(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: Partial<ArticleInput> & { version: number }) =>
      api.patch<ArticleDto>(`/articles/${id}`, input),
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
export function useSetArticlePublished(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: { publish: boolean; version?: number }) =>
      input.publish
        ? api.post<ArticleDto>(`/articles/${id}/publish`, { version: input.version })
        : api.post<ArticleDto>(`/articles/${id}/retract`, {}),
    onSuccess: (article) => {
      queryClient.setQueryData(keys.articles.detail(id), article);
      void queryClient.invalidateQueries({ queryKey: keys.articles.all });
    },
  });
}
