import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '@shared/types';
import { formatNumber, pluralize } from '@shared/utils';
import { Button } from './Button';

/**
 * Previous/next over a `PageMeta`, plus the count.
 *
 * Numbered pages are deliberately absent: with a filterable queue the useful moves are
 * "next" and "change the filter", and a row of page numbers on a list that reorders as
 * tickets are updated points at rows that have already moved.
 */
export function Pagination({
  meta,
  onPageChange,
  unit = 'result',
}: {
  meta: PageMeta;
  onPageChange: (page: number) => void;
  unit?: string;
}) {
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="text-xs text-ink-subtle">
        {meta.total === 0
          ? `No ${pluralize(0, unit)}`
          : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(meta.total)} ${pluralize(meta.total, unit)}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Button>
        <span className="text-xs text-ink-subtle">
          Page {meta.page} of {Math.max(meta.totalPages, 1)}
        </span>
        <Button size="sm" variant="secondary" disabled={!meta.hasNext} onClick={() => onPageChange(meta.page + 1)}>
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
