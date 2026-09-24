/**
 * ServiceDesk Pro — notifications, driven through real ticket operations.
 *
 * The fan-out rules are the whole feature, and none of them can be checked by
 * calling the notification service directly with hand-made arguments: they are
 * about *who* a real assignment or a real comment concerns. So this suite works
 * the ticket service and then reads the bell menu, which is also the only way to
 * prove the two are actually wired together.
 *
 * The rule that matters most is the internal note. An employee's bell must not
 * mention one — not its text, not its existence, not a bare count.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CommentVisibility, NotificationType, Role, TicketStatus, UserStatus } from '@shared/enums';
import { resolvePermissions } from '@/core/authz/permissions';
import { FixedClock } from '@/core/clock';
import { Category, Notification, User } from '@/models';
import { NotFoundError } from '@/utils/errors';
import { clearDb, startDb, stopDb } from '@/test/db';
import { list, markAllRead, markRead } from '@/modules/notifications/notification.service';
import * as tickets from '@/modules/tickets/ticket.service';
beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);
const clock = new FixedClock('2026-03-10T11:00:00.000Z');
function actorFor(user) {
    return {
        user: {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            permissions: resolvePermissions(user.role),
            sessionId: 'test-session',
        },
        requestId: 'test-request',
        clock,
        ip: '203.0.113.7',
        userAgent: 'vitest',
        automated: false,
    };
}
let seq = 0;
async function person(role, name) {
    seq += 1;
    const user = await User.create({
        name,
        email: `user${seq}@example.com`,
        passwordHash: 'not-used-here',
        role,
        status: UserStatus.ACTIVE,
    });
    return actorFor(user);
}
async function category() {
    const row = await Category.create({ name: 'Network', slug: 'network', active: true });
    return row._id.toString();
}
/** A ticket raised by `requester`, optionally already assigned to `tech`. */
async function raise(requester, categoryId) {
    return tickets.create({ title: 'Wi-Fi keeps dropping', description: 'Every few minutes.', categoryId }, requester);
}
async function bell(actor) {
    return list({ page: 1, limit: 25, unreadOnly: undefined }, actor);
}
describe('who hears about a ticket', () => {
    it('tells the new assignee, and says who assigned it', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const admin = await person(Role.ADMIN, 'Ada Admin');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const ticket = await raise(employee, await category());
        await tickets.assign(ticket.id, { assigneeId: tech.user.id, version: ticket.version }, admin);
        const menu = await bell(tech);
        expect(menu.unreadCount).toBe(1);
        expect(menu.items[0]?.type).toBe(NotificationType.TICKET_ASSIGNED);
        expect(menu.items[0]?.title).toContain(ticket.number);
        expect(menu.items[0]?.body).toContain('Ada Admin');
        expect(menu.items[0]?.link).toBe(`/tickets/${ticket.id}`);
    });
    it('says nothing to a technician who assigned the ticket to themselves', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const ticket = await raise(employee, await category());
        await tickets.assign(ticket.id, { assigneeId: tech.user.id, version: ticket.version }, tech);
        expect((await bell(tech)).unreadCount).toBe(0);
    });
    it('tells the requester when their ticket moves, and not the person who moved it', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const ticket = await raise(employee, await category());
        await tickets.changeStatus(ticket.id, { status: TicketStatus.IN_PROGRESS, version: ticket.version }, tech);
        const menu = await bell(employee);
        expect(menu.items).toHaveLength(1);
        expect(menu.items[0]?.type).toBe(NotificationType.TICKET_STATUS_CHANGED);
        expect(menu.items[0]?.body).toContain('In progress');
        expect((await bell(tech)).items).toHaveLength(0);
    });
    it('tells both the requester and the assignee when a third person moves it', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const admin = await person(Role.ADMIN, 'Ada Admin');
        const ticket = await raise(employee, await category());
        const assigned = await tickets.assign(ticket.id, { assigneeId: tech.user.id, version: ticket.version }, admin);
        await tickets.changeStatus(ticket.id, { status: TicketStatus.IN_PROGRESS, version: assigned.version }, admin);
        const statusOnly = (menu) => menu.items.filter((row) => row.type === NotificationType.TICKET_STATUS_CHANGED);
        expect(statusOnly(await bell(employee))).toHaveLength(1);
        expect(statusOnly(await bell(tech))).toHaveLength(1);
        expect((await bell(admin)).items).toHaveLength(0);
    });
});
describe('comments, and the internal note rule', () => {
    it('tells the requester about a public reply', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const ticket = await raise(employee, await category());
        await tickets.addComment(ticket.id, { body: 'Have you tried the other network?', visibility: CommentVisibility.PUBLIC }, tech);
        const menu = await bell(employee);
        expect(menu.items).toHaveLength(1);
        expect(menu.items[0]?.type).toBe(NotificationType.TICKET_COMMENTED);
        expect(menu.items[0]?.title).toContain('New comment');
    });
    /*
     * The one this suite exists for. An employee must not learn that an internal note
     * was written on their ticket — the count is as much of a leak as the text, because
     * a bell that ticks up whenever the desk discusses you is itself information.
     */
    it('never tells the requester about an internal note, by text or by count', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const admin = await person(Role.ADMIN, 'Ada Admin');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const ticket = await raise(employee, await category());
        const assigned = await tickets.assign(ticket.id, { assigneeId: tech.user.id, version: ticket.version }, admin);
        await tickets.addComment(assigned.id, { body: 'Requester has broken this twice; check the switch port.', visibility: CommentVisibility.INTERNAL }, admin);
        const theirs = await bell(employee);
        expect(theirs.unreadCount).toBe(0);
        expect(theirs.items.filter((row) => row.type === NotificationType.TICKET_COMMENTED)).toHaveLength(0);
        expect(JSON.stringify(theirs)).not.toContain('switch port');
        /* The assignee is staff, so they do hear about it. */
        const staff = await bell(tech);
        expect(staff.items.filter((row) => row.type === NotificationType.TICKET_COMMENTED)).toHaveLength(1);
        expect(staff.items[0]?.title).toContain('Internal note');
    });
    it('does not notify the requester about their own comment', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const ticket = await raise(employee, await category());
        await tickets.addComment(ticket.id, { body: 'Any update?', visibility: CommentVisibility.PUBLIC }, employee);
        expect((await bell(employee)).unreadCount).toBe(0);
    });
});
describe('the bell menu', () => {
    /** Two notifications for the employee, from two separate changes. */
    async function twoFor(employee, tech) {
        const ticket = await raise(employee, await category());
        const moved = await tickets.changeStatus(ticket.id, { status: TicketStatus.IN_PROGRESS, version: ticket.version }, tech);
        await tickets.addComment(moved.id, { body: 'Looking into it now.', visibility: CommentVisibility.PUBLIC }, tech);
    }
    it('returns newest first, with an unread count independent of the page', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        await twoFor(employee, tech);
        const firstPage = await list({ page: 1, limit: 1, unreadOnly: undefined }, employee);
        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.meta.total).toBe(2);
        /* The badge says 2 while the menu shows 1 — the reason it is counted separately. */
        expect(firstPage.unreadCount).toBe(2);
        expect(firstPage.items[0]?.type).toBe(NotificationType.TICKET_COMMENTED);
    });
    it('filters to unread when asked', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        await twoFor(employee, tech);
        const all = await bell(employee);
        await markRead(all.items[0].id, employee);
        const unread = await list({ page: 1, limit: 25, unreadOnly: true }, employee);
        expect(unread.items).toHaveLength(1);
        expect(unread.unreadCount).toBe(1);
        expect(unread.items.every((row) => !row.read)).toBe(true);
    });
    it('marks everything read and hands back the refreshed page', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        await twoFor(employee, tech);
        const after = await markAllRead({ page: 1, limit: 25, unreadOnly: undefined }, employee);
        expect(after.unreadCount).toBe(0);
        expect(after.items).toHaveLength(2);
        expect(after.items.every((row) => row.read)).toBe(true);
    });
    it('records when it was read, from the actor clock', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        await twoFor(employee, tech);
        const menu = await bell(employee);
        await markRead(menu.items[0].id, employee);
        const row = await Notification.findById(menu.items[0].id).lean();
        expect(row?.readAt?.toISOString()).toBe('2026-03-10T11:00:00.000Z');
    });
});
describe('whose notifications these are', () => {
    /** One notification, addressed to the employee, produced by the technician. */
    async function oneForEmployee(employee, tech) {
        const ticket = await raise(employee, await category());
        await tickets.changeStatus(ticket.id, { status: TicketStatus.IN_PROGRESS, version: ticket.version }, tech);
        const menu = await bell(employee);
        return menu.items[0].id;
    }
    it('does not let anyone read somebody else\u2019s bell menu through their own', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        await oneForEmployee(employee, tech);
        /* An admin is the most privileged role in the app and still sees nothing here:
         * this is ownership, not a permission, so no role escapes it. */
        const admin = await person(Role.ADMIN, 'Ada Admin');
        expect((await bell(admin)).items).toHaveLength(0);
        expect((await bell(admin)).unreadCount).toBe(0);
    });
    it('answers 404, not 403, when marking a notification that is not yours', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const admin = await person(Role.ADMIN, 'Ada Admin');
        const id = await oneForEmployee(employee, tech);
        await expect(markRead(id, admin)).rejects.toBeInstanceOf(NotFoundError);
        /* And it is still unread for the person it belongs to. */
        expect((await bell(employee)).unreadCount).toBe(1);
    });
    it('keeps read state per person when one event notifies two people', async () => {
        const employee = await person(Role.EMPLOYEE, 'Ed Employee');
        const tech = await person(Role.TECHNICIAN, 'Tara Tech');
        const admin = await person(Role.ADMIN, 'Ada Admin');
        const ticket = await raise(employee, await category());
        const assigned = await tickets.assign(ticket.id, { assigneeId: tech.user.id, version: ticket.version }, admin);
        await tickets.changeStatus(assigned.id, { status: TicketStatus.IN_PROGRESS, version: assigned.version }, admin);
        await markAllRead({ page: 1, limit: 25, unreadOnly: undefined }, employee);
        expect((await bell(employee)).unreadCount).toBe(0);
        /* One row per recipient is what makes this true — see the model's header. */
        expect((await bell(tech)).unreadCount).toBe(2);
    });
});
