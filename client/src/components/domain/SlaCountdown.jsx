import { useRef } from 'react';
import { SlaState } from '@shared/enums';
import { slaStateMeta } from '@shared/labels';
import { clamp, formatCountdown } from '@shared/utils';
import { cn } from '@/lib/cn';
import { TONE_SOLID } from '@/lib/tone';
import { useNow } from '@/hooks/useNow';
/**
 * The anchoring itself, shared by the two renderings below.
 *
 * Returns the countdown as it stands *now*, having subtracted the time that has passed
 * locally since the server's `remainingMs` arrived. Everything about whose clock is
 * being trusted is decided here and nowhere else.
 */
function useSlaTick(target) {
    const now = useNow();
    const anchor = useRef({ remaining: target.remainingMs, at: now });
    if (anchor.current.remaining !== target.remainingMs) {
        anchor.current = { remaining: target.remainingMs, at: now };
    }
    const settled = target.state === SlaState.MET;
    /* A met target is history: it stops ticking and shows the outcome instead. */
    const remainingMs = settled || target.remainingMs === null
        ? target.remainingMs
        : target.remainingMs - (now - anchor.current.at);
    return {
        remainingMs,
        settled,
        overdue: remainingMs !== null && remainingMs < 0 && !settled,
        meta: slaStateMeta(target.state),
    };
}
/**
 * A live countdown that stays honest about whose clock it is.
 *
 * It ticks from `remainingMs` and the moment that number arrived — never from `dueAt`
 * minus the browser's clock. Two reasons: the browser's clock can be wrong, and in demo
 * mode the SLA engine runs on the Time Machine's clock, so a countdown derived locally
 * from an absolute deadline would ignore every jump the demo makes. Anchoring on the
 * server's own "time left" is correct under both.
 *
 * The anchor resets whenever `remainingMs` changes, which is what makes a refetch — or
 * a socket-driven invalidation — snap the countdown back to the server's answer instead
 * of letting the local tick drift away from it.
 */
export function SlaCountdown({ target, label, className, }) {
    const { remainingMs, settled, overdue, meta } = useSlaTick(target);
    const percent = clamp(target.percentUsed, 0, 100);
    return (<div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <span className={cn('text-xs font-semibold', overdue ? 'text-danger-fg' : 'text-ink')}>
          {target.dueAt === null
            ? 'No target'
            : settled
                ? meta.label
                : remainingMs === null
                    ? '—'
                    : overdue
                        ? `${formatCountdown(Math.round(-remainingMs / 1000))} over`
                        : formatCountdown(Math.round(remainingMs / 1000))}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="presentation">
        <div className={cn('h-full rounded-full transition-[width] duration-500', TONE_SOLID[meta.tone])} style={{ width: `${percent}%` }}/>
      </div>
      {/* The percentage is on the bar for sighted users and spoken here for everyone else. */}
      <p className="sr-only">
        {label}: {meta.label}, {percent}% of the time budget used.
      </p>
    </div>);
}
/**
 * The one-line form, for table cells.
 *
 * Same anchoring, no progress bar: a row has room for a state and a number, and forty
 * progress bars stacked down a page communicate less than forty numbers do.
 */
export function SlaChip({ target, className }) {
    const { remainingMs, settled, overdue, meta } = useSlaTick(target);
    if (target.dueAt === null) {
        return <span className={cn('text-xs text-ink-subtle', className)}>No target</span>;
    }
    return (<span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs', className)}>
      <span className={cn('dot', TONE_SOLID[meta.tone])} aria-hidden="true"/>
      <span className={cn('font-medium tabular', overdue ? 'text-danger-fg' : 'text-ink-muted')}>
        {settled
            ? meta.label
            : remainingMs === null
                ? '—'
                : overdue
                    ? `${formatCountdown(Math.round(-remainingMs / 1000))} over`
                    : formatCountdown(Math.round(remainingMs / 1000))}
      </span>
    </span>);
}
