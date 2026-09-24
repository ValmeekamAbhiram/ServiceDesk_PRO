/**
 * ServiceDesk Pro — the full notification inbox.
 *
 * The bell shows the last eight; this page pages through all of them and can filter to
 * unread. Both read the same endpoint, and both take `unreadCount` from the response
 * rather than counting rows, so the badge in the header and the count here cannot drift.
 *
 * `unreadOnly` lives in the URL. That matters more than it looks: marking a row read
 * while the unread filter is on removes it from the list, and a filter you can see in the
 * address bar makes that disappearance obviously the filter rather than a lost message.
 *
 * Notifications are delivered in-app only. There is no email in this build, so nothing
 * here claims a message was sent anywhere else.
 */
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { relativeTime } from '@shared/utils';
import { notificationTypeMeta } from '@shared/labels';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, } from '@/api/notifications';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toast } from '@/stores/toast.store';
import { useNow } from '@/hooks/useNow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonRows } from '@/components/ui/Skeleton';
const PAGE_SIZE = 20;
export default function Notifications() {
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const now = useNow();
    const unreadOnly = params.get('unread') === '1';
    const query = useMemo(() => ({ page: Number(params.get('page') ?? 1), limit: PAGE_SIZE, unreadOnly }), [params, unreadOnly]);
    const list = useNotifications(query);
    const markRead = useMarkNotificationRead(query);
    const markAll = useMarkAllNotificationsRead(query);
    const setParam = (key, value) => {
        const next = new URLSearchParams(params);
        if (value === null)
            next.delete(key);
        else
            next.set(key, value);
        if (key !== 'page')
            next.delete('page');
        setParams(next, { replace: true });
    };
    const items = list.data?.items ?? [];
    const unread = list.data?.unreadCount ?? 0;
    /* Mark first, then navigate, and both regardless of the outcome: a notification about a
     * ticket that has since been closed to this reader should still stop being unread. */
    const open = (notification) => {
        if (!notification.read)
            markRead.mutate(notification.id);
        if (notification.link)
            navigate(notification.link);
    };
    const readAll = async () => {
        try {
            await markAll.mutateAsync();
            toast.success('Inbox cleared.');
        }
        catch (error) {
            toast.error(error instanceof ApiClientError ? error.message : 'That could not be saved.');
        }
    };
    return (<div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-ink">Notifications</h1>
          <p className="text-xs text-ink-subtle">
            {unread === 0 ? 'Nothing unread.' : `${unread} unread.`} Delivered in the app only.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={unreadOnly ? 'chip' : 'chip border-brand-300 bg-brand-50 text-brand-700'} aria-pressed={!unreadOnly} onClick={() => setParam('unread', null)}>
            All
          </button>
          <button type="button" className={unreadOnly ? 'chip border-brand-300 bg-brand-50 text-brand-700' : 'chip'} aria-pressed={unreadOnly} onClick={() => setParam('unread', '1')}>
            Unread
          </button>
          {unread > 0 && (<Button size="sm" variant="secondary" loading={markAll.isPending} onClick={() => void readAll()}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true"/>
              Mark all read
            </Button>)}
        </div>
      </div>

      <Card>
        {list.isLoading ? (<div className="p-4">
            <SkeletonRows rows={6} cols={2}/>
          </div>) : items.length === 0 ? (<EmptyState icon={<Bell className="h-5 w-5" aria-hidden="true"/>} title={unreadOnly ? 'Nothing unread' : 'No notifications yet'} message={unreadOnly
                ? 'You are up to date.'
                : 'You will hear about tickets assigned to you, replies, and SLA warnings.'} action={unreadOnly ? (<button type="button" className="btn btn-secondary btn-sm" onClick={() => setParam('unread', null)}>
                  Show everything
                </button>) : (<Link to="/tickets" className="btn btn-secondary btn-sm">
                  Go to tickets
                </Link>)}/>) : (<ul className="divide-y divide-line">
            {items.map((notification) => {
                const meta = notificationTypeMeta(notification.type);
                return (<li key={notification.id}>
                  {/* A button, not a link: the row both writes (marks read) and navigates,
                      * and a link that fires a mutation is a link you cannot safely
                      * middle-click. */}
                  <button type="button" onClick={() => open(notification)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface-sunken', !notification.read && 'bg-brand-50/50 dark:bg-brand-500/5')}>
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', notification.read ? 'bg-transparent' : 'bg-brand-600')} aria-hidden="true"/>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('text-sm text-ink', !notification.read && 'font-semibold')}>
                          {notification.title}
                        </p>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">{notification.body}</p>
                    </div>
                    <time dateTime={notification.createdAt} className="shrink-0 whitespace-nowrap text-2xs text-ink-subtle">
                      {relativeTime(notification.createdAt, now)}
                    </time>
                  </button>
                </li>);
            })}
          </ul>)}
        {list.data && (<Pagination meta={list.data.meta} unit="notification" onPageChange={(page) => setParam('page', String(page))}/>)}
      </Card>
    </div>);
}
