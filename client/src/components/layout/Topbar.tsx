/**
 * ServiceDesk Pro — the top bar.
 *
 * Donezo-reference rhythm: a centered search field with the ⌘K chip inside,
 * mail + bell outline-circle icons, and the signed-in tech's avatar, name,
 * and email on the right. Search opens the command palette rather than
 * showing results here — one results view, one set of filters.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Mail, Menu, Moon, PanelLeft, Search, Sun, User } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { NotificationBell } from './NotificationBell';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

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
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 hover:bg-surface-sunken sm:pr-2"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={user.name} size="sm" />
        <span className="hidden min-w-0 text-left md:block">
          <span className="block max-w-36 truncate text-xs font-semibold text-ink">{user.name}</span>
          <span className="block max-w-36 truncate text-2xs text-ink-subtle">{user.email}</span>
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-ink-subtle sm:block" aria-hidden="true" />
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

function CircleIconButton({
  label,
  to,
  children,
}: {
  label: string;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-muted',
        'transition-colors hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </Link>
  );
}

export function Topbar() {
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setMobileNav = useUiStore((state) => state.setMobileNav);
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-4 lg:px-6">
      <button
        type="button"
        className="btn btn-ghost btn-icon shrink-0 lg:hidden"
        onClick={() => setMobileNav(true)}
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Open navigation</span>
      </button>

      <button
        type="button"
        className="btn btn-ghost btn-icon hidden shrink-0 lg:inline-flex"
        onClick={toggleSidebar}
      >
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Collapse navigation</span>
      </button>

      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          className="flex h-10 w-full min-w-0 max-w-xl items-center gap-2 rounded-full border border-line bg-surface-sunken/60 px-4 text-left text-sm text-ink-subtle transition-colors hover:border-line-strong hover:bg-surface-sunken"
          onClick={() => setCommandOpen(true)}
          aria-label="Search the service desk"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Search tickets, assets, knowledge…</span>
          <span className="ml-auto hidden shrink-0 items-center gap-1 sm:flex" aria-hidden="true">
            <kbd className="kbd rounded-md">⌘</kbd>
            <kbd className="kbd rounded-md">K</kbd>
          </span>
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
        <CircleIconButton label="Inbox — all notifications" to="/notifications">
          <Mail className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </CircleIconButton>

        <NotificationBell circle />

        <button
          type="button"
          className="hidden h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-ink sm:grid"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className="sr-only">Switch to {theme === 'dark' ? 'light' : 'dark'} theme</span>
        </button>

        <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
        <AccountMenu />
      </div>
    </header>
  );
}
