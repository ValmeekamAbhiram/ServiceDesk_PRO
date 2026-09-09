/**
 * ServiceDesk Pro — the top bar.
 *
 * It carries the four things that are wanted from every page: a way back to the
 * navigation on small screens, a global ticket search, the notification bell, and the
 * account menu. Search submits to the ticket list rather than showing results here —
 * one results view, one set of filters, one place where a query means something.
 *
 * The realtime dot is honest about the connection: it says `Live` only while the socket
 * is actually connected, because a UI that claims to be live while polling nothing is
 * the kind of small lie that costs an afternoon of debugging later.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, Moon, PanelLeft, Plus, Search, Sun, User } from 'lucide-react';
import type { RealtimeStatus } from '@/lib/realtime';
import { Avatar } from '@/components/ui/Avatar';
import { NotificationBell } from './NotificationBell';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  online: 'Live',
  connecting: 'Connecting',
  offline: 'Offline',
};

const STATUS_DOT: Record<RealtimeStatus, string> = {
  online: 'bg-success-solid',
  connecting: 'bg-warning-solid animate-pulse',
  offline: 'bg-line-strong',
};

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-sunken"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={user.name} size="sm" />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block truncate text-xs font-semibold text-ink">{user.name}</span>
          <span className="block text-2xs text-ink-subtle">{user.role.toLowerCase()}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
      </button>

      {open && (
        <div className="popover absolute right-0 mt-2 w-52" role="menu">
          <div className="px-2.5 py-2">
            <p className="truncate text-xs font-semibold text-ink">{user.name}</p>
            <p className="truncate text-2xs text-ink-subtle">{user.email}</p>
          </div>
          <div className="divider" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
          >
            <User className="h-4 w-4" aria-hidden="true" />
            Your profile
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item-danger"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar({ realtime }: { realtime: RealtimeStatus }) {
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setMobileNav = useUiStore((state) => state.setMobileNav);
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);

  return (
    <header className="sticky top-0 z-20 flex h-topbar items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-4 lg:px-6">
      <button
        type="button"
        className="btn btn-ghost btn-icon lg:hidden"
        onClick={() => setMobileNav(true)}
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Open navigation</span>
      </button>

      <button type="button" className="btn btn-ghost btn-icon hidden lg:inline-flex" onClick={toggleSidebar}>
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Collapse navigation</span>
      </button>

      <button
        type="button"
        className="group relative flex h-9 min-w-0 max-w-xl flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface-sunken px-3 text-left text-sm text-ink-subtle transition-colors hover:border-brand-400/60 hover:bg-surface"
        onClick={() => setCommandOpen(true)}
        aria-label="Search the service desk"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search tickets, assets, knowledge…</span>
        <span className="ml-auto hidden items-center gap-1 sm:flex" aria-hidden="true">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>

      <span className="ml-auto hidden items-center gap-1.5 text-2xs text-ink-subtle md:inline-flex">
        <span className={cn('dot', STATUS_DOT[realtime])} aria-hidden="true" />
        {STATUS_LABEL[realtime]}
      </span>

      <Link to="/tickets/new" className="btn btn-primary btn-sm ml-1">
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">New ticket</span>
      </Link>

      <button type="button" className="btn btn-ghost btn-icon" onClick={toggleTheme}>
        {theme === 'dark' ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="sr-only">
          Switch to {theme === 'dark' ? 'light' : 'dark'} theme
        </span>
      </button>

      <NotificationBell />
      <AccountMenu />
    </header>
  );
}
