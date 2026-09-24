import { cn } from '@/lib/cn';
/**
 * Label, hint and error for one control.
 *
 * The error is rendered in `role="alert"` and the control is wired to it by
 * `aria-describedby` at the call site, so a screen reader announces *why* a field was
 * rejected rather than only that something failed.
 */
export function Field({ label, htmlFor, error, hint, required, children, className, }) {
    return (<div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-medium text-ink-muted">
        {label}
        {required && (<span className="text-danger-fg" aria-hidden="true">
            *
          </span>)}
      </label>
      {children}
      {error ? (<p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger-fg">
          {error}
        </p>) : (hint && <p className="text-xs text-ink-subtle">{hint}</p>)}
    </div>);
}
