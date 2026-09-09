import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The honest empty result. It says what is missing and, when there is one, offers the
 * action that would fill it — never a disabled control implying something is coming.
 */
export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {message && <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-subtle">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
