import { create } from 'zustand';

/**
 * Theme and chrome state.
 *
 * The `sdp.theme` key and the `data-theme` attribute are a contract with the inline
 * script in `index.html`, which resolves the theme before first paint so the app
 * never flashes the wrong palette. Changing the key here without changing it there
 * would produce a flash on every load, so both spellings are deliberate.
 */

export type Theme = 'light' | 'dark';

const THEME_KEY = 'sdp.theme';
const SIDEBAR_KEY = 'sdp.sidebar';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* Private mode: the theme applies for this session and is simply not remembered. */
  }
}

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandOpen: boolean;
  shortcutHelpOpen: boolean;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setShortcutHelpOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: readTheme(),
  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  })(),
  mobileNavOpen: false,
  commandOpen: false,
  shortcutHelpOpen: false,

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* Not worth failing a click over. */
    }
    set({ sidebarCollapsed: next });
  },

  setMobileNav: (open) => set({ mobileNavOpen: open }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
}));
