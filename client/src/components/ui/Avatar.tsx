import { avatarColorFor, initialsOf } from '@shared/utils';
import { cn } from '@/lib/cn';

/**
 * Initials on a colour derived from the name, so the same person is the same colour
 * everywhere without storing anything. There are no uploaded avatars in this build,
 * and a grey circle for everyone makes a comment thread hard to scan.
 */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string | null | undefined;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const label = name?.trim() || 'Unknown';
  const dimensions = {
    xs: 'h-5 w-5 text-[0.5rem]',
    sm: 'h-7 w-7 text-2xs',
    md: 'h-9 w-9 text-xs',
    lg: 'h-12 w-12 text-sm',
  }[size];

  return (
    <span
      title={label}
      style={{ backgroundColor: avatarColorFor(label) }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase tracking-wide text-white',
        dimensions,
        className
      )}
    >
      {initialsOf(label)}
    </span>
  );
}
