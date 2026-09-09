import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const BASE =
  'w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle transition ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/45 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-70';

/** `invalid` paints the border red *and* sets `aria-invalid`, so the two cannot drift. */
const border = (invalid?: boolean) =>
  invalid ? 'border-danger-border focus:ring-danger-solid/35' : 'border-line hover:border-line-strong';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(BASE, border(invalid), 'h-[2.375rem]', className)}
        {...rest}
      />
    );
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(BASE, border(invalid), 'resize-y py-2 leading-relaxed', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(BASE, border(invalid), 'h-[2.375rem] cursor-pointer pr-8', className)}
      {...rest}
    >
      {children}
    </select>
  );
});
