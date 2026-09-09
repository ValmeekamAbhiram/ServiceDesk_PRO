/**
 * ServiceDesk Pro — the notification bell.
 *
 * The badge counts the whole unread inbox, not the page, which is why the list
 * endpoint returns `unreadCount` separately: a badge derived from `items.length`
 * would stop climbing at the page size and quietly under-report.
 *
 * Rows are links. Clicking one marks it read and navigates — in that order, and both
 * unconditionally, because a notification whose ticket was since deleted should still
 * stop being unread.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { relativeTime } from '@shared/utils';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '@/api/notifications';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useNow } from '@/hooks/useNow';

const QUERY = { page: 1, limit: 8, unreadOnly: false } as const;

export function NotificationBell({ circle = false }: { circle?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const now = useNow();

  const list = useNotifications(QUERY);
  const markRead = useMarkNotificationRead(QUERY);
  const markAll = useMarkAllNotificationsRead(QUERY);
  const navigate = useNavigate();

  /* Close on an outside click or Escape — the two ways people expect a popover to go. */
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

  const unread = list.data?.unreadCount ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        className={
          circle
            ? 'relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-ink'
            : 'btn btn-ghost btn-icon relative'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-[1.05rem] place-items-center rounded-full bg-danger-solid px-1 text-[0.625rem] font-bold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        <span className="sr-only">
          {unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        </span>
      </button>

      {open && (
        <div
          className="popover absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)]"
          role="menu"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-xs font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate()}
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          <div className="divider" />

          {list.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner className="h-4 w-4 text-brand-600" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-subtle">Nothing yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={cn('menu-item items-start', !item.read && 'bg-brand-50/60')}
                    onClick={() => {
                      if (!item.read) markRead.mutate(item.id);
                      setOpen(false);
                      if (item.link) navigate(item.link);
                    }}
                  >
                    <span
                      className={cn('dot mt-1.5', item.read ? 'bg-line-strong' : 'bg-brand-500')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-xs text-ink-muted">
                        {item.body}
                      </span>
                      <span className="mt-1 block text-2xs text-ink-subtle">
                        {relativeTime(item.createdAt, now)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="divider" />
          <button
            type="button"
            role="menuitem"
            className="menu-item justify-center text-xs font-medium text-brand-600"
            onClick={() => {
              setOpen(false);
              navigate('/notifications');
            }}
          >
            See all notifications
          </button>
        </div>
      )}
    </div>
  );
}
