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

import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { useDashboard } from '@/api/dashboard';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

interface NavEntry {
  /** Stable key used by the explicit active matcher below — never the label. */
  id: 'dashboard' | 'tickets' | 'queue' | 'incidents' | 'assets' | 'knowledge' | 'analytics' | 'settings';
  to: string;
  label: string;
  icon: LucideIcon;
  /** Absent means everybody signed in may see it. */
  permission?: Permission;
  badge?: string;
  /** Hash anchors (Analytics) render as plain anchors and never take the pill. */
  hash?: boolean;
}

const MENU: NavEntry[] = [
  { id: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'tickets', to: '/tickets', label: 'Tickets', icon: Ticket },
  { id: 'queue', to: '/tickets?scope=mine', label: 'My Queue', icon: Inbox },
  { id: 'incidents', to: '/tickets?priority=URGENT', label: 'Incidents', icon: Flame },
  { id: 'assets', to: '/assets', label: 'Assets', icon: Boxes, permission: Permission.ASSET_READ },
  { id: 'knowledge', to: '/knowledge', label: 'Knowledge', icon: BookOpen, permission: Permission.ARTICLE_READ },
  { id: 'analytics', to: '/#ticket-analytics', label: 'Analytics', icon: BarChart3, hash: true },
];

const GENERAL: NavEntry[] = [
  { id: 'settings', to: '/admin/settings', label: 'Settings', icon: Settings, permission: Permission.SETTINGS_MANAGE },
];

/**
 * Exactly one pill lit at a time.
 *
 * `NavLink`'s prefix matching cannot express this menu: `/tickets` is a
 * prefix of the queue/incident deep links, `/#ticket-analytics` is a prefix
 * of every route, and Help used to share Knowledge's target — so two or three
 * pills lit up together. Each entry therefore declares its own match.
 */
function entryActive(id: NavEntry['id'], pathname: string, search: string): boolean {
  const params = new URLSearchParams(search);
  switch (id) {
    case 'dashboard':
      return pathname === '/dashboard';
    case 'tickets':
      return pathname === '/tickets' && !params.has('scope') && !params.has('priority');
    case 'queue':
      return pathname === '/tickets' && params.get('scope') === 'mine';
    case 'incidents':
      return pathname === '/tickets' && params.has('priority');
    case 'assets':
      return pathname === '/assets' || pathname.startsWith('/assets/');
    case 'knowledge':
      return pathname === '/knowledge' || pathname.startsWith('/knowledge/');
    case 'settings':
      return pathname === '/admin/settings' || pathname.startsWith('/admin/');
    case 'analytics':
      return false;
  }
}

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

function Item({ entry, active, compact, onNavigate }: { entry: NavEntry; active: boolean; compact: boolean; onNavigate?: () => void }) {
  const Icon = entry.icon;
  const classes = cn(
    'group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
    active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
    compact && 'justify-center px-0',
  );
  const body = (
    <>
      {active && !compact && (
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
  );
  /* Hash anchors are plain jumps — they never take the active pill. */
  if (entry.hash) {
    return (
      <a href={entry.to} onClick={onNavigate} title={compact ? entry.label : undefined} className={classes}>
        {body}
      </a>
    );
  }
  return (
    <Link
      to={entry.to}
      onClick={onNavigate}
      title={compact ? entry.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={classes}
    >
      {body}
    </Link>
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

/**
 * Help opens the keyboard-shortcut overlay instead of sharing Knowledge's
 * route — the old duplicate target lit two pills at once.
 */
function HelpButton({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const setShortcutHelpOpen = useUiStore((state) => state.setShortcutHelpOpen);
  return (
    <button
      type="button"
      title={compact ? 'Help' : undefined}
      onClick={() => {
        onNavigate?.();
        setShortcutHelpOpen(true);
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink',
        compact && 'justify-center px-0',
      )}
    >
      <LifeBuoy className="h-[1.05rem] w-[1.05rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {!compact && <span className="truncate">Help</span>}
    </button>
  );
}

function Nav({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const can = useAuthStore((state) => state.can);
  const { pathname, search } = useLocation();
  /* Same query key as the dashboard page — shared cache, no extra request.
   * The Tickets badge is the live open-ticket KPI; unknown stays unbadged
   * rather than showing a stale invented number. */
  const dashboard = useDashboard();
  const openCount = dashboard.data?.kpis.find((kpi) => /open/i.test(kpi.label))?.value;
  const withLiveBadge = (entries: NavEntry[]): NavEntry[] =>
    entries.map((entry) =>
      entry.id === 'tickets' && typeof openCount === 'number'
        ? { ...entry, badge: String(openCount) }
        : entry,
    );
  const visible = (entries: NavEntry[]) =>
    entries.filter((entry) => !entry.permission || can(entry.permission));

  const menu = withLiveBadge(visible(MENU));
  const general = visible(GENERAL);

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4" aria-label="Primary">
      <SectionLabel compact={compact}>Menu</SectionLabel>
      {menu.map((entry) => (
        <Item
          key={entry.id}
          entry={entry}
          active={entryActive(entry.id, pathname, search)}
          compact={compact}
          onNavigate={onNavigate}
        />
      ))}

      <SectionLabel compact={compact}>General</SectionLabel>
      {general.map((entry) => (
        <Item
          key={entry.id}
          entry={entry}
          active={entryActive(entry.id, pathname, search)}
          compact={compact}
          onNavigate={onNavigate}
        />
      ))}
      <HelpButton compact={compact} onNavigate={onNavigate} />
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
        <Link
          to="/"
          className="relative mt-3 block rounded-full bg-white/95 px-3 py-1.5 text-center text-xs font-semibold text-brand-800 transition-colors hover:bg-white"
        >
          Open overview
        </Link>
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
