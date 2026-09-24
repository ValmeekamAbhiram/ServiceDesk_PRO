/**
 * ServiceDesk Pro — ticket suggestions, end to end through the database.
 *
 * `suggestion.classifier.test.ts` already covers the scoring in isolation. What is
 * left to prove here is everything the classifier cannot know about:
 *
 *  - the candidate list is built from *active* categories in the admin's own
 *    `sortOrder`, since that order is what breaks a scoring tie,
 *  - related articles come from the knowledge base and only ever published ones,
 *  - `source` says `heuristic`, because that is what runs with no API key — and this
 *    suite must never reach the network,
 *  - nothing is written. A suggestion that quietly created a ticket, or filed one
 *    under a category the user never chose, would be the whole feature's failure.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ArticleStatus, Priority, Role, UserStatus } from '@shared/enums';
import { resolvePermissions } from '@/core/authz/permissions';
import { FixedClock } from '@/core/clock';
import { Category, KnowledgeArticle, SETTINGS_KEY, SystemSettings, Ticket, User } from '@/models';
import { clearDb, startDb, stopDb } from '@/test/db';
import { suggestTicket } from '@/modules/suggestions/suggestion.service';
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
async function employee() {
    const user = await User.create({
        name: 'Ed Employee',
        email: 'ed@example.com',
        passwordHash: 'not-used-here',
        role: Role.EMPLOYEE,
        status: UserStatus.ACTIVE,
    });
    return actorFor(user);
}
async function makeCategory(spec) {
    const created = await Category.create({
        name: spec.name,
        slug: spec.name.toLowerCase().replace(/\W+/g, '-'),
        keywords: spec.keywords ?? [],
        defaultPriority: spec.defaultPriority ?? Priority.MEDIUM,
        sortOrder: spec.sortOrder ?? 100,
        active: spec.active ?? true,
    });
    return created._id.toString();
}
async function makeArticle(title, status, body) {
    await KnowledgeArticle.create({
        title,
        slug: title.toLowerCase().replace(/\W+/g, '-'),
        summary: `How to deal with ${title}`,
        body,
        status,
        tags: ['howto'],
        authorId: (await User.findOne())?._id ?? undefined,
        ...(status === ArticleStatus.PUBLISHED ? { publishedAt: clock.now() } : {}),
    });
}
describe('suggesting from the configured categories', () => {
    it('suggests the matching category, its priority, and says the answer is offline', async () => {
        const actor = await employee();
        const networkId = await makeCategory({
            name: 'Network',
            keywords: ['vpn', 'wifi'],
            defaultPriority: Priority.HIGH,
            sortOrder: 1,
        });
        await makeCategory({ name: 'Hardware', keywords: ['laptop'], sortOrder: 2 });
        const suggestion = await suggestTicket(actor, {
            title: 'VPN drops every few minutes',
            description: 'It disconnects while I am on calls.',
        });
        expect(suggestion.categoryId).toBe(networkId);
        expect(suggestion.categoryName).toBe('Network');
        expect(suggestion.priority).toBe(Priority.HIGH);
        expect(suggestion.source).toBe('heuristic');
        expect(suggestion.confidence).toBeGreaterThan(0.5);
        expect(suggestion.confidence).toBeLessThanOrEqual(0.95);
        expect(suggestion.reason).toContain('Network');
    });
    it('never suggests an inactive category', async () => {
        const actor = await employee();
        await makeCategory({ name: 'Retired', keywords: ['vpn'], active: false });
        const suggestion = await suggestTicket(actor, { title: 'vpn is broken again' });
        expect(suggestion.categoryId).toBeNull();
        expect(suggestion.reason).toContain('a guess');
    });
    it('breaks a tie with the order an admin put the categories in', async () => {
        const actor = await employee();
        // Both own the keyword and both match the title, so only `sortOrder` separates
        // them — which is the reason `loadCandidates()` sorts at all.
        const first = await makeCategory({ name: 'Accounts', keywords: ['password'], sortOrder: 1 });
        await makeCategory({ name: 'Security', keywords: ['password'], sortOrder: 2 });
        expect((await suggestTicket(actor, { title: 'password reset' })).categoryId).toBe(first);
    });
    it('answers with no category rather than a wrong one on an empty install', async () => {
        const actor = await employee();
        const suggestion = await suggestTicket(actor, { title: 'The printer is on fire' });
        expect(suggestion.categoryId).toBeNull();
        expect(suggestion.priority).toBe(Priority.MEDIUM);
        expect(suggestion.confidence).toBe(0.2);
        expect(suggestion.relatedArticles).toEqual([]);
    });
});
describe('related articles', () => {
    it('offers published articles that match the words in the ticket', async () => {
        const actor = await employee();
        await makeCategory({ name: 'Network', keywords: ['vpn'] });
        await makeArticle('VPN setup', ArticleStatus.PUBLISHED, 'Install the vpn client, then sign in.');
        await makeArticle('Coffee machine', ArticleStatus.PUBLISHED, 'Descale it monthly.');
        const suggestion = await suggestTicket(actor, {
            title: 'Cannot start the vpn client',
            description: 'It fails at sign in.',
        });
        expect(suggestion.relatedArticles.map((hit) => hit.title)).toEqual(['VPN setup']);
        expect(suggestion.relatedArticles[0]?.slug).toBe('vpn-setup');
    });
    it('never offers a draft, however well it matches', async () => {
        const actor = await employee();
        await makeArticle('VPN setup', ArticleStatus.DRAFT, 'Install the vpn client, then sign in.');
        const suggestion = await suggestTicket(actor, { title: 'vpn client will not sign in' });
        expect(suggestion.relatedArticles).toEqual([]);
    });
    it('offers at most three, so the panel stays a panel', async () => {
        const actor = await employee();
        for (const n of [1, 2, 3, 4, 5]) {
            await makeArticle(`VPN note ${n}`, ArticleStatus.PUBLISHED, 'vpn vpn vpn troubleshooting');
        }
        const suggestion = await suggestTicket(actor, { title: 'vpn trouble' });
        expect(suggestion.relatedArticles).toHaveLength(3);
    });
    it('does not let a pasted bullet list negate the search', async () => {
        const actor = await employee();
        await makeArticle('Email setup', ArticleStatus.PUBLISHED, 'Configure your email client.');
        /*
         * A term starting with a hyphen is a Mongo exclusion, so the raw text below
         * would search for *client excluded* and confidently return nothing — the
         * article it should have found is the very one it rules out. Tight bullets
         * pasted from a mail client are how that reaches the server.
         */
        const suggestion = await suggestTicket(actor, {
            title: 'Email problems',
            description: '-client will not open\n-cannot send anything',
        });
        expect(suggestion.relatedArticles.map((hit) => hit.title)).toEqual(['Email setup']);
    });
});
describe('what a suggestion must never do', () => {
    it('writes nothing at all', async () => {
        const actor = await employee();
        await makeCategory({ name: 'Network', keywords: ['vpn'] });
        await suggestTicket(actor, { title: 'vpn is down', description: 'cannot work at all' });
        expect(await Ticket.countDocuments()).toBe(0);
        /* Not even a counter: the category's denormalised total belongs to real tickets. */
        expect((await Category.findOne({ name: 'Network' }))?.ticketCount).toBe(0);
    });
    it('refuses when an admin has switched suggestions off', async () => {
        const actor = await employee();
        await SystemSettings.create({ key: SETTINGS_KEY, aiSuggestionsEnabled: false });
        await expect(suggestTicket(actor, { title: 'vpn is down' })).rejects.toMatchObject({
            statusCode: 403,
        });
    });
    it('works again once it is switched back on', async () => {
        const actor = await employee();
        await SystemSettings.create({ key: SETTINGS_KEY, aiSuggestionsEnabled: true });
        const suggestion = await suggestTicket(actor, { title: 'anything at all' });
        expect(suggestion.source).toBe('heuristic');
    });
});
