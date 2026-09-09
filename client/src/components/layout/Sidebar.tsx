/**
 * ServiceDesk Pro — primary navigation.
 *
 * Donezo-reference rhythm, ServiceDesk content: white rail, logo top, small
 * gray MENU label, pale-green active pill with a green left edge bar, a dark
 * count badge on Tickets, a GENERAL section, and a dark-green promo card at
 * the bottom.
 *
 * Items are filtered by permission so nobody is shown a link that only answers
 * 403. One component serves both layouts: a fixed rail on large screens (with
 * a persisted collapse toggle), the same list in a slide-over below `lg`.
 */

import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  Boxes,
  Flame,
  Headphones,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
  Ticket,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Permission } from '@shared/enums';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Absent means everybody signed in may see it. */
  permission?: Permission;
  end?: boolean;
  badge?: string;
}

const MENU: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tickets', label: 'Tickets', icon: Ticket, badge: '128' },
  { to: '/tickets?scope=mine', label: 'My Queue', icon: Inbox },
  { to: '/tickets?priority=URGENT', label: 'Incidents', icon: Flame },
  { to: '/assets', label: 'Assets', icon: Boxes, permission: Permission.ASSET_READ },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpen, permission: Permission.ARTICLE_READ },
  { to: '/#ticket-analytics', label: 'Analytics', icon: BarChart3 },
];

const GENERAL: NavEntry[] = [
  { to: '/admin/settings', label: 'Settings', icon: Settings, permission: Permission.SETTINGS_MANAGE },
  { to: '/knowledge', label: 'Help', icon: LifeBuoy, permission: Permission.ARTICLE_READ },
];

function Brand({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-16 items-center gap-2.5 px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-xs">
        <Headphones className="h-[1.1rem] w-[1.1rem]" strokeWidth={2} aria-hidden="true" />
      </span>
      {!compact && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.95rem] font-bold tracking-tight text-ink">
            ServiceDesk <span className="font-semibold text-brand-600">Pro</span>
          </span>
        </span>
      )}
    </div>
  );
}

function Item({ entry, compact, onNavigate }: { entry: NavEntry; compact: boolean; onNavigate?: () => void }) {
  const Icon = entry.icon;
  return (
    <NavLink
      to={entry.to}
      end={entry.end}
      onClick={onNavigate}
      title={compact ? entry.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
          compact && 'justify-center px-0',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !compact && (
            <span
              className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand-600"
              aria-hidden="true"
            />
          )}
          <Icon className="h-[1.05rem] w-[1.05rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {!compact && <span className="truncate">{entry.label}</span>}
          {!compact && entry.badge && (
            <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-brand-900 px-1.5 py-0.5 text-2xs font-bold tabular text-white">
              {entry.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function SectionLabel({ compact, children }: { compact: boolean; children: string }) {
  if (compact) return <div className="mx-3 my-2 h-px w-auto bg-line" aria-hidden="true" />;
  return (
    <p className="mb-1.5 mt-5 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-subtle first:mt-1">
      {children}
    </p>
  );
}

function LogoutItem({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  return (
    <button
      type="button"
      title={compact ? 'Logout' : undefined}
      onClick={() => {
        onNavigate?.();
        void logout()
          .catch(() => undefined)
          .finally(() => navigate('/login'));
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink',
        compact && 'justify-center px-0',
      )}
    >
      <LogOut className="h-[1.05rem] w-[1.05rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {!compact && <span className="truncate">Logout</span>}
    </button>
  );
}

function Nav({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const can = useAuthStore((state) => state.can);
  const visible = (entries: NavEntry[]) =>
    entries.filter((entry) => !entry.permission || can(entry.permission));

  const menu = visible(MENU);
  const general = visible(GENERAL);

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4" aria-label="Primary">
      <SectionLabel compact={compact}>Menu</SectionLabel>
      {menu.map((entry) => (
        <Item key={entry.label} entry={entry} compact={compact} onNavigate={onNavigate} />
      ))}

      <SectionLabel compact={compact}>General</SectionLabel>
      {general.map((entry) => (
        <Item key={entry.label} entry={entry} compact={compact} onNavigate={onNavigate} />
      ))}
      <LogoutItem compact={compact} onNavigate={onNavigate} />
    </nav>
  );
}

function PromoCard({ compact }: { compact: boolean }) {
  if (compact) return null;

  return (
    <div className="px-3 pb-4">
      <div className="relative overflow-hidden rounded-2xl bg-brand-800 p-4 text-white shadow-card">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(120% 90% at 85% 110%, rgb(255 255 255 / 0.14) 0%, transparent 55%), radial-gradient(100% 80% at 10% -10%, rgb(255 255 255 / 0.10) 0%, transparent 50%)',
          }}
        />
        <p className="relative text-sm font-semibold leading-snug">
          ServiceDesk
          <br />
          on the go
        </p>
        <p className="relative mt-1 text-2xs leading-relaxed text-white/70">
          Triage tickets from anywhere.
        </p>
        <NavLink
          to="/welcome"
          className="relative mt-3 block rounded-full bg-white/95 px-3 py-1.5 text-center text-xs font-semibold text-brand-800 transition-colors hover:bg-white"
        >
          Open overview
        </NavLink>
      </div>
    </div>
  );
}

export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const mobileOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNav = useUiStore((state) => state.setMobileNav);
  const close = () => setMobileNav(false);

  return (
    <>
      {/* The fixed rail. Hidden below lg, where the slide-over takes over. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface lg:flex',
          'transition-[width] duration-200',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
        )}
      >
        <Brand compact={collapsed} />
        <Nav compact={collapsed} />
        <PromoCard compact={collapsed} />
      </aside>

      {/* The slide-over. Rendered only while open so it is not in the tab order. */}
      {mobileOpen && (
        <div className="lg:hidden">
          <div
            className="overlay-backdrop"
            onClick={close}
            role="presentation"
            aria-hidden="true"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-sidebar flex-col border-r border-line bg-surface"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-center justify-between pr-2">
              <Brand compact={false} />
              <button type="button" className="btn btn-ghost btn-icon-sm" onClick={close}>
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Close navigation</span>
              </button>
            </div>
            <Nav compact={false} onNavigate={close} />
            <PromoCard compact={false} />
          </aside>
        </div>
      )}
    </>
  );
}
