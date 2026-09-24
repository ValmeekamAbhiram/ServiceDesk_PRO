import { Modal } from '@/components/ui/Modal';
import { useUiStore } from '@/stores/ui.store';
const SHORTCUTS = [
    { keys: ['Ctrl', 'K'], macKeys: ['⌘', 'K'], label: 'Open command search' },
    { keys: ['N'], label: 'Create a ticket' },
    { keys: ['K'], label: 'Open knowledge base' },
    { keys: ['?'], label: 'Show keyboard shortcuts' },
    { keys: ['Esc'], label: 'Close an overlay' },
];
export function ShortcutOverlay() {
    const open = useUiStore((state) => state.shortcutHelpOpen);
    const setOpen = useUiStore((state) => state.setShortcutHelpOpen);
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    return (<Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" description="Navigate common service-desk tasks without leaving the keyboard." size="sm">
      <dl className="divide-y divide-line">
        {SHORTCUTS.map((shortcut) => {
            const keys = isMac && shortcut.macKeys ? shortcut.macKeys : shortcut.keys;
            return (<div key={shortcut.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <dt className="text-sm text-ink-muted">{shortcut.label}</dt>
              <dd className="flex items-center gap-1">
                {keys.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}
              </dd>
            </div>);
        })}
      </dl>
      <p className="mt-4 text-2xs leading-4 text-ink-subtle">
        Single-letter shortcuts are disabled while you type in a form.
      </p>
    </Modal>);
}
