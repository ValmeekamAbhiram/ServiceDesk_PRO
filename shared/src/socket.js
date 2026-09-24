/**
 * ServiceDesk Pro — Socket.IO event contract.
 *
 * Both ends import these names, so a typo becomes a compile error instead of an
 * event nobody receives — the failure mode that is hardest to debug, because
 * nothing errors, the UI simply never updates.
 *
 * Rooms are the authorization boundary. A client cannot ask to join an arbitrary
 * room: the server puts each socket into its own user room and, for staff, the
 * shared queue room, based on the authenticated identity from the handshake. So
 * an employee cannot subscribe to the queue and watch everyone else's tickets.
 */
export const SOCKET_NAMESPACE = '/rt';
/** Emitted by the browser. Deliberately few — the client mostly listens. */
export const ClientEvent = {
    /** Watch one ticket's detail page for live comments and status changes. */
    WATCH_TICKET: 'ticket:watch',
    UNWATCH_TICKET: 'ticket:unwatch',
};
/** Emitted by the server. */
export const ServerEvent = {
    TICKET_CREATED: 'ticket:created',
    TICKET_UPDATED: 'ticket:updated',
    TICKET_COMMENTED: 'ticket:commented',
    /** SLA state changed — the countdown crossed at-risk or breached. */
    TICKET_SLA_CHANGED: 'ticket:sla',
    NOTIFICATION: 'notification:new',
    /** The demo clock moved; the client re-fetches so countdowns jump with it. */
    CLOCK_CHANGED: 'demo:clock',
};
/** Personal room: notifications and anything addressed to one person. */
export function userRoom(userId) {
    return `user:${userId}`;
}
/** One ticket's detail page. Joined only while that page is open. */
export function ticketRoom(ticketId) {
    return `ticket:${ticketId}`;
}
/** The shared technician queue. Staff only — see the header. */
export const QUEUE_ROOM = 'queue';
