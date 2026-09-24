/**
 * ServiceDesk Pro — the real-time channel, and the boundary it defends.
 *
 * `socket.ts` says rooms are the authorization boundary. That claim is only worth
 * anything if something checks it, and it is not checkable from the service tests:
 * every guard here lives in the handshake or in the `ticket:watch` handler, both of
 * which supertest cannot reach because supertest does not speak websockets. So this
 * suite starts a real HTTP server on an ephemeral port and drives it with a real
 * `socket.io-client`.
 *
 * What is actually being asserted, in one line each:
 *   - an unauthenticated socket never connects, so there is no "listen first, prove
 *     who you are later" state for the rest of the rules to be bypassed from;
 *   - a connected socket is put into its own room by the server, not by asking;
 *   - `ticket:watch` on somebody else's ticket is refused, and the refusal is a room
 *     that was never joined rather than a message that stops arriving;
 *   - an employee is never in the staff queue room;
 *   - an internal note reaches staff and not the watching requester — the same rule
 *     the REST layer enforces, checked again on the socket that could leak it.
 *
 * Negative assertions here never rely on a bare sleep. Either they wait for a
 * positive signal on another socket first — the two sockets are served by one emit
 * call, so if the staff socket has the event, a socket that was going to get it
 * already has it — or they poll the server's own room membership to a deadline.
 */
import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as connectClient } from 'socket.io-client';
import { CommentVisibility, TicketStatus } from '@shared/enums';
import { ClientEvent, QUEUE_ROOM, ServerEvent, SOCKET_NAMESPACE, ticketRoom, userRoom, } from '@shared/socket';
import { createApp } from '@/app';
import { resetRateLimits } from '@/middleware/rate-limit';
import { Category } from '@/models';
import { attachSocketServer, closeSocketServer } from '@/realtime/socket';
import { clearDb, startDb, stopDb } from '@/test/db';
const PASSWORD = 'DevPassword123';
const authed = (token) => ({ Authorization: `Bearer ${token}` });
let app;
let server;
let io;
let port;
let adminToken;
let edToken;
let eveToken;
let edId;
let categoryId;
beforeAll(async () => {
    await startDb();
    await clearDb();
    app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    /* Same order as `index.ts`: the channel is attached to the server that is already
     * accepting connections, and everything the application emits goes through the
     * module-level channel this sets — including emits triggered by the supertest
     * requests below, which is what lets one suite drive both halves. */
    io = attachSocketServer(server);
    port = server.address().port;
    /* The first account registered becomes ADMIN; everyone after is an EMPLOYEE. The
     * admin doubles as "staff" here — `isStaff` covers ADMIN and TECHNICIAN alike, so
     * the queue-room rules are the same either way and the suite needs no promotion. */
    const admin = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Ada Admin', email: 'ada@example.com', password: PASSWORD });
    adminToken = admin.body.data.accessToken;
    const ed = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Ed Employee', email: 'ed@example.com', password: PASSWORD });
    edToken = ed.body.data.accessToken;
    edId = ed.body.data.user.id;
    const eve = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Eve Employee', email: 'eve@example.com', password: PASSWORD });
    eveToken = eve.body.data.accessToken;
    const category = await Category.create({ name: 'Network', slug: 'network', sortOrder: 1 });
    categoryId = category._id.toString();
});
const clients = [];
beforeEach(() => {
    resetRateLimits();
});
afterAll(async () => {
    for (const client of clients)
        client.disconnect();
    /* One call, not two: this closes the HTTP server as well, so a `server.close()`
     * here would fail with `ERR_SERVER_NOT_RUNNING` — which is exactly how the double
     * close in `index.ts` was found. */
    await closeSocketServer(io);
    await stopDb();
});
const namespaceUrl = () => `http://127.0.0.1:${port}${SOCKET_NAMESPACE}`;
/** `forceNew` because every client here needs its own identity, and the default
 *  behaviour is to share one underlying connection per URL. */
const options = (token) => ({
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
});
async function connect(token) {
    const socket = connectClient(namespaceUrl(), options(token));
    clients.push(socket);
    await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
    });
    return socket;
}
/** Resolves with the refusal message, and fails if the handshake is accepted. */
async function refusal(token) {
    const socket = connectClient(namespaceUrl(), options(token));
    clients.push(socket);
    return new Promise((resolve, reject) => {
        socket.once('connect_error', (error) => resolve(error.message));
        socket.once('connect', () => reject(new Error('The handshake was accepted; it must be refused.')));
    });
}
/** Records every payload for one event so a test can assert on an empty array. */
function inbox(socket, event) {
    const received = [];
    socket.on(event, (payload) => received.push(payload));
    return received;
}
/** The server's own view of which rooms a socket is in — the thing under test, not
 *  a proxy for it. Reading membership means a refused watch is caught even if
 *  nothing was ever emitted to that room. */
function rooms(client) {
    const serverSide = io.of(SOCKET_NAMESPACE).sockets.get(client.id ?? '');
    if (!serverSide)
        throw new Error('The server holds no socket for this client.');
    return serverSide.rooms;
}
/** Polls to a deadline. `true` means the condition happened; `false` means it never
 *  did within the window, which is how the negative cases are stated. */
async function eventually(check, ms = 750) {
    const deadline = Date.now() + ms;
    for (;;) {
        if (check())
            return true;
        if (Date.now() >= deadline)
            return false;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
async function raiseTicket(token, title) {
    const created = await request(app)
        .post('/api/tickets')
        .set(authed(token))
        .send({ title, description: 'Reported over the phone.', categoryId });
    expect(created.status).toBe(201);
    return { id: created.body.data.id, version: created.body.data.version };
}
async function moveTicket(ticket, status) {
    const moved = await request(app)
        .patch(`/api/tickets/${ticket.id}/status`)
        .set(authed(adminToken))
        .send({ status, version: ticket.version });
    expect(moved.status).toBe(200);
}
async function comment(ticketId, body, visibility) {
    const posted = await request(app)
        .post(`/api/tickets/${ticketId}/comments`)
        .set(authed(adminToken))
        .send({ body, visibility });
    expect(posted.status).toBe(201);
}
describe('the handshake', () => {
    it('refuses a socket with no token, so there is nothing to listen from', async () => {
        await expect(refusal()).resolves.toBe('Not signed in.');
    });
    it('refuses a token it did not sign', async () => {
        /* Shaped like a JWT so the refusal is the signature check rather than the parse:
         * a malformed string proves less than a well-formed forgery. */
        const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiJ9.notasignature';
        const before = io.of(SOCKET_NAMESPACE).sockets.size;
        await expect(refusal(forged)).resolves.toEqual(expect.any(String));
        /* A refused handshake must leave no socket behind. If the middleware let the
         * connection open and then disconnected it, this count would have moved. */
        expect(io.of(SOCKET_NAMESPACE).sockets.size).toBe(before);
    });
    it('puts an accepted socket in its own room without being asked', async () => {
        const ed = await connect(edToken);
        expect(rooms(ed).has(userRoom(edId))).toBe(true);
    });
});
describe('watching one ticket', () => {
    it('lets somebody watch a ticket they can see, and sends them its comments', async () => {
        const ticket = await raiseTicket(edToken, 'Wi-Fi keeps dropping');
        const ed = await connect(edToken);
        const comments = inbox(ed, ServerEvent.TICKET_COMMENTED);
        ed.emit(ClientEvent.WATCH_TICKET, ticket.id);
        expect(await eventually(() => rooms(ed).has(ticketRoom(ticket.id)))).toBe(true);
        await comment(ticket.id, 'We are replacing the access point.', CommentVisibility.PUBLIC);
        expect(await eventually(() => comments.length === 1)).toBe(true);
        expect(comments[0]?.ticketId).toBe(ticket.id);
    });
    it('refuses a watch on somebody else\u2019s ticket, and sends nothing about it', async () => {
        const hers = await raiseTicket(eveToken, 'Printer offline in Accounts');
        const ed = await connect(edToken);
        const admin = await connect(adminToken);
        const heard = inbox(ed, ServerEvent.TICKET_UPDATED);
        const staffHeard = inbox(admin, ServerEvent.TICKET_UPDATED);
        ed.emit(ClientEvent.WATCH_TICKET, hers.id);
        /* Polled to the deadline: the refusal is silent by design, so the assertion is
         * that the room never appears rather than that an error came back. */
        expect(await eventually(() => rooms(ed).has(ticketRoom(hers.id)))).toBe(false);
        await moveTicket(hers, TicketStatus.IN_PROGRESS);
        /* The admin is in the queue room, so one emit call served both sockets. Waiting
         * for the admin's copy is what makes the empty inbox below a real absence
         * instead of a race that happened to finish first. */
        expect(await eventually(() => staffHeard.length === 1)).toBe(true);
        expect(heard).toEqual([]);
    });
    it('stops sending a ticket\u2019s changes once it is unwatched', async () => {
        const ticket = await raiseTicket(edToken, 'Laptop will not charge');
        const ed = await connect(edToken);
        ed.emit(ClientEvent.WATCH_TICKET, ticket.id);
        expect(await eventually(() => rooms(ed).has(ticketRoom(ticket.id)))).toBe(true);
        ed.emit(ClientEvent.UNWATCH_TICKET, ticket.id);
        expect(await eventually(() => !rooms(ed).has(ticketRoom(ticket.id)))).toBe(true);
        /* The personal room is not a subscription the client manages, so leaving a
         * ticket must not take it with them. */
        expect(rooms(ed).has(userRoom(edId))).toBe(true);
    });
    it('ignores a watch on an id that is not an id', async () => {
        const ed = await connect(edToken);
        /* Socket.IO puts every socket in a room named after its own id, so the baseline
         * is read rather than assumed — the assertion is that it never grows. */
        const before = rooms(ed).size;
        for (const nonsense of ['not-an-id', '', 42, null, { $ne: null }]) {
            ed.emit(ClientEvent.WATCH_TICKET, nonsense);
        }
        /* Nothing to wait for but the connection surviving: a malformed id must be
         * dropped, not throw inside the handler and take the socket down with it. */
        expect(await eventually(() => rooms(ed).size > before)).toBe(false);
        expect(ed.connected).toBe(true);
    });
});
describe('the staff queue room', () => {
    it('admits staff and never an employee', async () => {
        const admin = await connect(adminToken);
        const ed = await connect(edToken);
        expect(rooms(admin).has(QUEUE_ROOM)).toBe(true);
        expect(rooms(ed).has(QUEUE_ROOM)).toBe(false);
    });
    it('announces a new ticket to staff, and to nobody else', async () => {
        const admin = await connect(adminToken);
        const ed = await connect(edToken);
        const staffHeard = inbox(admin, ServerEvent.TICKET_CREATED);
        const edHeard = inbox(ed, ServerEvent.TICKET_CREATED);
        const hers = await raiseTicket(eveToken, 'Cannot reach the shared drive');
        expect(await eventually(() => staffHeard.length === 1)).toBe(true);
        expect(staffHeard[0]?.ticketId).toBe(hers.id);
        /* Ed is a colleague, not staff. A queue event carries only an id, but knowing a
         * ticket exists at all is already more than his role sees. */
        expect(edHeard).toEqual([]);
    });
});
describe('internal notes', () => {
    it('reaches staff but never the requester watching their own ticket', async () => {
        const ticket = await raiseTicket(edToken, 'Switch port keeps flapping');
        const ed = await connect(edToken);
        const admin = await connect(adminToken);
        const edHeard = inbox(ed, ServerEvent.TICKET_COMMENTED);
        const staffHeard = inbox(admin, ServerEvent.TICKET_COMMENTED);
        /* Ed is watching his own ticket and is entitled to be: this is not a scope
         * failure being caught, it is the one case where the room contains somebody who
         * must not see what is about to be sent to it. */
        ed.emit(ClientEvent.WATCH_TICKET, ticket.id);
        expect(await eventually(() => rooms(ed).has(ticketRoom(ticket.id)))).toBe(true);
        await comment(ticket.id, 'Port 14 is dying, do not tell the user yet.', CommentVisibility.INTERNAL);
        expect(await eventually(() => staffHeard.length === 1)).toBe(true);
        /* Not merely "no text leaked" — no event at all. A bare `ticket:commented` would
         * tell the requester a note exists and prompt a refetch, and the refetch showing
         * nothing new is itself the leak. */
        expect(edHeard).toEqual([]);
        /* And the public path still works on the same watched ticket, so the absence
         * above is the visibility rule rather than a subscription that quietly died. */
        await comment(ticket.id, 'We are swapping your network port.', CommentVisibility.PUBLIC);
        expect(await eventually(() => edHeard.length === 1)).toBe(true);
    });
});
