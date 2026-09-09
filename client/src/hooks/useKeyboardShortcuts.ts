import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/stores/ui.store';

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/** Global navigation shortcuts. Single-letter commands never fire while someone is typing. */
export function useKeyboardShortcuts(): void {
  const navigate = useNavigate();
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const setShortcutHelpOpen = useUiStore((state) => state.setShortcutHelpOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key === '?' && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShortcutHelpOpen(true);
        return;
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      if (event.key.toLowerCase() === 'n') navigate('/tickets/new');
      if (event.key.toLowerCase() === 'k') navigate('/knowledge');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate, setCommandOpen, setShortcutHelpOpen]);
}
