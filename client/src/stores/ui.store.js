import { create } from 'zustand';
const THEME_KEY = 'sdp.theme';
const SIDEBAR_KEY = 'sdp.sidebar';
function readTheme() {
    try {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === 'light' || stored === 'dark')
            return stored;
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    catch {
        return 'light';
    }
}
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
        localStorage.setItem(THEME_KEY, theme);
    }
    catch {
        /* Private mode: the theme applies for this session and is simply not remembered. */
    }
}
export const useUiStore = create((set, get) => ({
    theme: readTheme(),
    sidebarCollapsed: (() => {
        try {
            return localStorage.getItem(SIDEBAR_KEY) === '1';
        }
        catch {
            return false;
        }
    })(),
    mobileNavOpen: false,
    commandOpen: false,
    shortcutHelpOpen: false,
    toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        set({ theme: next });
    },
    toggleSidebar: () => {
        const next = !get().sidebarCollapsed;
        try {
            localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
        }
        catch {
            /* Not worth failing a click over. */
        }
        set({ sidebarCollapsed: next });
    },
    setMobileNav: (open) => set({ mobileNavOpen: open }),
    setCommandOpen: (open) => set({ commandOpen: open }),
    setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
}));
