/**
 * ServiceDesk Pro — one knowledge base article.
 *
 * The review boundary is the whole point of this page's layout. Holding `ARTICLE_WRITE`
 * gets you an Edit button. Publishing is a *separate* permission on a *separate*
 * endpoint, so it is a separate control, shown only to someone who actually holds
 * `ARTICLE_PUBLISH` — and it carries the version, so a reviewer cannot approve a draft
 * that changed while they were reading it.
 *
 * The body is Markdown and is rendered by `@/lib/markdown`, which builds React elements
 * and never an HTML string. There is no `dangerouslySetInnerHTML` here and nothing to
 * sanitise: markup in the source comes out as characters because the renderer has no
 * path that produces markup.
 *
 * The view counter increments server-side on `GET /:id`. That is why this page does not
 * try to be clever about refetching — every genuine read is one visit, which is what the
 * number is supposed to mean.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Eye, Pencil, Send, Undo2 } from 'lucide-react';
import { ArticleStatus, Permission } from '@shared/enums';
import { formatNumber, relativeTime } from '@shared/utils';
import { useArticle, useSetArticlePublished } from '@/api/articles';
import { ApiClientError } from '@/lib/api';
import { Markdown } from '@/lib/markdown';
import { useAuthStore } from '@/stores/auth.store';
import { useNow } from '@/hooks/useNow';
import { toast } from '@/stores/toast.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Avatar } from '@/components/ui/Avatar';
import { ArticleStatusBadge } from '@/components/domain/MetaBadge';
export default function ArticleDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const now = useNow();
    const article = useArticle(id);
    const publish = useSetArticlePublished(id ?? '');
    const [confirming, setConfirming] = useState(null);
    const canWrite = useAuthStore((state) => state.can(Permission.ARTICLE_WRITE));
    const canPublish = useAuthStore((state) => state.can(Permission.ARTICLE_PUBLISH));
    if (article.isLoading) {
        return (<div className="space-y-4">
        <Skeleton className="h-6 w-2/3"/>
        <Card className="space-y-3 p-6">
          <Skeleton className="h-4 w-full"/>
          <Skeleton className="h-4 w-11/12"/>
          <Skeleton className="h-4 w-4/5"/>
        </Card>
      </div>);
    }
    const data = article.data;
    if (!data) {
        return (<Card>
        <EmptyState icon={<BookOpen className="h-5 w-5" aria-hidden="true"/>} title="No such article" message="It may have been retracted, or the link may be wrong." action={<Link to="/knowledge" className="btn btn-secondary btn-sm">
              Back to the knowledge base
            </Link>}/>
      </Card>);
    }
    const published = data.status === ArticleStatus.PUBLISHED;
    const apply = async () => {
        const wantPublished = confirming === 'publish';
        try {
            await publish.mutateAsync({ publish: wantPublished, version: data.version });
            setConfirming(null);
            toast.success(wantPublished ? 'Published. Everyone can read it now.' : 'Retracted to a draft.');
        }
        catch (error) {
            if (error instanceof ApiClientError && error.isVersionConflict) {
                setConfirming(null);
                void article.refetch();
                toast.warning('The draft changed while you were reading it. Reloaded — please review again.');
                return;
            }
            toast.error(error instanceof ApiClientError ? error.message : 'That could not be saved.');
        }
    };
    return (<div className="space-y-4">
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true"/>
        Back
      </button>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-ink">{data.title}</h1>
            <ArticleStatusBadge status={data.status}/>
          </div>
          <p className="mt-1 text-xs text-ink-subtle">{data.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (<Link to={`/knowledge/${data.id}/edit`} className="btn btn-secondary btn-sm">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true"/>
              Edit
            </Link>)}
          {/* Only rendered for a real holder of `ARTICLE_PUBLISH`. A technician who edits
          * this article never sees a publish control, because there is no request they
          * could send that the server would honour. */}
          {canPublish &&
            (published ? (<Button size="sm" variant="secondary" onClick={() => setConfirming('retract')}>
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true"/>
                Retract
              </Button>) : (<Button size="sm" onClick={() => setConfirming('publish')}>
                <Send className="h-3.5 w-3.5" aria-hidden="true"/>
                Publish
              </Button>))}
        </div>
      </div>

      {!published && (<div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg">
          This is a draft. Employees cannot see it{canPublish ? ' until you publish it.' : ' until an administrator publishes it.'}
        </div>)}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <Card className="p-6">
          {/* `Markdown` carries its own typography; there is no prose plugin and nothing
          * here needs one. */}
          <Markdown source={data.body}/>
        </Card>

        <Card className="h-fit divide-y divide-line text-xs">
          <div className="space-y-2 p-4">
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Details</p>
            <dl className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-subtle">Category</dt>
                <dd className="text-ink">{data.category?.label ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-subtle">Reads</dt>
                <dd className="inline-flex items-center gap-1 text-ink">
                  <Eye className="h-3 w-3" aria-hidden="true"/>
                  {formatNumber(data.viewCount)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-subtle">Updated</dt>
                <dd className="text-ink">
                  <time dateTime={data.updatedAt}>{relativeTime(data.updatedAt, now)}</time>
                </dd>
              </div>
              {data.publishedAt && (<div className="flex items-center justify-between gap-2">
                  <dt className="text-ink-subtle">Published</dt>
                  <dd className="text-ink">
                    <time dateTime={data.publishedAt}>{relativeTime(data.publishedAt, now)}</time>
                  </dd>
                </div>)}
            </dl>
          </div>

          {data.author && (<div className="flex items-center gap-2 p-4">
              <Avatar name={data.author.name} size="sm"/>
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{data.author.name}</p>
                <p className="text-2xs text-ink-subtle">Author</p>
              </div>
            </div>)}

          {data.tags.length > 0 && (<div className="space-y-2 p-4">
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map((tag) => (<Link key={tag} to={`/knowledge?tag=${encodeURIComponent(tag)}`} className="chip">
                    {tag}
                  </Link>))}
              </div>
            </div>)}
        </Card>
      </div>

      {/* Publishing is the one action here that changes who can read the article, so it
          * asks. Retracting asks too — it takes a page away from everyone who had it
          * bookmarked, which is just as worth a second of thought. */}
      <Modal open={confirming !== null} onClose={() => setConfirming(null)} title={confirming === 'retract' ? 'Retract this article?' : 'Publish this article?'} description={confirming === 'retract'
            ? 'It goes back to being a draft. Employees will no longer see it, and the text is kept.'
            : 'Every employee will be able to read it. You can retract it again afterwards.'} footer={<>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant={confirming === 'retract' ? 'danger' : 'primary'} loading={publish.isPending} onClick={() => void apply()}>
              {confirming === 'retract' ? 'Retract' : 'Publish'}
            </Button>
          </>}>
        <p className="text-sm text-ink-muted">{data.title}</p>
      </Modal>
    </div>);
}
