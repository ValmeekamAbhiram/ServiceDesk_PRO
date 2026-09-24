/**
 * ServiceDesk Pro — Socket.IO server.
 *
 * ## Rooms are the authorization boundary
 *
 * A client never names the room it joins. On connection the server puts the socket
 * into that user's own room and, for staff, the shared queue room, both derived from
 * the authenticated handshake identity. The one client-initiated join — watching a
 * ticket's detail page — names a ticket id, so it is checked against
 * `ticketScopeFilter()`, the same expression the REST list uses. An employee asking
 * to watch somebody else's ticket is refused, not quietly honoured.
 *
 * ## The handshake is the same four checks as a REST call
 *
 * `authenticateToken()` is shared with the HTTP middleware, so a socket cannot
 * authenticate more loosely than the API — a revoked session or a deactivated user
 * is rejected here too.
 *
 * One honest limitation: identity is resolved once, at connect. A user demoted from
 * TECHNICIAN to EMPLOYEE keeps the queue room until their socket drops, where the
 * REST API would re-derive their role on the very next request. The window is one
 * connection long and it cannot widen a user's *ticket* access — `ticketScopeFilter`
 * keys off their user id, which never changes — so it is recorded here rather than
 * paid for with a database read on every frame.
 */
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { ClientEvent, QUEUE_ROOM, SOCKET_NAMESPACE, ticketRoom, userRoom } from '@shared/socket';
import { getClock } from '@/config/clock';
import { env, isAllowedOrigin } from '@/config/env';
import { moduleLogger } from '@/config/logger';
import { isStaff } from '@/core/actor';
import { authenticateToken } from '@/middleware/authenticate';
import { Ticket } from '@/models';
import { ticketScopeFilter } from '@/modules/tickets/ticket.service';
import { toObjectId } from '@/models/helpers';
import { setRealtimeChannel } from '@/realtime/emit';
const log = moduleLogger('realtime');
/** A socket may follow this many ticket pages at once. Tabs, not a crawler. */
const MAX_WATCHED_TICKETS = 20;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
function actorOf(entry) {
    return { ...entry.identity, clock: getClock() };
}
const state = new WeakMap();
/**
 * Read the access token out of the handshake.
 *
 * `auth.token` is where `socket.io-client` puts credentials, and it is the only
 * place read: a token in the query string ends up in access logs and browser
 * history, which is exactly the leak the header of `authenticate.ts` avoids for
 * REST calls.
 */
function handshakeToken(socket) {
    const raw = socket.handshake.auth?.token;
    if (typeof raw !== 'string')
        return null;
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    return token.trim().length > 0 ? token.trim() : null;
}
/**
 * The handshake gate. Throwing here refuses the connection; socket.io reports the
 * message to the client as a connect error, so it says the same unhelpful-by-design
 * thing the REST 401 says.
 */
async function authorizeHandshake(socket) {
    const token = handshakeToken(socket);
    if (!token)
        throw new Error('Not signed in.');
    const user = await authenticateToken(token, getClock().now().getTime());
    state.set(socket, {
        identity: {
            user,
            /* Prefixed so a log line from a socket is distinguishable from an HTTP one. */
            requestId: `ws-${randomUUID()}`,
            ip: socket.handshake.address ?? null,
            userAgent: socket.handshake.headers['user-agent'] ?? null,
            automated: false,
        },
        watching: new Set(),
    });
}
/**
 * Join a ticket's room, if the caller is allowed to read that ticket.
 *
 * The check is `ticketScopeFilter()` — the same expression the list endpoint and the
 * dashboard use — so "who may watch this" cannot drift from "who may open this". A
 * refusal is silent: the client learns nothing about whether the id exists, matching
 * the 404-not-403 rule the REST layer follows for the same reason.
 */
async function watchTicket(socket, rawId) {
    const entry = state.get(socket);
    if (!entry)
        return;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!OBJECT_ID.test(id))
        return;
    if (entry.watching.has(id))
        return;
    if (entry.watching.size >= MAX_WATCHED_TICKETS) {
        log.debug({ userId: entry.identity.user.id }, 'Socket reached its ticket-watch limit.');
        return;
    }
    const visible = await Ticket.exists({
        _id: toObjectId(id),
        ...ticketScopeFilter(actorOf(entry)),
    });
    if (!visible) {
        log.debug({ userId: entry.identity.user.id, ticketId: id }, 'Ticket watch refused.');
        return;
    }
    entry.watching.add(id);
    await socket.join(ticketRoom(id));
}
async function unwatchTicket(socket, rawId) {
    const entry = state.get(socket);
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!entry || !entry.watching.delete(id))
        return;
    await socket.leave(ticketRoom(id));
}
/** Rooms the server assigns. The client is never asked which it wants. */
async function joinAssignedRooms(socket, entry) {
    await socket.join(userRoom(entry.identity.user.id));
    if (isStaff(actorOf(entry)))
        await socket.join(QUEUE_ROOM);
}
function onConnection(socket) {
    const entry = state.get(socket);
    if (!entry) {
        socket.disconnect(true);
        return;
    }
    void joinAssignedRooms(socket, entry);
    log.debug({ userId: entry.identity.user.id, role: entry.identity.user.role }, 'Socket connected.');
    /*
     * The handlers are async and socket.io ignores the promise, so an unhandled
     * rejection here would be a process-level warning rather than anything the client
     * sees. Each is wrapped so a failed lookup stays a log line.
     */
    socket.on(ClientEvent.WATCH_TICKET, (id) => {
        void watchTicket(socket, id).catch((error) => log.warn({ err: error }, 'Ticket watch failed.'));
    });
    socket.on(ClientEvent.UNWATCH_TICKET, (id) => {
        void unwatchTicket(socket, id).catch((error) => log.warn({ err: error }, 'Ticket unwatch failed.'));
    });
    socket.on('disconnect', (reason) => {
        state.delete(socket);
        log.debug({ userId: entry.identity.user.id, reason }, 'Socket disconnected.');
    });
}
/**
 * Attach the real-time channel to the HTTP server the API is already listening on.
 *
 * One port, one process — the whole reason `createApp()` returns the app without
 * calling `listen()`. CORS is the same allow-list the REST layer uses, because a
 * websocket that accepted origins the API rejects would be a way to read the API
 * from a page that is not allowed to.
 */
export function attachSocketServer(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: (origin, callback) => {
                callback(null, isAllowedOrigin(origin));
            },
            credentials: true,
        },
        /* The client is a browser on the same origin family; long-polling is only a
         * fallback, and allowing it keeps the app working behind proxies that break
         * websocket upgrades. */
        transports: ['websocket', 'polling'],
    });
    const channel = io.of(SOCKET_NAMESPACE);
    channel.use((socket, next) => {
        authorizeHandshake(socket).then(() => next(), (error) => {
            log.debug({ err: error }, 'Socket handshake rejected.');
            next(error instanceof Error ? error : new Error('Not signed in.'));
        });
    });
    channel.on('connection', onConnection);
    setRealtimeChannel(channel);
    log.info({ namespace: SOCKET_NAMESPACE, origins: env.corsOrigins }, 'Real-time channel ready');
    return io;
}
/**
 * Detach on shutdown so `emit()` stops writing to a closing server.
 *
 * This is the entire shutdown, not just the socket half: `io.close()` disconnects
 * every socket, closes the engine, and then closes the HTTP server it was attached
 * to, resolving once in-flight requests have drained. A caller that follows this
 * with its own `server.close()` is closing an already-closed server and gets
 * `ERR_SERVER_NOT_RUNNING` for it.
 */
export async function closeSocketServer(io) {
    setRealtimeChannel(null);
    await io.close();
}
