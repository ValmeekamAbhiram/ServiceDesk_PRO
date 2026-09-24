/**
 * ServiceDesk Pro — the one Socket.IO connection.
 *
 * A module-level singleton rather than a React context, for the same reason
 * `session.ts` is a leaf: the ticket detail page needs to watch a ticket, the app
 * shell needs to open and close the connection, and threading a socket instance
 * through providers to reach both would be more moving parts than the thing being
 * moved.
 *
 * Three rules this file exists to keep:
 *
 *  - **One socket for the whole app.** Every page shares it. Opening a second one per
 *    page would double the server's room bookkeeping and lose events during the gap
 *    while the old one closes.
 *  - **The token travels in the handshake, not in a header.** `auth: { token }` is
 *    what `authorizeHandshake` reads. On reconnect the callback runs again, so a token
 *    refreshed in the meantime is picked up without tearing the socket down.
 *  - **Payloads are ids, never data.** Listeners here invalidate query keys and let
 *    the REST layer answer, because the REST layer is where read authorization lives.
 *    A socket that pushed ticket fields could show somebody more than a page refresh
 *    would.
 */
import { io } from 'socket.io-client';
import { ClientEvent, ServerEvent, SOCKET_NAMESPACE, } from '@shared/socket';
import { getSession } from '@/lib/session';
let socket = null;
let handlers = {};
/** Tickets the UI wants to watch. Replayed on reconnect — the server forgets rooms. */
const watched = new Set();
const TICKET_EVENTS = [
    ServerEvent.TICKET_CREATED,
    ServerEvent.TICKET_UPDATED,
    ServerEvent.TICKET_COMMENTED,
    ServerEvent.TICKET_SLA_CHANGED,
];
function status(next) {
    handlers.onStatusChange?.(next);
}
/**
 * Open the connection, or adopt the existing one.
 *
 * Idempotent on purpose: React may mount the shell twice in development, and the
 * second call must not leave an orphaned socket behind.
 */
export function connectRealtime(next) {
    handlers = next;
    if (socket) {
        status(socket.connected ? 'online' : 'connecting');
        return;
    }
    status('connecting');
    const apiBase = (import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');
    const socketEndpoint = apiBase ? `${apiBase}${SOCKET_NAMESPACE}` : SOCKET_NAMESPACE;
    socket = io(socketEndpoint, {
        /* A function, not a value: it is evaluated again on every reconnect attempt, so a
         * token refreshed by the api layer is used without reopening the socket. */
        auth: (cb) => cb({ token: getSession()?.accessToken ?? '' }),
        transports: ['websocket', 'polling'],
        withCredentials: true,
    });
    socket.on('connect', () => {
        status('online');
        /* Re-join after a drop. The server keeps no memory of a disconnected socket's
         * rooms, so without this a detail page left open goes quietly stale. */
        for (const id of watched)
            socket?.emit(ClientEvent.WATCH_TICKET, id);
    });
    socket.on('disconnect', () => status('offline'));
    /*
     * A refused handshake is not worth retrying: the token is wrong or absent, and the
     * api layer already ends the session when that is true. Retrying would produce a
     * connection attempt every second for as long as the tab stays open.
     */
    socket.on('connect_error', () => {
        status('offline');
        socket?.disconnect();
    });
    for (const event of TICKET_EVENTS) {
        socket.on(event, (payload) => {
            handlers.onTicketEvent?.(event, payload);
        });
    }
    socket.on(ServerEvent.NOTIFICATION, (payload) => {
        handlers.onNotification?.(payload);
    });
    socket.on(ServerEvent.CLOCK_CHANGED, () => {
        handlers.onClockChanged?.();
    });
}
/** Signing out. The watch list goes too — the next session is somebody else. */
export function disconnectRealtime() {
    watched.clear();
    handlers = {};
    socket?.disconnect();
    socket = null;
}
/**
 * Ask to watch one ticket. The server checks it is one the caller may read and
 * silently declines otherwise, so a request here is a request and never a grant.
 */
export function watchTicket(id) {
    watched.add(id);
    socket?.emit(ClientEvent.WATCH_TICKET, id);
}
export function unwatchTicket(id) {
    watched.delete(id);
    socket?.emit(ClientEvent.UNWATCH_TICKET, id);
}
