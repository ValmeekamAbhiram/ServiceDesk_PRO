/**
 * ServiceDesk Pro — raise a ticket.
 *
 * The interesting part of this page is what the AI panel is *not* allowed to do. It
 * suggests a category and a priority, and it lists knowledge-base articles that may
 * already answer the question. It never writes to the ticket. Clicking "Use these"
 * copies the values into the form the same way typing them would, and the person can
 * change them back before submitting — so the human is always the one who chose.
 *
 * The panel also shows `source` ("heuristic" or "llm") and a confidence percentage,
 * because a guess presented without its provenance reads as a fact.
 *
 * Suggestions are requested on demand, never on a keystroke: one button, one request.
 * If the feature is switched off in settings the server answers 503 and the panel says
 * so rather than showing an error.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Priority } from '@shared/enums';
import { PRIORITY_META } from '@shared/labels';
import type { TicketSuggestionDto } from '@shared/types';
import { useCreateTicket } from '@/api/tickets';
import { useCategories } from '@/api/reference';
import { useAssets } from '@/api/assets';
import { useTicketSuggestion } from '@/api/suggestions';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { applyServerErrors } from '@/lib/form';
import { toast } from '@/stores/toast.store';
import { AttachmentPicker } from '@/components/domain/AttachmentPicker';
import { MAX_FILES } from '@/lib/uploads';

/* Mirrors `createTicketSchema` on the server, message for message, so the two never
 * disagree about what "too short" means. The server still validates — this only saves a
 * round trip. */
const schema = z.object({
  title: z
    .string()
    .trim()
    .min(5, 'Give the ticket a title of at least 5 characters.')
    .max(200, 'Keep the title under 200 characters.'),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the problem in at least 10 characters.')
    .max(10_000, 'That description is too long.'),
  categoryId: z.string().min(1, 'Pick the category that fits best.'),
  priority: z.nativeEnum(Priority).optional(),
  assetId: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;
const FIELDS = ['title', 'description', 'categoryId', 'priority', 'assetId'] as const;

/* ─────────────────────────────── suggestions ─────────────────────────────── */

function SuggestionPanel({
  title,
  description,
  onApply,
}: {
  title: string;
  description: string;
  onApply: (suggestion: TicketSuggestionDto) => void;
}) {
  const suggest = useTicketSuggestion();
  const [result, setResult] = useState<TicketSuggestionDto | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* The same threshold the title field uses: below it there is nothing to classify. */
  const ready = title.trim().length >= 5;

  const ask = () => {
    setNote(null);
    suggest.mutate(
      { title: title.trim(), description: description.trim() || undefined },
      {
        onSuccess: (data) => setResult(data),
        onError: (error) => {
          setResult(null);
          setNote(
            error instanceof Error && 'status' in error && (error as { status?: number }).status === 503
              ? 'Suggestions are switched off for this site.'
              : 'Could not reach the suggestion service. Fill the form in yourself.'
          );
        },
      }
    );
  };

  /* Tinted, so the panel never looks like part of the form it is advising on. */
  return (
    <Card className="border-violet-border bg-violet-bg">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-fg" aria-hidden="true" />
            Suggested classification
          </span>
        }
        subtitle="A guess from the words you typed. It fills the form in; it never files the ticket."
      />
      <CardBody className="space-y-3">
        <Button variant="secondary" size="sm" onClick={ask} disabled={!ready} loading={suggest.isPending}>
          {result ? 'Suggest again' : 'Suggest a category'}
        </Button>
        {!ready && <p className="text-xs text-ink-subtle">Type a title first.</p>}
        {note && <p className="text-xs text-warning-fg">{note}</p>}
        {result && <SuggestionBody suggestion={result} onApply={() => onApply(result)} />}
      </CardBody>
    </Card>
  );
}

function SuggestionBody({
  suggestion,
  onApply,
}: {
  suggestion: TicketSuggestionDto;
  onApply: () => void;
}) {
  const priority = PRIORITY_META[suggestion.priority];
  /* Rounded to whole percent: two decimal places on a keyword score would imply a
   * precision the classifier does not have. */
  const confidence = Math.round(suggestion.confidence * 100);

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-ink-subtle">Category</dt>
          <dd className="font-medium text-ink">{suggestion.categoryName ?? 'No clear match'}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Priority</dt>
          <dd className="font-medium text-ink">{priority.label}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-muted">{suggestion.reason}</p>
      <p className="text-xs text-ink-subtle">
        {confidence}% confidence &middot; {suggestion.source === 'llm' ? 'language model' : 'keyword match'}
      </p>
      {suggestion.categoryId && (
        <Button variant="secondary" size="sm" onClick={onApply}>
          Use these values
        </Button>
      )}
      {suggestion.relatedArticles.length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-3">
          <p className="text-xs font-medium text-ink-muted">This may already be answered</p>
          <ul className="space-y-1.5">
            {suggestion.relatedArticles.map((article) => (
              <li key={article.id}>
                {/* Opens in a new tab on purpose: reading an article should not throw
                    away a half-written ticket. */}
                <Link
                  to={`/knowledge/${article.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link text-xs font-medium"
                >
                  {article.title}
                </Link>
                <p className="text-xs text-ink-subtle">{article.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────── page ─────────────────────────────────── */

export default function TicketNew() {
  const navigate = useNavigate();
  /* Set by "Raise a ticket about this" on an asset page. Read once, into the form's
   * initial value, so the person can still change it — the link is a shortcut, not a
   * lock. An id that is not theirs is rejected by the server the same as a typed one. */
  const [params] = useSearchParams();
  const create = useCreateTicket();
  const categories = useCategories();
  /* Only enough assets to fill a picker. The server scopes the list, so an employee is
   * offered their own kit and a technician the whole estate — one rule, enforced once. */
  const assets = useAssets({ page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const [files, setFiles] = useState<File[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      categoryId: '',
      priority: undefined,
      assetId: params.get('assetId') ?? '',
    },
  });

  const title = form.watch('title');
  const description = form.watch('description');

  const activeCategories = useMemo(
    () => (categories.data ?? []).filter((category) => category.active),
    [categories.data]
  );

  const applySuggestion = (suggestion: TicketSuggestionDto) => {
    /* `shouldValidate` so the "pick a category" error clears the moment it is answered,
     * and `shouldDirty` so the values look typed — which, as far as the ticket is
     * concerned, is exactly what they are. */
    if (suggestion.categoryId) {
      form.setValue('categoryId', suggestion.categoryId, { shouldValidate: true, shouldDirty: true });
    }
    form.setValue('priority', suggestion.priority, { shouldValidate: true, shouldDirty: true });
    toast.info('Suggestion copied in. Change anything that looks wrong.');
  };

  const submit = form.handleSubmit(async (values) => {
    setBanner(null);
    try {
      const ticket = await create.mutateAsync({
        input: {
          title: values.title,
          description: values.description,
          categoryId: values.categoryId,
          priority: values.priority,
          /* An empty select means "no asset", which the server spells as null. */
          assetId: values.assetId ? values.assetId : null,
        },
        files,
      });
      toast.success(`Ticket ${ticket.number} raised.`);
      navigate(`/tickets/${ticket.id}`, { replace: true });
    } catch (error) {
      setBanner(applyServerErrors(error, form, FIELDS));
    }
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/tickets" className="btn btn-ghost btn-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Tickets
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-ink">Raise a ticket</h1>
          <p className="text-xs text-ink-subtle">
            A clear title and what you already tried get this answered fastest.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardBody>
            <form className="space-y-4" onSubmit={submit} noValidate>
              {banner && (
                <p role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
                  {banner}
                </p>
              )}

              <Field label="Title" htmlFor="title" required error={form.formState.errors.title?.message}>
                <Input
                  id="title"
                  autoFocus
                  placeholder="Laptop will not connect to the office Wi-Fi"
                  invalid={Boolean(form.formState.errors.title)}
                  aria-describedby={form.formState.errors.title ? 'title-error' : undefined}
                  {...form.register('title')}
                />
              </Field>

              <Field
                label="What is happening?"
                htmlFor="description"
                required
                hint="When it started, what you were doing, any error message."
                error={form.formState.errors.description?.message}
              >
                <Textarea
                  id="description"
                  rows={7}
                  invalid={Boolean(form.formState.errors.description)}
                  aria-describedby={form.formState.errors.description ? 'description-error' : undefined}
                  {...form.register('description')}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Category"
                  htmlFor="categoryId"
                  required
                  error={form.formState.errors.categoryId?.message}
                >
                  <Select
                    id="categoryId"
                    invalid={Boolean(form.formState.errors.categoryId)}
                    aria-describedby={form.formState.errors.categoryId ? 'categoryId-error' : undefined}
                    {...form.register('categoryId')}
                  >
                    <option value="">Choose one…</option>
                    {activeCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Priority"
                  htmlFor="priority"
                  hint="Leave blank to use the category default."
                  error={form.formState.errors.priority?.message}
                >
                  <Select id="priority" {...form.register('priority')}>
                    <option value="">Category default</option>
                    {Object.values(Priority).map((value) => (
                      <option key={value} value={value}>
                        {PRIORITY_META[value].label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Affected device"
                htmlFor="assetId"
                hint="Optional. Linking one shows its history to whoever picks this up."
                error={form.formState.errors.assetId?.message}
              >
                <Select id="assetId" {...form.register('assetId')}>
                  <option value="">Not about a specific device</option>
                  {(assets.data?.items ?? []).map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.tag} — {asset.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Attachments"
                htmlFor="files"
                hint={`Up to ${MAX_FILES} files. Screenshots help more than descriptions of screenshots.`}
              >
                <AttachmentPicker files={files} onChange={setFiles} />
              </Field>

              <div className="flex items-center gap-2 border-t border-line pt-4">
                <Button type="submit" loading={create.isPending}>
                  Raise ticket
                </Button>
                <Link to="/tickets" className="btn btn-ghost">
                  Cancel
                </Link>
                {categories.isLoading && <Spinner className="h-4 w-4" />}
              </div>
            </form>
          </CardBody>
        </Card>

        <SuggestionPanel title={title} description={description} onApply={applySuggestion} />
      </div>
    </div>
  );
}
