/**
 * ServiceDesk Pro — the knowledge base shelf.
 *
 * One query, not two. `GET /api/articles` already runs the Mongo text search when `?q=`
 * is present and sorts by relevance instead of the chosen column, so searching is a
 * filter here rather than a separate mode. The dedicated `/articles/search` endpoint is
 * published-only and exists for the suggestion panel; using it here would make an
 * author unable to find their own draft.
 *
 * The status filter is offered to everyone and narrows nothing that the server has not
 * already narrowed. An employee asking for `?status=DRAFT` gets their own drafts and
 * nobody else's, because `article.service.list` builds the visibility clause from the
 * caller — this page has no idea which rows exist.
 */

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, Eye, Plus, Search, Tag, X } from 'lucide-react';
import { ArticleStatus, Permission } from '@shared/enums';
import { ARTICLE_STATUS_META } from '@shared/labels';
import { formatNumber, relativeTime } from '@shared/utils';
import { useArticles, type ArticleQuery } from '@/api/articles';
import { useCategories } from '@/api/reference';
import { useAuthStore } from '@/stores/auth.store';
import { useNow } from '@/hooks/useNow';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { ArticleStatusBadge } from '@/components/domain/MetaBadge';

const PAGE_SIZE = 12;

const SORTS = [
  { value: 'updatedAt', label: 'Recently updated' },
  { value: 'publishedAt', label: 'Recently published' },
  { value: 'viewCount', label: 'Most read' },
  { value: 'title', label: 'Title A–Z' },
] as const;

export default function ArticleList() {
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const canWrite = useAuthStore((state) => state.can(Permission.ARTICLE_WRITE));
  const categories = useCategories();

  const query = useMemo<ArticleQuery>(
    () => ({
      page: Number(params.get('page') ?? 1),
      limit: PAGE_SIZE,
      q: params.get('q') ?? undefined,
      status: (params.get('status') as ArticleStatus | null) ?? undefined,
      categoryId: params.get('categoryId') ?? undefined,
      tag: params.get('tag') ?? undefined,
      sortBy: (params.get('sortBy') as ArticleQuery['sortBy']) ?? 'updatedAt',
      sortOrder: params.get('sortBy') === 'title' ? 'asc' : 'desc',
    }),
    [params]
  );

  const articles = useArticles(query);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const filtered = ['q', 'status', 'categoryId', 'tag'].some((key) => params.has(key));
  const rows = articles.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-ink">Knowledge base</h1>
          <p className="text-xs text-ink-subtle">
            Fixes worth writing down once instead of explaining every week.
          </p>
        </div>
        {canWrite && (
          <Link to="/knowledge/new" className="btn btn-primary btn-sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Write an article
          </Link>
        )}
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-[14rem] flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              const field = event.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
              setParam('q', field?.value.trim() ?? null);
            }}
          >
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden="true"
            />
            <Input
              key={params.get('q') ?? ''}
              name="q"
              defaultValue={params.get('q') ?? ''}
              placeholder="Search titles, summaries, tags…"
              className="pl-8"
              aria-label="Search articles"
            />
          </form>
          <Select
            aria-label="Category"
            value={params.get('categoryId') ?? ''}
            onChange={(event) => setParam('categoryId', event.target.value)}
            className="w-auto"
          >
            <option value="">Any category</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          {/* Disabled rather than hidden while searching: the server replaces the sort
            * with relevance when `q` is set, and a dropdown that silently stops working
            * is worse than one that says why. */}
          <Select
            aria-label="Sort by"
            title={query.q ? 'Search results are ordered by relevance.' : undefined}
            disabled={Boolean(query.q)}
            value={query.sortBy}
            onChange={(event) => setParam('sortBy', event.target.value)}
            className="w-auto"
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </Select>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
              <X className="h-4 w-4" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {Object.values(ArticleStatus).map((status) => {
            const on = params.get('status') === status;
            return (
              <button
                key={status}
                type="button"
                className={on ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'}
                aria-pressed={on}
                onClick={() => setParam('status', on ? null : status)}
              >
                {ARTICLE_STATUS_META[status].label}
              </button>
            );
          })}
          {/* Tags are only reachable from an article, so this shows the active one with a
            * way out rather than listing every tag in the corpus. */}
          {query.tag && (
            <button type="button" className="chip border-brand-300 bg-brand-50 text-brand-700" onClick={() => setParam('tag', null)}>
              <Tag className="h-3 w-3" aria-hidden="true" />
              {query.tag}
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </Card>

      {articles.isLoading ? (
        <Card className="p-4">
          <SkeletonRows rows={4} cols={2} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
            title={filtered ? 'Nothing matches that' : 'The shelf is empty'}
            message={
              filtered
                ? 'Try fewer words, or clear the filters to see everything published.'
                : canWrite
                  ? 'Write the answer to the question you have already answered three times.'
                  : 'Nothing has been published yet. Raise a ticket and someone will help.'
            }
            action={
              canWrite && !filtered ? (
                <Link to="/knowledge/new" className="btn btn-primary btn-sm">
                  Write the first one
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((article) => (
              <Link
                key={article.id}
                to={`/knowledge/${article.id}`}
                className="card flex flex-col gap-2 p-4 transition hover:border-brand-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold leading-snug text-ink">{article.title}</h2>
                  {article.status === ArticleStatus.DRAFT && <ArticleStatusBadge status={article.status} />}
                </div>
                <p className="line-clamp-3 text-xs leading-relaxed text-ink-subtle">{article.summary}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-ink-subtle">
                  {article.category && <span>{article.category.label}</span>}
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    {formatNumber(article.viewCount)}
                  </span>
                  <time dateTime={article.updatedAt}>{relativeTime(article.updatedAt, now)}</time>
                </div>
              </Link>
            ))}
          </div>
          {articles.data && (
            <Card>
              <Pagination
                meta={articles.data.meta}
                unit="article"
                onPageChange={(page) => setParam('page', String(page))}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
