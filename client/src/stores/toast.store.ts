import { create } from 'zustand';
import type { Tone } from '@shared/labels';

/**
 * Transient messages.
 *
 * Deliberately not a component-level concern: a mutation that succeeds usually
 * navigates away, and a toast owned by the page being unmounted would disappear with
 * it before anyone read it.
 */

export interface Toast {
  id: number;
  tone: Extract<Tone, 'success' | 'danger' | 'info' | 'warning'>;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: Toast['tone'], message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
const LIFETIME_MS = 4500;

export const useToastStore = create<ToastState>((set, get) => ({
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
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('danger', message),
  info: (message: string) => useToastStore.getState().push('info', message),
  warning: (message: string) => useToastStore.getState().push('warning', message),
};
