import { create } from 'zustand';
let seq = 0;
const LIFETIME_MS = 4500;
export const useToastStore = create((set, get) => ({
    toasts: [],
    push: (tone, message) => {
        const id = ++seq;
        set({ toasts: [...get().toasts, { id, tone, message }] });
        window.setTimeout(() => get().dismiss(id), LIFETIME_MS);
    },
    dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));
/** Shorthand for use outside components — mutation handlers, mostly. */
export const toast = {
    success: (message) => useToastStore.getState().push('success', message),
    error: (message) => useToastStore.getState().push('danger', message),
    info: (message) => useToastStore.getState().push('info', message),
    warning: (message) => useToastStore.getState().push('warning', message),
};
