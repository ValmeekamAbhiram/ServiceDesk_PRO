/**
 * ServiceDesk Pro — live updates.
 *
 * `useRealtime()` is mounted once, in the app shell, and does one job: turn socket
 * events into cache invalidations. It deliberately does not put event payloads into
 * the cache. The payload is `{ ticketId, number }`, and the reason it carries no
 * ticket fields is that the same event reaches people who are allowed to see
 * different things — so the refetch, which goes through the authorizing endpoint, is
 * the only honest way to apply it.
 *
 * `useWatchTicket(id)` is the detail page's half: join that ticket's room while the
 * page is open, leave on unmount.
 */
import { useEffect, useState } from 'react';
import { ServerEvent } from '@shared/socket';
import { keys, queryClient } from '@/lib/query';
import { connectRealtime, disconnectRealtime, unwatchTicket, watchTicket, } from '@/lib/realtime';
import { toast } from '@/stores/toast.store';
export function useRealtime(enabled) {
    const [status, setStatus] = useState('offline');
    useEffect(() => {
        if (!enabled) {
            disconnectRealtime();
            setStatus('offline');
            return;
        }
        connectRealtime({
            onStatusChange: setStatus,
            onTicketEvent: (event, payload) => {
                /* The list's counts and rows both move on any of these. */
                void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
                void queryClient.invalidateQueries({ queryKey: keys.dashboard.all });
                if (event === ServerEvent.TICKET_COMMENTED) {
                    void queryClient.invalidateQueries({
                        queryKey: keys.tickets.comments(payload.ticketId),
                    });
                }
            },
            onNotification: (notification) => {
                void queryClient.invalidateQueries({ queryKey: keys.notifications.all });
                /* One line, not the body: the bell holds the detail, and a toast that
                 * repeated it would say the same thing twice on screen. */
                toast.info(notification.title);
            },
            /*
             * The demo clock moved. Every countdown on screen was computed from a
             * server-side `remainingMs`, so they are all wrong now — refetch everything
             * rather than trying to work out which views showed a deadline.
             */
            onClockChanged: () => {
                void queryClient.invalidateQueries();
            },
        });
        return () => {
            disconnectRealtime();
        };
    }, [enabled]);
    return status;
}
export function useWatchTicket(id) {
    useEffect(() => {
        if (!id)
            return;
        watchTicket(id);
        return () => unwatchTicket(id);
    }, [id]);
}
