/**
 * ServiceDesk Pro — categories.
 *
 * Small page, three jobs: name the queues tickets are filed into, set the priority a
 * ticket starts on, and tune the keyword list the offline classifier matches a title
 * against. The last one is why this page exists rather than a seed script: the
 * suggestion panel is only as good as these words, and they are the sort of thing that
 * gets better after a month of real tickets.
 *
 * There is no delete. A category is embedded in every ticket ever filed under it, so it
 * is deactivated instead — it disappears from the pickers and its history stays readable.
 * `ticketCount` is shown next to the toggle so nobody deactivates something with two
 * hundred open tickets behind it by accident.
 *
 * `color` is validated as `#rrggbb` on both ends because it is interpolated into a style
 * attribute. The native colour input cannot produce anything else, but the hand-written
 * request that skips this form can, which is why the server checks it too.
 */

import { useState } from 'react';
import { FolderTree, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Priority } from '@shared/enums';
import { PRIORITY_META } from '@shared/labels';
import { formatNumber } from '@shared/utils';
import type { CategoryDto } from '@shared/types';
import { useCategories, useCreateCategory, useUpdateCategory } from '@/api/reference';
import { ApiClientError } from '@/lib/api';
import { applyServerErrors } from '@/lib/form';
import { toast } from '@/stores/toast.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PriorityBadge } from '@/components/domain/MetaBadge';
import { Badge } from '@/components/ui/Badge';

const MAX_KEYWORDS = 40;

/** Mirrors `categoryBody`; the server re-checks every rule. */
const schema = z.object({
  name: z.string().trim().min(2, 'Give the category a name.').max(120, 'Keep the name under 120 characters.'),
  description: z.string().trim().max(500, 'Keep the description under 500 characters.').optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #2563eb'),
  defaultPriority: z.nativeEnum(Priority),
  keywords: z.string().max(1200, 'That is more keywords than the classifier will use.').optional(),
  sortOrder: z.coerce.number().int().min(0, 'Zero or more.').max(9999, 'Keep it under 9999.'),
});

type Values = z.infer<typeof schema>;

const FIELDS = ['name', 'description', 'color', 'defaultPriority', 'keywords', 'sortOrder'] as const;

const BLANK: Values = {
  name: '',
  description: '',
  color: '#2563eb',
  defaultPriority: Priority.MEDIUM,
  keywords: '',
  sortOrder: 100,
};

/** Same normalisation the server applies, so the box shows what will be stored. */
function parseKeywords(input: string | undefined): string[] {
  const parts = (input ?? '')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 2);
  return [...new Set(parts)].slice(0, MAX_KEYWORDS);
}

export default function AdminCategories() {
  /* The admin table is the only caller that asks for retired categories. */
  const categories = useCategories(true);
  const [editing, setEditing] = useState<CategoryDto | 'new' | null>(null);
  const rows = categories.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-ink">Categories</h1>
          <p className="text-xs text-ink-subtle">
            The queues tickets are filed into, the priority each one starts on, and the words the
            suggestion panel matches a title against.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New category
        </Button>
      </div>

      <Card>
        {categories.isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={5} cols={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FolderTree className="h-5 w-5" aria-hidden="true" />}
            title="No categories yet"
            message="A ticket has to be filed under something, so add at least one."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                Add the first one
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Starts at</th>
                  <th scope="col">Classifier keywords</th>
                  <th scope="col" className="text-right">Tickets</th>
                  <th scope="col" className="text-right">Order</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((category) => (
                  <CategoryRow key={category.id} category={category} onEdit={() => setEditing(category)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <CategoryModal
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * A row is its own component so it can own the mutation for its own id. The alternative
 * — one mutation hook keyed by whichever row was clicked last — makes the spinner appear
 * on the wrong button the moment two clicks overlap.
 */
function CategoryRow({ category, onEdit }: { category: CategoryDto; onEdit: () => void }) {
  const update = useUpdateCategory(category.id);

  const toggle = async () => {
    try {
      await update.mutateAsync({ active: !category.active });
      toast.success(
        category.active
          ? `${category.name} is retired. Existing tickets keep it.`
          : `${category.name} is back in the pickers.`
      );
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'That could not be saved.');
    }
  };

  return (
    <tr className={category.active ? undefined : 'opacity-60'}>
      <td>
        <div className="flex items-start gap-2">
          {/* The only place a stored colour is interpolated into a style attribute, which
            * is why `#rrggbb` is enforced at both ends. */}
          <span
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: category.color }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium text-ink">
              {category.name}
              {!category.active && <Badge tone="neutral">Retired</Badge>}
            </p>
            {category.description && (
              <p className="max-w-md text-2xs leading-relaxed text-ink-subtle">{category.description}</p>
            )}
          </div>
        </div>
      </td>
      <td><PriorityBadge priority={category.defaultPriority} /></td>
      <td>
        {category.keywords.length === 0 ? (
          <span className="text-2xs text-ink-subtle">None — matches the name only</span>
        ) : (
          <div className="flex max-w-sm flex-wrap gap-1">
            {category.keywords.slice(0, 6).map((word) => (
              <span key={word} className="chip">{word}</span>
            ))}
            {category.keywords.length > 6 && (
              <span className="chip">+{category.keywords.length - 6}</span>
            )}
          </div>
        )}
      </td>
      <td className="text-right tabular-nums">{formatNumber(category.ticketCount)}</td>
      <td className="text-right tabular-nums text-ink-subtle">{category.sortOrder}</td>
      <td>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" loading={update.isPending} onClick={() => void toggle()}>
            {category.active ? 'Retire' : 'Restore'}
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Mounted only while open, so `defaultValues` is read once with the right record and
 * there is no reset-on-prop-change dance.
 *
 * Both mutations are declared. `useUpdateCategory('')` is never called when creating —
 * the branch in `submit` decides — and a hook cannot be conditional.
 */
function CategoryModal({ category, onClose }: { category: CategoryDto | null; onClose: () => void }) {
  const create = useCreateCategory();
  const update = useUpdateCategory(category?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: category
      ? {
          name: category.name,
          description: category.description ?? '',
          color: category.color,
          defaultPriority: category.defaultPriority,
          keywords: category.keywords.join(', '),
          sortOrder: category.sortOrder,
        }
      : BLANK,
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const payload = {
      name: values.name.trim(),
      /* An empty box means "no description", which is `null` rather than `''` — the
       * model stores one absent value, not two. */
      description: values.description?.trim() ? values.description.trim() : null,
      color: values.color,
      defaultPriority: values.defaultPriority,
      keywords: parseKeywords(values.keywords),
      sortOrder: values.sortOrder,
    };
    try {
      if (category) await update.mutateAsync(payload);
      else await create.mutateAsync(payload);
      toast.success(category ? 'Saved.' : `${payload.name} added.`);
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, form, FIELDS));
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={category ? `Edit ${category.name}` : 'New category'}
      description="Renaming a category updates it everywhere it is shown, including on tickets already filed under it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="category-form"
            loading={create.isPending || update.isPending}
          >
            {category ? 'Save changes' : 'Add category'}
          </Button>
        </>
      }
    >
      {/* The submit button lives in the modal footer, outside this element, so it reaches
        * the form by `form="category-form"` rather than by being inside it. */}
      <form id="category-form" className="space-y-4" onSubmit={submit} noValidate>
        {formError && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
            {formError}
          </div>
        )}

        <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message} required>
          <Input id="name" {...form.register('name')} invalid={Boolean(form.formState.errors.name)} placeholder="Network & VPN" />
        </Field>

        <Field label="Description" htmlFor="description" error={form.formState.errors.description?.message} hint="Shown as a hint under the category picker.">
          <Textarea id="description" rows={2} {...form.register('description')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Two views of one field, so only ONE of them is registered. Registering the
            * same name twice leaves both inputs uncontrolled and out of step: picking a
            * colour would not update the hex, and typing a hex would not move the
            * swatch. The swatch owns the registration; the text box is driven by
            * `watch` and writes back through `setValue`. */}
          <Field label="Colour" htmlFor="color" error={form.formState.errors.color?.message}>
            <div className="flex items-center gap-2">
              <input
                id="color"
                type="color"
                className="h-9 w-12 shrink-0 cursor-pointer rounded border border-line bg-surface p-1"
                {...form.register('color')}
              />
              <Input
                aria-label="Hex colour"
                className="font-mono text-xs"
                value={form.watch('color')}
                invalid={Boolean(form.formState.errors.color)}
                onChange={(event) =>
                  form.setValue('color', event.target.value, { shouldValidate: true, shouldDirty: true })
                }
              />
            </div>
          </Field>
          <Field label="Starting priority" htmlFor="defaultPriority" error={form.formState.errors.defaultPriority?.message} hint="A requester can still change it.">
            <Select id="defaultPriority" {...form.register('defaultPriority')}>
              {Object.values(Priority).map((priority) => (
                <option key={priority} value={priority}>{PRIORITY_META[priority].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Sort order" htmlFor="sortOrder" error={form.formState.errors.sortOrder?.message} hint="Lower shows first.">
            <Input id="sortOrder" type="number" min={0} max={9999} {...form.register('sortOrder')} />
          </Field>
        </div>

        <Field
          label="Classifier keywords"
          htmlFor="keywords"
          error={form.formState.errors.keywords?.message}
          hint={`Comma separated, up to ${MAX_KEYWORDS}, lower-cased on save. These only feed the suggestion panel — they never file a ticket on their own.`}
        >
          <Textarea id="keywords" rows={3} className="text-xs" {...form.register('keywords')} placeholder="vpn, wifi, cannot connect, ethernet" />
        </Field>
      </form>
    </Modal>
  );
}
