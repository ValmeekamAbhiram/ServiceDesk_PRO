/**
 * ServiceDesk Pro — the query-injection boundary.
 *
 * `config/db.ts` deliberately does not set Mongoose's `sanitizeFilter`, because it
 * rewrites this application's own operator filters and breaks them — loudly on an
 * ObjectId path, silently on a string or date one. These tests hold up the two
 * halves of that decision, so re-enabling the flag or loosening a schema fails here
 * rather than in production:
 *
 *   1. an operator object cannot reach a service, because Zod rejects it first;
 *   2. the operator filters the application writes itself still match rows.
 *
 * Express parses `?status[$ne]=CLOSED` into a nested object with its default query
 * parser, so the first half is a real attack surface and not a hypothetical one.
 */
import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { Role, TicketStatus, UserStatus } from '@shared/enums';
import { loginSchema } from '@/modules/auth/auth.schema';
import { listTicketsSchema, ticketIdSchema } from '@/modules/tickets/ticket.schema';
import { User } from '@/models/user.model';
import { clearDb, startDb, stopDb } from '@/test/db';
beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);
describe('an operator object cannot reach a query', () => {
    it('refuses the classic login bypass', () => {
        /* `{"email": {"$ne": null}}` is the payload `sanitizeFilter` exists to stop.
         * It never gets that far: the schema wants a string. */
        const parsed = loginSchema.body.safeParse({ email: { $ne: null }, password: { $ne: null } });
        expect(parsed.success).toBe(false);
    });
    it('refuses an operator smuggled through a query string', () => {
        const parsed = listTicketsSchema.query.safeParse({ status: { $ne: TicketStatus.CLOSED } });
        expect(parsed.success).toBe(false);
    });
    it('refuses an operator in place of an id', () => {
        expect(ticketIdSchema.params.safeParse({ id: { $ne: null } }).success).toBe(false);
        expect(listTicketsSchema.query.safeParse({ requesterId: { $gt: '' } }).success).toBe(false);
    });
    it('refuses an operator in place of a date range', () => {
        expect(listTicketsSchema.query.safeParse({ createdFrom: { $gt: 0 } }).success).toBe(false);
    });
    it('still accepts the honest version of each of those', () => {
        const parsed = listTicketsSchema.query.safeParse({
            status: `${TicketStatus.OPEN},${TicketStatus.IN_PROGRESS}`,
            createdFrom: '2026-01-01T00:00:00.000Z',
        });
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.status).toEqual([TicketStatus.OPEN, TicketStatus.IN_PROGRESS]);
    });
});
describe("the application's own operator filters still match", () => {
    async function seedUsers() {
        return User.create([
            { name: 'Ada', email: 'ada@example.com', passwordHash: 'x', role: Role.TECHNICIAN, status: UserStatus.ACTIVE },
            { name: 'Grace', email: 'grace@example.com', passwordHash: 'x', role: Role.EMPLOYEE, status: UserStatus.ACTIVE },
        ]);
    }
    it('matches an $in on an ObjectId path', async () => {
        /* The exact query behind a ticket's status timeline. Under `sanitizeFilter` this
         * threw a CastError that surfaced as a 404 on every ticket read. */
        const [ada, grace] = await seedUsers();
        const found = await User.find({ _id: { $in: [ada._id, grace._id] } }).select('name');
        expect(found).toHaveLength(2);
    });
    it('matches an $in on a string path', async () => {
        /* The status and priority filters. This is the dangerous failure mode: under
         * `sanitizeFilter` it threw nothing and returned an empty list. */
        await seedUsers();
        const found = await User.find({ role: { $in: [Role.TECHNICIAN, Role.EMPLOYEE] } });
        expect(found).toHaveLength(2);
    });
    it('matches a $ne and a date range', async () => {
        const [ada] = await seedUsers();
        expect(await User.countDocuments({ _id: { $ne: ada._id } })).toBe(1);
        const window = { createdAt: { $gte: new Date(Date.now() - 60_000), $lte: new Date(Date.now() + 60_000) } };
        expect(await User.countDocuments(window)).toBe(2);
    });
    it('makes a typo\'d filter key throw rather than match everything', async () => {
        await seedUsers();
        /* The other half of the configuration, and the reason it is `'throw'` and not
         * `true`: with `true` Mongoose strips the unknown key, the filter becomes `{}`,
         * and a scoped read returns the whole collection instead of one user's rows. */
        expect(mongoose.get('strictQuery')).toBe('throw');
        await expect(User.countDocuments({ rôle: Role.TECHNICIAN })).rejects.toThrow(/strict/i);
    });
});
