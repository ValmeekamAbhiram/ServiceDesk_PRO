import { cn } from '@/lib/cn';

/** A placeholder shape while data loads — never a fake value that could be read. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-surface-sunken', className ?? 'h-4 w-full')}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-black/5 to-transparent dark:via-white/5" />
    </div>
  );
}

/** Rows of skeleton for a table body, so a loading list keeps its layout. */
export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b border-line last:border-0">
          {Array.from({ length: cols }).map((__, colIndex) => (
            <td key={colIndex} className="px-4 py-3">
              <Skeleton className={colIndex === 0 ? 'h-4 w-24' : 'h-4 w-full max-w-[10rem]'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
