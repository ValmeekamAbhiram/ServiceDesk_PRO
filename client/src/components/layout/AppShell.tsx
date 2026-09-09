/**
 * ServiceDesk Pro — the application frame.
 *
 * The socket is opened here and nowhere else. This component is mounted exactly once
 * for the whole signed-in session, which is what makes `useRealtime` a single
 * connection rather than one per page.
 *
 * `Suspense` wraps the `Outlet` only, so a lazy page loads without the sidebar
 * blinking out and back.
 */

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CmdPalette } from '@/components/palette/CmdPalette';
import { ShortcutOverlay } from '@/components/shortcuts/ShortcutOverlay';
import { Spinner } from '@/components/ui/Spinner';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useRealtime } from '@/hooks/useRealtime';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/cn';

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-5 w-5 text-brand-600" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function AppShell() {
  const authenticated = useAuthStore((state) => state.status === 'authenticated');
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  // Opened here and nowhere else: this component mounts exactly once per
  // signed-in session, which keeps `useRealtime` a single connection.
  useRealtime(authenticated);
  useKeyboardShortcuts();

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar />
      <CmdPalette />
      <ShortcutOverlay />

      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200',
          collapsed ? 'lg:pl-sidebar-collapsed' : 'lg:pl-sidebar'
        )}
      >
        <Topbar />
        <main className="mx-auto w-full max-w-[100rem] flex-1 px-3 py-5 sm:px-5 sm:py-6 lg:px-7">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
