import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore } from '@/stores/toast.store';
import { cn } from '@/lib/cn';
import { TONE_SOFT } from '@/lib/tone';
const ICONS = {
    success: CheckCircle2,
    danger: XCircle,
    warning: AlertTriangle,
    info: Info,
};
/**
 * Mounted once, at the app root.
 *
 * `aria-live="polite"` rather than `assertive`: these confirm actions the user just
 * took, so interrupting whatever a screen reader is mid-sentence on would be rude.
 * A failure the user must act on is rendered in the page, not only here.
 */
export function Toaster() {
    const toasts = useToastStore((state) => state.toasts);
    const dismiss = useToastStore((state) => state.dismiss);
    return (<div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
      {toasts.map((toast) => {
            const Icon = ICONS[toast.tone];
            return (<div key={toast.id} className={cn('pointer-events-auto flex w-full max-w-sm animate-fade-in-up items-start gap-2.5 rounded-lg px-3.5 py-3 shadow-pop ring-1 ring-inset', TONE_SOFT[toast.tone])}>
            <Icon className="mt-px h-4 w-4 shrink-0" aria-hidden="true"/>
            <p className="min-w-0 flex-1 text-xs leading-relaxed">{toast.message}</p>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="-m-1 rounded p-1 opacity-60 transition hover:opacity-100">
              <X className="h-3.5 w-3.5"/>
            </button>
          </div>);
        })}
    </div>);
}
