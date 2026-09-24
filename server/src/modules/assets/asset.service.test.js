/**
 * ServiceDesk Pro — asset service integration tests.
 *
 * Same bias as the ticket suite: the properties something would go badly wrong
 * without, not every line. Concretely —
 *
 *  - an employee sees the hardware issued to them and nothing else, and cannot widen
 *    that with a query string,
 *  - a serial number is unique where it exists and absent where it does not,
 *  - "retired, and still issued to Ada" is unreachable from either direction,
 *  - `version` actually stops a stale write,
 *  - the warranty countdown follows the injected clock rather than the wall clock.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AssetStatus, AssetType, Role, UserStatus } from '@shared/enums';
import { FixedClock } from '@/core/clock';
import { resolvePermissions } from '@/core/authz/permissions';
import { Asset, User } from '@/models';
import { clearDb, startDb, stopDb } from '@/test/db';
import * as assets from '@/modules/assets/asset.service';
import { listAssetsSchema } from '@/modules/assets/asset.schema';
beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);
/** Monday 2026-01-05, 09:00 UTC. Every warranty expectation below counts from here. */
const clock = new FixedClock('2026-01-05T09:00:00.000Z');
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
async function makeUser(name, role) {
    return User.create({
        name,
        email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
        passwordHash: 'not-used-here',
        role,
        status: UserStatus.ACTIVE,
    });
}
/** Parses through the real schema, so a test cannot pass a shape a request could not. */
function listQuery(raw = {}) {
    return listAssetsSchema.query.parse(raw);
}
describe('creating an asset', () => {
    it('allocates a sequential tag and defaults to stock', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const first = await assets.create({ name: 'ThinkPad X1', type: AssetType.LAPTOP }, admin);
        const second = await assets.create({ name: 'Dell U2723', type: AssetType.MONITOR }, admin);
        expect(first.tag).toBe('AST-000001');
        expect(second.tag).toBe('AST-000002');
        expect(first.status).toBe(AssetStatus.IN_STOCK);
        expect(first.assignedTo).toBeNull();
        expect(first.version).toBe(1);
    });
    it('round-trips the fields, including the one named `model`', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        /* `model` collides with Mongoose's `Document.model()`, so the service writes it
         * with `set()`. This is the test that the value comes back rather than the method. */
        const created = await assets.create({
            name: 'ThinkPad X1',
            type: AssetType.LAPTOP,
            manufacturer: 'Lenovo',
            model: '21CB',
            serialNumber: 'PF-0AA111',
            location: 'Floor 2',
        }, admin);
        expect(created.model).toBe('21CB');
        const reread = await assets.getById(created.id, admin);
        expect(reread.model).toBe('21CB');
        expect(reread.manufacturer).toBe('Lenovo');
    });
    it('refuses a duplicate serial number but allows many without one', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        await assets.create({ name: 'ThinkPad X1', type: AssetType.LAPTOP, serialNumber: 'PF-0AA111' }, admin);
        await expect(assets.create({ name: 'Another X1', type: AssetType.LAPTOP, serialNumber: 'PF-0AA111' }, admin)).rejects.toThrow(/serial number/i);
        /* The index is partial for exactly this reason: cable trays have no serial, and a
         * plain unique index would treat the second `null` as a duplicate of the first. */
        await assets.create({ name: 'Cable tray A', type: AssetType.OTHER }, admin);
        await assets.create({ name: 'Cable tray B', type: AssetType.OTHER, serialNumber: '' }, admin);
        expect(await Asset.countDocuments({ serialNumber: null })).toBe(2);
    });
});
describe('an employee sees only what they hold', () => {
    it('lists their own hardware and nothing else', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const grace = await makeUser('Grace Hopper', Role.EMPLOYEE);
        const alan = await makeUser('Alan Turing', Role.EMPLOYEE);
        const hers = await assets.create({ name: 'ThinkPad X1', type: AssetType.LAPTOP, assignedToId: grace._id.toString() }, admin);
        await assets.create({ name: 'MacBook Air', type: AssetType.LAPTOP, assignedToId: alan._id.toString() }, admin);
        await assets.create({ name: 'Spare monitor', type: AssetType.MONITOR }, admin);
        const graceSees = await assets.list(listQuery(), actorFor(grace));
        expect(graceSees.meta.total).toBe(1);
        expect(graceSees.items[0]?.id).toBe(hers.id);
        /* Three assets exist; the admin's view is the control. */
        const adminSees = await assets.list(listQuery(), admin);
        expect(adminSees.meta.total).toBe(3);
    });
    it("reports somebody else's asset as missing, not as forbidden", async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const grace = await makeUser('Grace Hopper', Role.EMPLOYEE);
        const alan = await makeUser('Alan Turing', Role.EMPLOYEE);
        const his = await assets.create({ name: 'MacBook Air', type: AssetType.LAPTOP, assignedToId: alan._id.toString() }, admin);
        /* 403 would confirm the asset exists, which is the fact being withheld. */
        await expect(assets.getById(his.id, actorFor(grace))).rejects.toMatchObject({
            statusCode: 404,
        });
    });
    it('cannot be widened with a forged assignedToId', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const grace = await makeUser('Grace Hopper', Role.EMPLOYEE);
        const alan = await makeUser('Alan Turing', Role.EMPLOYEE);
        await assets.create({ name: 'MacBook Air', type: AssetType.LAPTOP, assignedToId: alan._id.toString() }, admin);
        /* `$and` is what makes this narrow rather than overwrite: asking for Alan's kit as
         * Grace has to yield the intersection, which is empty. */
        const forged = await assets.list(listQuery({ assignedToId: alan._id.toString() }), actorFor(grace));
        expect(forged.meta.total).toBe(0);
        expect(forged.items).toHaveLength(0);
    });
    it('lets staff read the whole inventory', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const tech = actorFor(await makeUser('Alan Turing', Role.TECHNICIAN));
        const grace = await makeUser('Grace Hopper', Role.EMPLOYEE);
        const hers = await assets.create({ name: 'ThinkPad X1', type: AssetType.LAPTOP, assignedToId: grace._id.toString() }, admin);
        const seen = await assets.getById(hers.id, tech);
        expect(seen.assignedTo?.name).toBe('Grace Hopper');
    });
});
describe('retired hardware cannot also be issued', () => {
    it('releases the holder when the asset is retired', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const grace = await makeUser('Grace Hopper', Role.EMPLOYEE);
        const asset = await assets.create({
            name: 'ThinkPad X1',
            type: AssetType.LAPTOP,
            status: AssetStatus.IN_USE,
            assignedToId: grace._id.toString(),
        }, admin);
        expect(asset.assignedTo?.name).toBe('Grace Hopper');
        const retired = await assets.update(asset.id, { status: AssetStatus.RETIRED, version: asset.version }, admin);
        expect(retired.status).toBe(AssetStatus.RETIRED);
        expect(retired.assignedTo).toBeNull();
    });
    it('refuses to issue a retired asset, from either direction', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const grace = await makeUser('Grace Hopper', Role.EMPLOYEE);
        await expect(assets.create({
            name: 'Dead laptop',
            type: AssetType.LAPTOP,
            status: AssetStatus.RETIRED,
            assignedToId: grace._id.toString(),
        }, admin)).rejects.toMatchObject({ statusCode: 409 });
        const asset = await assets.create({ name: 'Old laptop', type: AssetType.LAPTOP }, admin);
        const retired = await assets.update(asset.id, { status: AssetStatus.RETIRED, version: asset.version }, admin);
        await expect(assets.update(asset.id, { assignedToId: grace._id.toString(), version: retired.version }, admin)).rejects.toMatchObject({ statusCode: 409 });
    });
    it('will not issue an asset to a deactivated or unknown person', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const gone = await makeUser('Grace Hopper', Role.EMPLOYEE);
        gone.status = UserStatus.INACTIVE;
        await gone.save();
        await expect(assets.create({ name: 'ThinkPad X1', type: AssetType.LAPTOP, assignedToId: gone._id.toString() }, admin)).rejects.toThrow(/cannot hold an asset/i);
    });
});
describe('concurrent edits and the warranty clock', () => {
    it('rejects a stale version', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        const asset = await assets.create({ name: 'ThinkPad X1', type: AssetType.LAPTOP }, admin);
        await assets.update(asset.id, { location: 'Floor 2', version: asset.version }, admin);
        /* The second editor loaded the form before the first saved. */
        await expect(assets.update(asset.id, { location: 'Floor 3', version: asset.version }, admin)).rejects.toMatchObject({ statusCode: 409 });
    });
    it('counts warranty days from the injected clock, going negative once expired', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        /* The clock reads 2026-01-05. */
        const covered = await assets.create({
            name: 'ThinkPad X1',
            type: AssetType.LAPTOP,
            warrantyExpiryDate: new Date('2026-01-15T09:00:00.000Z'),
        }, admin);
        expect(covered.warrantyDaysRemaining).toBe(10);
        const lapsed = await assets.create({
            name: 'Old desktop',
            type: AssetType.DESKTOP,
            warrantyExpiryDate: new Date('2025-12-31T09:00:00.000Z'),
        }, admin);
        expect(lapsed.warrantyDaysRemaining).toBe(-5);
        const noCover = await assets.create({ name: 'Cable tray', type: AssetType.OTHER }, admin);
        expect(noCover.warrantyDaysRemaining).toBeNull();
    });
    it('the radar finds expiring and expired kit, and skips assets with no warranty', async () => {
        const admin = actorFor(await makeUser('Ada Lovelace', Role.ADMIN));
        await assets.create({
            name: 'Expiring soon',
            type: AssetType.LAPTOP,
            warrantyExpiryDate: new Date('2026-01-20T09:00:00.000Z'),
        }, admin);
        await assets.create({
            name: 'Already lapsed',
            type: AssetType.DESKTOP,
            warrantyExpiryDate: new Date('2025-06-01T09:00:00.000Z'),
        }, admin);
        await assets.create({
            name: 'Covered for years',
            type: AssetType.SERVER,
            warrantyExpiryDate: new Date('2029-01-01T09:00:00.000Z'),
        }, admin);
        await assets.create({ name: 'No warranty recorded', type: AssetType.OTHER }, admin);
        const radar = await assets.list(listQuery({ warrantyWithinDays: 30, sortBy: 'warrantyExpiryDate' }), admin);
        expect(radar.items.map((row) => row.name)).toEqual(['Already lapsed', 'Expiring soon']);
        /* `warrantyWithinDays=0` means "already gone", not "everything". A null expiry
         * sorts below every date in Mongo and would match a bare `$lte`. */
        const expired = await assets.list(listQuery({ warrantyWithinDays: 0 }), admin);
        expect(expired.items.map((row) => row.name)).toEqual(['Already lapsed']);
    });
});
