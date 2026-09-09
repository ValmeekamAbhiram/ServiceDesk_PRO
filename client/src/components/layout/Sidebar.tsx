/**
 * ServiceDesk Pro — primary navigation.
 *
 * Items are filtered by permission so nobody is shown a link that only answers
 * 403. Queue shortcuts (My Queue, Incidents) are deep links into the ticket
 * list's own query language — `scope=mine`, `priority=URGENT` — rather than
 * separate routes, so there is exactly one ticket list to maintain.
 *
 * One component serves both layouts: a fixed rail on large screens (with a
 * persisted collapse toggle), the same list in a slide-over below `lg`.
 */

import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  Boxes,
  Flame,
  Inbox,
  LayoutDashboard,
  Settings,
  Ticket,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Permission } from '@shared/enums';
import { useSettings } from '@/api/admin';
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

const WORKSPACE: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/tickets?scope=mine', label: 'My Queue', icon: Inbox },
  { to: '/tickets?priority=URGENT', label: 'Incidents', icon: Flame, badge: '3' },
  { to: '/assets', label: 'Assets', icon: Boxes, permission: Permission.ASSET_READ },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpen, permission: Permission.ARTICLE_READ },
  { to: '/#ticket-activity', label: 'Analytics', icon: BarChart3 },
];

const TEAM: NavEntry[] = [
  { to: '/#technician-capacity', label: 'Technicians', icon: Wrench },
  { to: '/admin/users', label: 'Users', icon: Users, permission: Permission.USER_MANAGE },
  { to: '/admin/settings', label: 'Settings', icon: Settings, permission: Permission.SETTINGS_MANAGE },
];

function Brand({ compact }: { compact: boolean }) {
  const settings = useSettings();
  const organization = settings.data?.organizationName;

  return (
    <div className="flex h-topbar items-center gap-2.5 px-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-bold tracking-tight text-white shadow-xs">
        SD
      </span>
      {!compact && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold tracking-tight text-ink">
            ServiceDesk <span className="text-brand-600">Pro</span>
          </span>
          {organization && (
            <span className="block truncate text-2xs text-ink-subtle" title={organization}>
              {organization}
            </span>
          )}
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
        cn('nav-item', isActive && 'nav-item-active', compact && 'justify-center px-0')
      }
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {!compact && <span className="truncate">{entry.label}</span>}
      {!compact && entry.badge && (
        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-danger-bg px-1.5 py-0.5 text-2xs font-semibold tabular text-danger-fg ring-1 ring-inset ring-danger-border">
          {entry.badge}
        </span>
      )}
    </NavLink>
  );
}

function SectionLabel({ compact, children }: { compact: boolean; children: string }) {
  if (compact) return <div className="divider mx-3 my-2" aria-hidden="true" />;
  return (
    <p className="mb-1 mt-5 px-3 text-2xs font-semibold uppercase tracking-wider text-ink-subtle first:mt-1">
      {children}
    </p>
  );
}

function Nav({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const can = useAuthStore((state) => state.can);
  const visible = (entries: NavEntry[]) =>
    entries.filter((entry) => !entry.permission || can(entry.permission));

  const workspace = visible(WORKSPACE);
  const team = visible(TEAM);

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4" aria-label="Primary">
      <SectionLabel compact={compact}>Workspace</SectionLabel>
      {workspace.map((entry) => (
        <Item key={entry.label} entry={entry} compact={compact} onNavigate={onNavigate} />
      ))}

      {team.length > 0 && (
        <>
          <SectionLabel compact={compact}>Team</SectionLabel>
          {team.map((entry) => (
            <Item key={entry.label} entry={entry} compact={compact} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </nav>
  );
}

function SupportFooter({ compact }: { compact: boolean }) {
  const settings = useSettings();
  const email = settings.data?.supportEmail;
  if (compact || !email) return null;

  return (
    <div className="border-t border-line px-4 py-3">
      <p className="text-2xs text-ink-subtle">Still stuck?</p>
      <a
        href={`mailto:${email}`}
        className="block truncate text-xs font-medium text-brand-700 hover:underline"
        title={email}
      >
        {email}
      </a>
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
        <SupportFooter compact={collapsed} />
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
            <SupportFooter compact={false} />
          </aside>
        </div>
      )}
    </>
  );
}
