/**
 * ServiceDesk Pro — the frame around sign-in and register.
 *
 * Shared so the two pages cannot drift apart, and separate from `AppShell` because
 * these pages have no navigation, no socket and no signed-in user to render.
 */

import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useUiStore } from '@/stores/ui.store';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);

  return (
    <div className="flex min-h-screen flex-col bg-brand-mesh px-4 py-10">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient text-sm font-bold text-white">
              SD
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink">
              ServiceDesk <span className="text-brand-600">Pro</span>
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-icon-sm" onClick={toggleTheme}>
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">Switch to {theme === 'dark' ? 'light' : 'dark'} theme</span>
          </button>
        </div>

        <div className="card-raised p-6">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center">{footer}</div>}
      </div>
    </div>
  );
}
