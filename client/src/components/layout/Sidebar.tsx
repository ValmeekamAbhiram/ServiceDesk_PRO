/**
 * ServiceDesk Pro — primary navigation.
 *
 * Items are filtered by permission so nobody is shown a link that only answers 403.
 * An employee therefore sees Tickets, Knowledge and their assets; a technician also
 * sees the full queue; an administrator also sees the admin group. That filtering is
 * presentation — the endpoints decide.
 *
 * One component serves both layouts: a fixed rail on large screens, the same list in a
 * slide-over below `lg`. Two components would mean two places to add a nav item to,
 * and the one that gets forgotten is always the mobile one.
 */

import { NavLink } from 'react-router-dom';
import {
  BookOpen,
  Boxes,
  FolderTree,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
  Ticket,
  Timer,
  Users,
  X,
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
}

const MAIN: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/assets', label: 'Assets', icon: Boxes, permission: Permission.ASSET_READ },
  { to: '/knowledge', label: 'Knowledge base', icon: BookOpen, permission: Permission.ARTICLE_READ },
];

const ADMIN: NavEntry[] = [
  { to: '/admin/users', label: 'People', icon: Users, permission: Permission.USER_MANAGE },
  {
    to: '/admin/categories',
    label: 'Categories',
    icon: FolderTree,
    permission: Permission.SETTINGS_MANAGE,
  },
  {
    to: '/admin/sla',
    label: 'Service levels',
    icon: Timer,
    permission: Permission.SETTINGS_MANAGE,
  },
  { to: '/admin/audit', label: 'Audit trail', icon: ScrollText, permission: Permission.AUDIT_READ },
  {
    to: '/admin/settings',
    label: 'Settings',
    icon: SlidersHorizontal,
    permission: Permission.SETTINGS_MANAGE,
  },
];

/**
 * The product name is fixed; the second line is whoever runs this desk, from the
 * settings document. `GET /settings` is open to any signed-in user precisely so that
 * this renders for an employee too, and it is cached for ten minutes, so the extra
 * request happens roughly once per session rather than once per navigation.
 *
 * Nothing stands in for the name while it loads or if the request fails. A skeleton
 * bar in the chrome would flicker on every cold start to save a line of text that is
 * decoration, and the desk is perfectly usable without knowing whose it is.
 */
function Brand({ compact }: { compact: boolean }) {
  const settings = useSettings();
  const organization = settings.data?.organizationName;

  return (
    <div className="flex h-topbar items-center gap-2.5 px-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-brand-400/25 bg-brand-600 text-xs font-bold tracking-tight text-white shadow-xs">
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
    </NavLink>
  );
}

function Nav({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const can = useAuthStore((state) => state.can);
  const visible = (entries: NavEntry[]) =>
    entries.filter((entry) => !entry.permission || can(entry.permission));

  const admin = visible(ADMIN);

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
      {visible(MAIN).map((entry) => (
        <Item key={entry.to} entry={entry} compact={compact} onNavigate={onNavigate} />
      ))}

      {admin.length > 0 && (
        <>
          <div className="mt-5 mb-1 px-3">
            {compact ? (
              <div className="divider" />
            ) : (
              <span className="text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                Administration
              </span>
            )}
          </div>
          {admin.map((entry) => (
            <Item key={entry.to} entry={entry} compact={compact} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </nav>
  );
}

/**
 * The desk's own address, which is the one thing the navigation cannot route to. An
 * employee who cannot find the right category still has somewhere to go, and it comes
 * from the same settings document as the name above, so an administrator changing it
 * changes it here.
 *
 * A `mailto:` and not a form: this application does not send mail, so pretending to
 * would be a button that reports success and delivers nothing.
 */
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
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface-sunken lg:flex',
          'transition-[width] duration-200',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
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
