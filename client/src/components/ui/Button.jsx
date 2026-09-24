import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';
const VARIANTS = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-xs',
    secondary: 'bg-surface text-ink ring-1 ring-line hover:bg-surface-sunken',
    ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
    danger: 'bg-danger-solid text-white hover:brightness-95 active:brightness-90 shadow-xs',
    subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300',
};
const SIZES = {
    sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
    md: 'h-[2.375rem] px-4 text-sm gap-2 rounded-lg',
    lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
};
/**
 * `loading` also disables, because a form that fires twice creates two tickets.
 * `type` defaults to `button`: a button inside a form that meant to submit says so.
 */
export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', loading = false, fullWidth, className, children, disabled, type = 'button', ...rest }, ref) {
    return (<button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cn('inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas', 'disabled:cursor-not-allowed disabled:opacity-55', VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)} {...rest}>
      {loading && <Spinner className="h-3.5 w-3.5"/>}
      {children}
    </button>);
});
