import { cn } from '@/lib/cn';
/**
 * A labelled on/off switch.
 *
 * Built on a real checkbox rather than a styled `<button role="switch">` so it is
 * keyboard- and screen-reader-correct for free, and so a form library can register it
 * like any other field. The checkbox itself is `sr-only`; the track and knob are the
 * `<span>`s beside it, driven by `peer-checked`.
 *
 * `note` is for the reason a switch is inert — "this deployment was built without it" —
 * which is why it renders even when `disabled` hides everything else worth reading.
 */
export function Toggle({ label, description, note, checked, onChange, disabled, id, }) {
    return (<div className={cn('flex items-start gap-3', disabled && 'opacity-70')}>
      <label htmlFor={id} className="relative mt-0.5 inline-flex shrink-0 cursor-pointer">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/>
        <span className="block h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas peer-disabled:cursor-not-allowed"/>
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4"/>
      </label>
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description && <p className="text-2xs text-ink-subtle">{description}</p>}
        {note && <p className="mt-0.5 text-2xs font-medium text-warning-fg">{note}</p>}
      </div>
    </div>);
}
