import { cn } from '@/lib/cn';
import { TONE_SOFT } from '@/lib/tone';
/** A label with a semantic tone. Never a raw enum value — see `@shared/labels`. */
export function Badge({ tone = 'neutral', children, className, dot = false, }) {
    return (<span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE_SOFT[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true"/>}
      {children}
    </span>);
}
