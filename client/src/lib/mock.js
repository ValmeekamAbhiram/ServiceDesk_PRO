/**
 * ServiceDesk Pro — demo/fallback ITSM dataset.
 *
 * Used by the dashboard whenever the API returns nothing: first paint before
 * the query resolves, an empty tenant, or a failed request. Everyone named
 * here is fictional; ticket/asset/article numbers look real so empty states
 * still read like the product.
 */
import { Priority, Role, SlaState, TicketStatus } from '@shared/enums';
const HOUR = 3_600_000;
const now = Date.now();
const iso = (ts) => new Date(ts).toISOString();
export const MOCK_TECHS = [
    { id: 'u-rahul', name: 'Rahul Verma', email: 'rahul.verma@example.com', role: Role.TECHNICIAN },
    { id: 'u-arjun', name: 'Arjun Nair', email: 'arjun.nair@example.com', role: Role.TECHNICIAN },
    { id: 'u-priya', name: 'Priya Iyer', email: 'priya.iyer@example.com', role: Role.TECHNICIAN },
    { id: 'u-aman', name: 'Aman Gupta', email: 'aman.gupta@example.com', role: Role.TECHNICIAN },
];
const requester = (id, name) => ({
    id,
    name,
    email: `${id}@example.com`,
    role: Role.EMPLOYEE,
});
function ticket(id, number, title, status, priority, category, requesterName, assignee, createdHoursAgo, resolutionRemainingMs, breached, comments) {
    const created = now - createdHoursAgo * HOUR;
    const atRisk = resolutionRemainingMs !== null && resolutionRemainingMs < 2 * HOUR && !breached;
    return {
        id,
        number,
        title,
        status,
        priority,
        category: { id: `cat-${category.toLowerCase()}`, label: category },
        requester: requester(`u-${requesterName.toLowerCase().replace(/[^a-z]+/g, '-')}`, requesterName),
        assignee,
        sla: {
            policyName: priority === Priority.URGENT ? 'Critical - 4h' : 'Standard - 8x5',
            response: {
                state: SlaState.MET,
                dueAt: iso(created + 1 * HOUR),
                metAt: iso(created + 20 * 60_000),
                remainingMs: null,
                percentUsed: 32,
                budgetMinutes: 60,
            },
            resolution: {
                state: breached ? SlaState.BREACHED : atRisk ? SlaState.AT_RISK : SlaState.ON_TRACK,
                dueAt: resolutionRemainingMs === null ? null : iso(now + resolutionRemainingMs),
                metAt: null,
                remainingMs: resolutionRemainingMs,
                percentUsed: breached ? 118 : 64,
                budgetMinutes: 480,
            },
            breached,
        },
        commentCount: comments,
        attachmentCount: number === 'TKT-1042' ? 2 : 0,
        createdAt: iso(created),
        updatedAt: iso(now - 25 * 60_000),
    };
}
export const MOCK_TICKETS = [
    ticket('t-1042', 'TKT-1042', 'VPN drops every 20 minutes on WFH setup', TicketStatus.IN_PROGRESS, Priority.HIGH, 'Network', 'Kavya Menon', MOCK_TECHS[0], 26, 3 * HOUR, false, 6),
    ticket('t-1038', 'TKT-1038', 'Laptop will not boot past BitLocker screen', TicketStatus.OPEN, Priority.URGENT, 'Hardware', 'Dev Patel', MOCK_TECHS[1], 9, -45 * 60_000, true, 3),
    ticket('t-1035', 'TKT-1035', 'Shared mailbox permissions for Finance onboarding', TicketStatus.ON_HOLD, Priority.MEDIUM, 'Access', 'Sara Thomas', MOCK_TECHS[2], 49, 30 * HOUR, false, 4),
    ticket('t-1031', 'TKT-1031', 'Printer pool on Floor 2 spooling forever', TicketStatus.OPEN, Priority.LOW, 'Hardware', 'Rohan Dsouza', null, 74, 90 * HOUR, false, 1),
    ticket('t-1027', 'TKT-1027', 'SSO loop on the expense portal after password reset', TicketStatus.IN_PROGRESS, Priority.HIGH, 'Access', 'Anita Rao', MOCK_TECHS[3], 31, 90 * 60_000, false, 8),
];
export const MOCK_KPIS = [
    { label: 'Open tickets', value: 128, changePercent: -6.2, higherIsBetter: false, format: 'number' },
    { label: 'SLA compliance', value: 96.4, changePercent: 1.1, higherIsBetter: true, format: 'percent' },
    { label: 'Active incidents', value: 3, changePercent: -25, higherIsBetter: false, format: 'number' },
    { label: 'KB deflection', value: 31, changePercent: 4.6, higherIsBetter: true, format: 'percent' },
];
/** Deterministic 90-day created/resolved series (seeded wave, no randomness). */
function buildVolume(days) {
    const points = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const wave = Math.sin((days - i) / 5.3) * 4 + Math.cos((days - i) / 11.7) * 3;
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const base = weekend ? 4 : 14;
        const created = Math.max(1, Math.round(base + wave));
        const resolved = Math.max(1, Math.round(base + wave * 0.8 + (i % 3 === 0 ? -2 : 1)));
        points.push({ date: d.toISOString().slice(0, 10), created, resolved });
    }
    return points;
}
export const MOCK_VOLUME_90 = buildVolume(90);
export const MOCK_BY_STATUS = [
    { key: TicketStatus.OPEN, label: 'Open', count: 46 },
    { key: TicketStatus.IN_PROGRESS, label: 'In progress', count: 52 },
    { key: TicketStatus.ON_HOLD, label: 'On hold', count: 30 },
];
export const MOCK_BY_PRIORITY = [
    { key: Priority.URGENT, label: 'Urgent', count: 9 },
    { key: Priority.HIGH, label: 'High', count: 34 },
    { key: Priority.MEDIUM, label: 'Medium', count: 51 },
    { key: Priority.LOW, label: 'Low', count: 34 },
];
export const MOCK_BY_CATEGORY = [
    { key: 'network', label: 'Network', count: 32 },
    { key: 'hardware', label: 'Hardware', count: 28 },
    { key: 'access', label: 'Access', count: 24 },
    { key: 'software', label: 'Software', count: 19 },
];
export const MOCK_TECH_LOAD = [
    { technician: MOCK_TECHS[0], open: 18, resolvedLast7Days: 22, breached: 0, avgResolutionHours: 5.4 },
    { technician: MOCK_TECHS[1], open: 14, resolvedLast7Days: 19, breached: 1, avgResolutionHours: 7.1 },
    { technician: MOCK_TECHS[2], open: 11, resolvedLast7Days: 25, breached: 0, avgResolutionHours: 4.2 },
    { technician: MOCK_TECHS[3], open: 9, resolvedLast7Days: 16, breached: 0, avgResolutionHours: 6.8 },
];
export const MOCK_DASHBOARD = {
    kpis: MOCK_KPIS,
    byStatus: MOCK_BY_STATUS,
    byPriority: MOCK_BY_PRIORITY,
    byCategory: MOCK_BY_CATEGORY,
    volume: MOCK_VOLUME_90,
    technicianLoad: MOCK_TECH_LOAD,
    atRisk: MOCK_TICKETS.slice(0, 3),
};
/** Mon-Sun bars for the "Ticket Volume" week chart. */
export const MOCK_WEEK_VOLUME = [
    { day: 'Mon', created: 22, resolved: 18 },
    { day: 'Tue', created: 26, resolved: 21 },
    { day: 'Wed', created: 19, resolved: 23 },
    { day: 'Thu', created: 28, resolved: 24 },
    { day: 'Fri', created: 24, resolved: 26 },
    { day: 'Sat', created: 6, resolved: 8 },
    { day: 'Sun', created: 4, resolved: 5 },
];
export const MOCK_AGING = [
    { label: 'Fresh', range: '0-4 h', count: 42, to: '/tickets', tone: 'ok' },
    { label: 'Working', range: '4-24 h', count: 51, to: '/tickets', tone: 'ok' },
    { label: 'Aging', range: '1-3 d', count: 23, to: '/tickets?sortBy=dueAt', tone: 'warn' },
    { label: 'Stale', range: '3 d+', count: 12, to: '/tickets?breached=true', tone: 'bad' },
];
export const MOCK_CRITICAL_INCIDENT = {
    id: 'INC-004',
    title: 'Core switch failure - Floor 3',
    severity: 'SEV 1',
    startedAgo: '48 min ago',
    affected: ['Wired LAN Floor 3', 'Meeting-room AV', 'Door access panels'],
    commander: 'Arjun Nair',
    updates: 7,
};
export const MOCK_ACTIVITY = [
    { id: 'a1', actor: 'Priya Iyer', text: 'resolved TKT-1039 (password vault sync)', minutesAgo: 4 },
    { id: 'a2', actor: 'Arjun Nair', text: 'escalated TKT-1038 to network on-call', minutesAgo: 11 },
    { id: 'a3', actor: 'Aman Gupta', text: 'requested approval on TKT-1035', minutesAgo: 19 },
    { id: 'a4', actor: 'Rahul Verma', text: 'picked up TKT-1042 from the queue', minutesAgo: 33 },
    { id: 'a5', actor: 'System', text: 'SLA policy Standard 8x5 republished', minutesAgo: 52 },
];
export const MOCK_ARTICLES = [
    { id: 'kb-102', number: 'KB-102', title: 'Fix VPN drops on home routers (MTU 1300)', views: 1840 },
    { id: 'kb-118', number: 'KB-118', title: 'BitLocker recovery: find your 48-digit key', views: 1217 },
];
export const MOCK_ASSET = {
    id: 'a-lap1029',
    tag: 'LAP-1029',
    model: 'ThinkPad T14 Gen 4 - 16 GB / 512 GB',
    holder: 'Kavya Menon',
    warranty: '214 days left',
};
export const MOCK_AI_OPS = {
    deflectionRate: 31,
    suggestionsToday: 46,
    acceptanceRate: 72,
    topSuggestion: 'Suggest KB-102 on TKT-1042 ("VPN drops") - 94% match',
};
