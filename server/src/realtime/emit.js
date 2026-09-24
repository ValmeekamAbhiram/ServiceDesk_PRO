/**
 * ServiceDesk Pro — outbound real-time emissions.
 *
 * ## Why this is a separate file from `socket.ts`
 *
 * Import direction. `socket.ts` has to authorize a `ticket:watch` request, so it
 * imports the ticket service; the ticket service raises notifications, and the
 * notification service emits. Putting the emit helpers in `socket.ts` would close
 * that into a cycle — socket → tickets → notifications → socket. This module
 * imports nothing from any feature module and is therefore safe for a service to
 * depend on.
 *
 * ## Nothing here is required to succeed
 *
 * Every helper is a no-op when no channel is attached, which is the normal state
 * in the test suite: supertest drives the Express app without opening a port, and
 * 250-odd existing tests must not start needing a websocket. That same property
 * is what makes emitting safe from inside a request — see `emit()`.
 */
import { QUEUE_ROOM, ticketRoom, userRoom } from '@shared/socket';
import { moduleLogger } from '@/config/logger';
const log = moduleLogger('realtime');
let channel = null;
/**
 * Installed by `attachSocketServer()` at boot, and by tests that want to observe
 * emissions. Passing `null` detaches, so a test cannot leak a live namespace into
 * the next file.
 */
export function setRealtimeChannel(next) {
    channel = next;
}
export function realtimeAttached() {
    return channel !== null;
}
/**
 * The single point where an emission can fail, and the single place that decides
 * a failure is not the caller's problem.
 *
 * Callers are mid-request: a technician has just been assigned a ticket, the row
 * is written, and the response is about to go out. If serialising a payload throws
 * here, the correct outcome is a missing live update and a warning in the log — not
 * a 500 on an assignment that actually happened.
 */
function emit(rooms, event, payload) {
    if (!channel)
        return;
    try {
        channel.to(rooms).emit(event, payload);
    }
    catch (error) {
        log.warn({ err: error, event, rooms }, 'Real-time emit failed; the write is unaffected.');
    }
}
/** One person, wherever they are signed in. Notifications go here. */
export function emitToUser(userId, event, payload) {
    emit(userRoom(userId), event, payload);
}
/**
 * A ticket changed: tell everyone with its page open, and the whole desk.
 *
 * One emission over two rooms rather than two emissions, because `to([a, b])` unions
 * them and delivers once per socket — a technician who has the ticket open is in both
 * rooms, and two events would mean two refetches for one change.
 *
 * Public activity only. An internal note goes to `emitToStaff` alone: the ticket room
 * contains the requester.
 */
export function emitTicketChange(ticketId, event, payload) {
    emit([ticketRoom(ticketId), QUEUE_ROOM], event, payload);
}
/**
 * Every signed-in technician and admin. This is the room internal comments go to,
 * and the reason it exists: the ticket room contains the requester.
 */
export function emitToStaff(event, payload) {
    emit(QUEUE_ROOM, event, payload);
}
/**
 * Everyone connected, signed in as anybody. The demo clock is the only thing that
 * uses this, and it is the reason the function is not `emitToStaff`: a jump forward
 * moves the countdown on an employee's own ticket too, and their page has to refetch
 * or it will show a deadline that passed four hours ago.
 *
 * The payload carries no ticket and no user, so there is nothing here that a
 * recipient is not already entitled to see.
 */
export function emitToEveryone(event, payload) {
    if (!channel)
        return;
    try {
        channel.emit(event, payload);
    }
    catch (error) {
        log.warn({ err: error, event }, 'Real-time broadcast failed; the write is unaffected.');
    }
}
