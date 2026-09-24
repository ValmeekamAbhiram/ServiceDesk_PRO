/**
 * ServiceDesk Pro — write or edit a knowledge base article.
 *
 * One component for `/knowledge/new` and `/knowledge/:id/edit`, the same arrangement as
 * the asset form: the difference between the two is which mutation runs on submit.
 *
 * There is no status control on this form, and that absence is the feature. The server's
 * write shape has no `status` field, so an author holding `ARTICLE_WRITE` cannot publish
 * by naming it in a payload — publishing is a separate endpoint behind a separate
 * permission. A select box here would be a control that either does nothing or lies, so
 * the page says plainly what happens next instead.
 *
 * The preview is the same `Markdown` renderer the reader sees, which is worth having
 * because the supported subset is small: an author needs to find out that `~~strike~~`
 * is not supported while writing, not after publication.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Eye, Pencil } from 'lucide-react';
import { ArticleStatus } from '@shared/enums';
import { useArticle, useCreateArticle, useUpdateArticle } from '@/api/articles';
import { useCategories } from '@/api/reference';
import { ApiClientError } from '@/lib/api';
import { Markdown, SUPPORTED } from '@/lib/markdown';
import { applyServerErrors } from '@/lib/form';
import { toast } from '@/stores/toast.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { ArticleStatusBadge } from '@/components/domain/MetaBadge';
/** Mirrors `articleBody` in `article.schema.ts`; the server re-checks all of it. */
const schema = z.object({
    title: z.string().trim().min(4, 'Give the article a title of at least 4 characters.').max(200, 'Keep the title under 200 characters.'),
    summary: z
        .string()
        .trim()
        .min(10, 'Summarise the article in a sentence or two.')
        .max(500, 'Keep the summary under 500 characters.'),
    body: z.string().trim().min(20, 'The article needs a body of at least 20 characters.').max(50_000, 'That is longer than 50,000 characters.'),
    categoryId: z.string().optional(),
    /* Free text, split on submit. A tag input with chips would be nicer and is not worth
     * the code on a form somebody uses twice a month. */
    tags: z.string().max(300, 'Too many tags.').optional(),
});
const FIELDS = ['title', 'summary', 'body', 'categoryId', 'tags'];
const MAX_TAGS = 10;
/** Lower-cased and de-duplicated here too, so the box shows what the server will store. */
function parseTags(input) {
    const parts = (input ?? '')
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0);
    return [...new Set(parts)].slice(0, MAX_TAGS);
}
export default function ArticleEdit() {
    const { id } = useParams();
    const navigate = useNavigate();
    const editing = Boolean(id);
    const existing = useArticle(id);
    const categories = useCategories();
    const create = useCreateArticle();
    const update = useUpdateArticle(id ?? '');
    const [formError, setFormError] = useState(null);
    const [preview, setPreview] = useState(false);
    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues: { title: '', summary: '', body: '', categoryId: '', tags: '' },
    });
    /* The record arrives after the first render and `defaultValues` is only read once, so
     * the form is reset when it lands. `isDirty` guards against stamping over edits made
     * while the request was in flight. */
    useEffect(() => {
        const article = existing.data;
        if (!article || form.formState.isDirty)
            return;
        form.reset({
            title: article.title,
            summary: article.summary,
            body: article.body,
            categoryId: article.category?.id ?? '',
            tags: article.tags.join(', '),
        });
    }, [existing.data, form]);
    const submit = form.handleSubmit(async (values) => {
        setFormError(null);
        const payload = {
            title: values.title.trim(),
            summary: values.summary.trim(),
            body: values.body.trim(),
            categoryId: values.categoryId ? values.categoryId : null,
            tags: parseTags(values.tags),
        };
        try {
            const article = editing
                ? await update.mutateAsync({ ...payload, version: existing.data?.version ?? 0 })
                : await create.mutateAsync(payload);
            toast.success(editing ? 'Saved.' : 'Draft saved.');
            navigate(`/knowledge/${article.id}`, { replace: true });
        }
        catch (error) {
            /* A conflict deliberately does NOT reset the form. Discarding a page of prose
             * somebody just wrote is a worse outcome than a stale save, so their text stays,
             * the refetch picks up the current version, and the warning says exactly what a
             * second attempt will do. */
            if (error instanceof ApiClientError && error.isVersionConflict) {
                void existing.refetch();
                setFormError('Somebody else saved a change while you were editing. Your text is kept — saving again will replace their version.');
                return;
            }
            setFormError(applyServerErrors(error, form, FIELDS));
        }
    });
    if (editing && existing.isLoading) {
        return (<div className="space-y-4">
        <Skeleton className="h-6 w-1/3"/>
        <Card className="space-y-3 p-6">
          <Skeleton className="h-9 w-full"/>
          <Skeleton className="h-20 w-full"/>
          <Skeleton className="h-48 w-full"/>
        </Card>
      </div>);
    }
    const status = existing.data?.status ?? ArticleStatus.DRAFT;
    const body = form.watch('body');
    return (<form className="space-y-4" onSubmit={submit} noValidate>
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true"/>
        Back
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-ink">
            {editing ? 'Edit article' : 'Write an article'}
          </h1>
          <p className="text-xs text-ink-subtle">
            {status === ArticleStatus.PUBLISHED
            ? 'This article is live. Your changes are visible as soon as you save.'
            : 'Saving keeps it a draft. An administrator publishes it when it is ready.'}
          </p>
        </div>
        {editing && <ArticleStatusBadge status={status}/>}
      </div>

      {formError && (<div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {formError}
        </div>)}

      <Card className="space-y-4 p-5">
        <Field label="Title" htmlFor="title" error={form.formState.errors.title?.message} required>
          <Input id="title" {...form.register('title')} invalid={Boolean(form.formState.errors.title)} placeholder="Printer says “offline” after a restart"/>
        </Field>

        <Field label="Summary" htmlFor="summary" error={form.formState.errors.summary?.message} hint="Shown on the shelf and in search results. One or two sentences." required>
          <Textarea id="summary" rows={2} {...form.register('summary')} invalid={Boolean(form.formState.errors.summary)}/>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="categoryId" error={form.formState.errors.categoryId?.message}>
            <Select id="categoryId" {...form.register('categoryId')}>
              <option value="">No category</option>
              {(categories.data ?? []).map((category) => (<option key={category.id} value={category.id}>
                  {category.name}
                </option>))}
            </Select>
          </Field>
          <Field label="Tags" htmlFor="tags" error={form.formState.errors.tags?.message} hint={`Comma separated, up to ${MAX_TAGS}. Lower-cased on save.`}>
            <Input id="tags" {...form.register('tags')} placeholder="printer, windows, drivers"/>
          </Field>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Body</p>
          <div className="flex items-center gap-1">
            <button type="button" className={preview ? 'chip' : 'chip border-brand-300 bg-brand-50 text-brand-700'} aria-pressed={!preview} onClick={() => setPreview(false)}>
              <Pencil className="h-3 w-3" aria-hidden="true"/>
              Write
            </button>
            <button type="button" className={preview ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'} aria-pressed={preview} onClick={() => setPreview(true)}>
              <Eye className="h-3 w-3" aria-hidden="true"/>
              Preview
            </button>
          </div>
        </div>

        {/* The editor stays mounted while previewing. Unmounting a textarea loses the
          * cursor position and the undo stack, which turns a glance at the preview into
          * a small punishment. */}
        <div className={preview ? 'hidden' : undefined}>
          <Field label="Markdown" htmlFor="body" error={form.formState.errors.body?.message} hint={SUPPORTED} required>
            <Textarea id="body" rows={18} className="font-mono text-xs" {...form.register('body')} invalid={Boolean(form.formState.errors.body)} placeholder={'## What happened\n\nThe printer shows as offline after Windows updates.\n\n## Fix\n\n1. Open Settings\n2. …'}/>
          </Field>
        </div>

        {preview && (<div className="rounded-lg border border-line bg-surface-sunken p-4">
            {body.trim() === '' ? (<p className="text-xs text-ink-subtle">Nothing to preview yet.</p>) : (<Markdown source={body}/>)}
          </div>)}
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link to={editing ? `/knowledge/${id}` : '/knowledge'} className="btn btn-ghost btn-sm">
          Cancel
        </Link>
        <Button type="submit" loading={create.isPending || update.isPending}>
          {editing ? 'Save changes' : 'Save draft'}
        </Button>
      </div>
    </form>);
}
