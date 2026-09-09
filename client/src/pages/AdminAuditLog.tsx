/**
 * ServiceDesk Pro — the audit trail.
 *
 * Read-only, and read-only in a way the page itself demonstrates: there is no edit
 * control, no delete, and no bulk anything. The collection is append-only at the schema
 * level — `updateOne`, `findOneAndUpdate` and the delete hooks all throw — so a screen
 * that offered to change a row would be offering something the database refuses.
 *
 * Two columns carry the weight:
 *
 *  - **Summary** is written at the moment of the change, in the past tense, by the
 *    service that made it. "Changed Priya's role from EMPLOYEE to TECHNICIAN" is the
 *    row's real content; everything else on the line is there to filter by.
 *  - **Changes** is the field-level diff, and it is deliberately terse. Long text is
 *    already previewed to eighty characters on the way in, and secrets never reach the
 *    collection at all — `diff()` refuses `passwordHash` and its kin at the source, so
 *    there is nothing here to redact on the way out.
 *
 * `actorName` is displayed rather than `actor.name`: the name is captured at write time,
 * so an entry still names the person who made the change after they are renamed or
 * deactivated. Rows written by the SLA monitor have no actor at all and say so.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ScrollText, X } from 'lucide-react';
import { AuditAction, AuditEntity } from '@shared/enums';
import { AUDIT_ACTION_META, AUDIT_ENTITY_META } from '@shared/labels';
import { relativeTime } from '@shared/utils';
import type { AuditLogDto } from '@shared/types';
import { useAuditLog, type AuditQuery } from '@/api/admin';
import { useNow } from '@/hooks/useNow';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonRows } from '@/components/ui/Skeleton';

const PAGE_SIZE = 25;

const FILTER_KEYS = ['action', 'entityType', 'from', 'to'] as const;

/** Absolute stamp for the tooltip; the cell itself shows "4 minutes ago". */
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function AdminAuditLog() {
  const [params, setParams] = useSearchParams();
  const now = useNow();

  const query = useMemo<AuditQuery>(
    () => ({
      page: Number(params.get('page') ?? 1),
      limit: PAGE_SIZE,
      action: params.get('action') ?? undefined,
      entityType: params.get('entityType') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    }),
    [params]
  );

  const entries = useAuditLog(query);

  /* Changing a filter while parked on page seven is how people end up staring at an
   * empty table, so anything but paging goes back to the first page. */
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const filtered = FILTER_KEYS.some((key) => params.has(key));
  const rows = entries.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Audit trail</h1>
        <p className="text-xs text-ink-subtle">
          Every change of consequence, in the order it happened. Entries cannot be edited or
          deleted by anyone, including an administrator — the collection only accepts appends.
        </p>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-2xs font-medium text-ink-muted">
            Action
            <Select
              className="mt-1 w-auto"
              value={params.get('action') ?? ''}
              onChange={(event) => setParam('action', event.target.value)}
            >
              <option value="">Any action</option>
              {Object.values(AuditAction).map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_META[action].label}
                </option>
              ))}
            </Select>
          </label>

          <label className="text-2xs font-medium text-ink-muted">
            Subject
            <Select
              className="mt-1 w-auto"
              value={params.get('entityType') ?? ''}
              onChange={(event) => setParam('entityType', event.target.value)}
            >
              <option value="">Anything</option>
              {Object.values(AuditEntity).map((entity) => (
                <option key={entity} value={entity}>
                  {AUDIT_ENTITY_META[entity].label}
                </option>
              ))}
            </Select>
          </label>

          {/* Both bounds are whole days on the server — `to` covers the day it names,
            * so picking the same date twice returns that day rather than nothing. */}
          <label className="text-2xs font-medium text-ink-muted">
            From
            <Input
              type="date"
              className="mt-1 w-auto"
              value={params.get('from') ?? ''}
              onChange={(event) => setParam('from', event.target.value)}
            />
          </label>
          <label className="text-2xs font-medium text-ink-muted">
            To
            <Input
              type="date"
              className="mt-1 w-auto"
              value={params.get('to') ?? ''}
              onChange={(event) => setParam('to', event.target.value)}
            />
          </label>

          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
              <X className="h-4 w-4" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </Card>

      <Card>
        {entries.isLoading ? (
          <div className="p-4">
            <table className="table">
              <tbody>
                <SkeletonRows rows={8} cols={4} />
              </tbody>
            </table>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-5 w-5" aria-hidden="true" />}
            title={filtered ? 'Nothing matches those filters' : 'Nothing recorded yet'}
            message={
              filtered
                ? 'Widen the dates, or clear the filters to see the whole trail.'
                : 'Entries appear here as soon as anyone signs in or changes something.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {entries.data && rows.length > 0 && (
          <Pagination
            meta={entries.data.meta}
            unit="record"
            onPageChange={(page) => setParam('page', String(page))}
          />
        )}
      </Card>
    </div>
  );
}

/**
 * One entry, with its diff folded away.
 *
 * The diff is collapsed by default because most rows do not need it — the summary
 * already says what happened — and an always-open diff turns a page of twenty-five
 * entries into a wall. It expands in place rather than opening a modal, so several can
 * be compared at once.
 */
function AuditRow({ entry, now }: { entry: AuditLogDto; now: number }) {
  const [open, setOpen] = useState(false);
  const action = AUDIT_ACTION_META[entry.action] ?? { label: entry.action, tone: 'neutral' as const };
  const changes = Object.entries(entry.changes ?? {});

  return (
    <tr className="align-top">
      <td className="whitespace-nowrap">
        <time dateTime={entry.createdAt} title={stamp(entry.createdAt)} className="text-2xs text-ink-muted">
          {relativeTime(entry.createdAt, now)}
        </time>
      </td>
      <td className="whitespace-nowrap">
        <p className="font-medium text-ink">{entry.actorName}</p>
        {/* An automated row has no signed-in actor — the SLA monitor and the seeder write
          * under their own name, and saying so is more honest than showing a blank. */}
        {entry.automated && (
          <span className="text-2xs text-ink-subtle">Automatic</span>
        )}
      </td>
      <td className="whitespace-nowrap">
        <Badge tone={action.tone}>{action.label}</Badge>
      </td>
      <td>
        <p className="text-ink">{entry.summary}</p>
        <p className="mt-0.5 text-2xs text-ink-subtle">
          {AUDIT_ENTITY_META[entry.entityType]?.label ?? entry.entityType}
          {entry.entityLabel ? ` · ${entry.entityLabel}` : ''}
        </p>

        {changes.length > 0 && (
          <>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-brand-700 hover:underline"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              )}
              {changes.length} {changes.length === 1 ? 'field' : 'fields'} changed
            </button>
            {open && (
              <dl className="mt-1.5 space-y-1 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                {changes.map(([field, change]) => (
                  <div key={field} className="flex flex-wrap items-baseline gap-x-2 text-2xs">
                    <dt className="font-medium text-ink-muted">{fieldLabel(field)}</dt>
                    <dd className="flex flex-wrap items-baseline gap-1.5 text-ink">
                      <span className="text-ink-subtle line-through">{display(change.from)}</span>
                      <span aria-hidden="true">→</span>
                      <span>{display(change.to)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

/** `targets.URGENT` keeps its path — the dotted key is what was actually written. */
function fieldLabel(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

/**
 * A stored value as one line of text.
 *
 * `unknown` because the diff is schemaless by design — it holds whatever the field held.
 * `null` and `''` are shown as "empty" rather than as nothing at all, so a row that
 * cleared a field reads as a change rather than as a rendering bug.
 */
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
