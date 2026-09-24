/**
 * Business-hours arithmetic.
 *
 * Every instant is written as an `Asia/Kolkata` wall clock and compared back in the
 * same terms, because that is how the requirement is stated ("due by 16:00 on
 * Wednesday") and it makes a failure readable at a glance. Kolkata is UTC+05:30 with
 * no DST, so the `+05:30` suffix is exact; the DST cases use New York deliberately.
 *
 * Nothing here reads the host's timezone, so the suite passes with `TZ` set to
 * anything — which is the property that matters, since CI and a laptop rarely agree.
 */
import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, businessDateKey, businessMinutesBetween, formatBusinessWindow, isWithinBusinessHours, minutesPerBusinessDay, minutesPerBusinessWeek, msUntilBusinessHours, nextBusinessStart, normalizeBusinessHours, recentBusinessDays, } from '@/core/sla/business-hours';
/** Mon–Fri, 09:00–18:00 IST. Nine-hour days, 540 business minutes each. */
const IST = {
    timezone: 'Asia/Kolkata',
    startMinute: 540,
    endMinute: 1080,
    workingDays: [1, 2, 3, 4, 5],
};
/** `'2026-01-05T09:00'` → the instant Kolkata reads as that wall clock. */
function ist(wallClock) {
    return new Date(`${wallClock}:00+05:30`);
}
/** The inverse, in exactly the input format — so assertion failures are legible. */
function istLabel(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(date);
    const at = (type) => parts.find((part) => part.type === type)?.value ?? '??';
    return `${at('year')}-${at('month')}-${at('day')}T${at('hour')}:${at('minute')}`;
}
// 2026-01-05 is a Monday; 01-09 Friday, 01-10 Saturday, 01-11 Sunday, 01-12 Monday.
const MON_09_00 = '2026-01-05T09:00';
const FRI_17_00 = '2026-01-09T17:00';
const SAT_12_00 = '2026-01-10T12:00';
describe('isWithinBusinessHours', () => {
    it('is open inside the window on a working day', () => {
        expect(isWithinBusinessHours(ist('2026-01-05T10:30'), IST)).toBe(true);
    });
    it('is shut before the opening bell and at the closing bell', () => {
        expect(isWithinBusinessHours(ist('2026-01-05T08:59'), IST)).toBe(false);
        expect(isWithinBusinessHours(ist(MON_09_00), IST)).toBe(true);
        expect(isWithinBusinessHours(ist('2026-01-05T17:59'), IST)).toBe(true);
        // The closing bell is exclusive: 18:00 is the first shut minute.
        expect(isWithinBusinessHours(ist('2026-01-05T18:00'), IST)).toBe(false);
    });
    it('is shut all weekend', () => {
        expect(isWithinBusinessHours(ist(SAT_12_00), IST)).toBe(false);
        expect(isWithinBusinessHours(ist('2026-01-11T12:00'), IST)).toBe(false);
    });
    it('reads the business timezone, not the host', () => {
        // 04:00 UTC is 09:30 in Kolkata — open — and nowhere near open in UTC.
        const instant = new Date('2026-01-05T04:00:00Z');
        expect(isWithinBusinessHours(instant, IST)).toBe(true);
        expect(isWithinBusinessHours(instant, { ...IST, timezone: 'UTC' })).toBe(false);
    });
});
describe('nextBusinessStart', () => {
    it('returns the instant unchanged when the desk is open', () => {
        expect(istLabel(nextBusinessStart(ist('2026-01-05T10:30'), IST))).toBe('2026-01-05T10:30');
    });
    it('jumps forward to the opening bell', () => {
        expect(istLabel(nextBusinessStart(ist('2026-01-05T02:00'), IST))).toBe(MON_09_00);
    });
    it('skips the weekend', () => {
        expect(istLabel(nextBusinessStart(ist(SAT_12_00), IST))).toBe('2026-01-12T09:00');
        expect(istLabel(nextBusinessStart(ist('2026-01-09T21:00'), IST))).toBe('2026-01-12T09:00');
    });
});
describe('msUntilBusinessHours', () => {
    it('is zero while the desk is open', () => {
        expect(msUntilBusinessHours(ist('2026-01-05T10:00'), IST)).toBe(0);
    });
    it('counts wall-clock time to the next opening bell', () => {
        // Friday 21:00 → Monday 09:00 is 60 hours of wall clock.
        expect(msUntilBusinessHours(ist('2026-01-09T21:00'), IST)).toBe(60 * 60 * 60 * 1000);
    });
});
describe('addBusinessMinutes', () => {
    it('stays inside one day when there is room', () => {
        expect(istLabel(addBusinessMinutes(ist('2026-01-05T10:00'), 60, IST))).toBe('2026-01-05T11:00');
    });
    it('carries the remainder into the next working day', () => {
        // 30 minutes left on Monday, so the other 30 land after Tuesday's opening bell.
        expect(istLabel(addBusinessMinutes(ist('2026-01-05T17:30'), 60, IST))).toBe('2026-01-06T09:30');
    });
    it('starts counting at the opening bell for a ticket raised overnight', () => {
        expect(istLabel(addBusinessMinutes(ist('2026-01-05T02:00'), 60, IST))).toBe('2026-01-05T10:00');
    });
    it('lands exactly on the closing bell for a full day of budget', () => {
        expect(istLabel(addBusinessMinutes(ist(MON_09_00), 540, IST))).toBe('2026-01-05T18:00');
    });
    it('skips the weekend', () => {
        // Friday 17:00 + 2 h: one hour on Friday, one after Monday opens.
        expect(istLabel(addBusinessMinutes(ist(FRI_17_00), 120, IST))).toBe('2026-01-12T10:00');
        expect(istLabel(addBusinessMinutes(ist(SAT_12_00), 15, IST))).toBe('2026-01-12T09:15');
    });
    it('spans multiple days for a long budget', () => {
        // 1440 business minutes = 540 Mon + 540 Tue + 360 Wed.
        expect(istLabel(addBusinessMinutes(ist(MON_09_00), 1440, IST))).toBe('2026-01-07T15:00');
        // LOW resolution: 2880 minutes from Friday evening lands the Monday after next.
        expect(istLabel(addBusinessMinutes(ist(FRI_17_00), 2880, IST))).toBe('2026-01-19T11:00');
    });
    it('returns the instant untouched for a non-positive budget', () => {
        const from = ist(SAT_12_00);
        expect(addBusinessMinutes(from, 0, IST).getTime()).toBe(from.getTime());
        expect(addBusinessMinutes(from, -30, IST).getTime()).toBe(from.getTime());
    });
    it('refuses a budget larger than the calendar it is asked to scan', () => {
        expect(() => addBusinessMinutes(ist(MON_09_00), 90_000_000, IST)).toThrow(/exceeds .* days of the configured calendar/);
    });
});
describe('businessMinutesBetween', () => {
    it('measures a span inside one day', () => {
        expect(businessMinutesBetween(ist('2026-01-05T10:00'), ist('2026-01-05T11:30'), IST)).toBe(90);
    });
    it('counts only the open hours of a span that crosses the night', () => {
        expect(businessMinutesBetween(ist(FRI_17_00), ist('2026-01-12T10:00'), IST)).toBe(120);
    });
    it('is zero across a closed weekend', () => {
        expect(businessMinutesBetween(ist(SAT_12_00), ist('2026-01-11T12:00'), IST)).toBe(0);
    });
    it('is zero before the desk opens', () => {
        expect(businessMinutesBetween(ist('2026-01-05T02:00'), ist(MON_09_00), IST)).toBe(0);
    });
    it('is zero when the span runs backwards or is empty', () => {
        expect(businessMinutesBetween(ist('2026-01-05T11:00'), ist('2026-01-05T10:00'), IST)).toBe(0);
        expect(businessMinutesBetween(ist('2026-01-05T11:00'), ist('2026-01-05T11:00'), IST)).toBe(0);
    });
    it('accumulates whole days', () => {
        expect(businessMinutesBetween(ist(MON_09_00), ist('2026-01-07T15:00'), IST)).toBe(1440);
    });
    it('keeps sub-minute precision', () => {
        const from = ist('2026-01-05T10:00');
        expect(businessMinutesBetween(from, new Date(from.getTime() + 90_000), IST)).toBe(1.5);
    });
    it('inverts addBusinessMinutes for every start and budget', () => {
        const starts = [
            '2026-01-05T02:00', // before opening
            '2026-01-05T09:00', // on the bell
            '2026-01-05T13:37', // mid-afternoon
            '2026-01-09T17:45', // Friday, minutes before closing
            '2026-01-10T12:00', // Saturday
        ];
        const budgets = [1, 15, 60, 240, 480, 540, 541, 1440, 2880];
        for (const start of starts) {
            for (const budget of budgets) {
                const from = ist(start);
                const due = addBusinessMinutes(from, budget, IST);
                expect(businessMinutesBetween(from, due, IST)).toBeCloseTo(budget, 6);
            }
        }
    });
});
describe('daylight saving', () => {
    /** New York, Mon–Fri 09:00–17:00. DST began Sunday 9 March 2025. */
    const NY = {
        timezone: 'America/New_York',
        startMinute: 540,
        endMinute: 1020,
        workingDays: [1, 2, 3, 4, 5],
    };
    it('lands on the right wall clock across a spring-forward weekend', () => {
        // Friday 16:00 EST (UTC-5) + 2 h of business time: one hour Friday, one hour
        // after Monday's bell — by which time the offset is EDT (UTC-4).
        const from = new Date('2025-03-07T21:00:00Z');
        expect(addBusinessMinutes(from, 120, NY).toISOString()).toBe('2025-03-10T14:00:00.000Z');
    });
    it('does not leak the lost hour into business minutes', () => {
        // Ten working days, 480 minutes each — the 23-hour Sunday changes nothing.
        const from = new Date('2025-03-03T14:00:00Z'); // Mon 09:00 EST
        const to = new Date('2025-03-14T21:00:00Z'); //  Fri 17:00 EDT
        expect(businessMinutesBetween(from, to, NY)).toBe(4800);
    });
    it('still inverts addBusinessMinutes across the transition', () => {
        const from = new Date('2025-03-07T21:00:00Z');
        for (const budget of [30, 120, 480, 960, 2400]) {
            const due = addBusinessMinutes(from, budget, NY);
            expect(businessMinutesBetween(from, due, NY)).toBeCloseTo(budget, 6);
        }
    });
});
describe('normalizeBusinessHours', () => {
    it('leaves a sane config alone', () => {
        expect(normalizeBusinessHours(IST)).toEqual(IST);
    });
    it('repairs a window that ends before it starts', () => {
        const repaired = normalizeBusinessHours({ ...IST, startMinute: 1080, endMinute: 540 });
        expect(repaired.endMinute).toBeGreaterThan(repaired.startMinute);
    });
    it('falls back to Mon–Fri when no working days survive', () => {
        expect(normalizeBusinessHours({ ...IST, workingDays: [] }).workingDays).toEqual([1, 2, 3, 4, 5]);
        expect(normalizeBusinessHours({ ...IST, workingDays: [9, -1] }).workingDays).toEqual([
            1, 2, 3, 4, 5,
        ]);
    });
    it('de-duplicates and sorts working days', () => {
        expect(normalizeBusinessHours({ ...IST, workingDays: [5, 1, 5, 3] }).workingDays).toEqual([
            1, 3, 5,
        ]);
    });
    it('degrades an unknown timezone to UTC instead of throwing', () => {
        const broken = { ...IST, timezone: 'Mars/Olympus_Mons' };
        expect(() => isWithinBusinessHours(ist('2026-01-05T10:00'), broken)).not.toThrow();
        // 10:00 IST is 04:30 UTC, before a UTC-based 09:00 opening.
        expect(isWithinBusinessHours(ist('2026-01-05T10:00'), broken)).toBe(false);
    });
});
describe('window descriptions', () => {
    it('sizes a day and a week', () => {
        expect(minutesPerBusinessDay(IST)).toBe(540);
        expect(minutesPerBusinessWeek(IST)).toBe(2700);
    });
    it('renders the window for the settings screen', () => {
        expect(formatBusinessWindow(IST)).toBe('09:00–18:00 Asia/Kolkata');
    });
});
describe('calendar days for charts', () => {
    it('files an instant under the business day it belongs to, not the UTC one', () => {
        // 01:30 Tuesday in Kolkata is still Monday evening in UTC. A chart bucketed on
        // UTC would put this in the column before the one its reader is looking for.
        expect(businessDateKey(ist('2026-03-10T01:30'), IST)).toBe('2026-03-10');
        expect(ist('2026-03-10T01:30').toISOString()).toBe('2026-03-09T20:00:00.000Z');
    });
    it('files a New York evening under that evening, not tomorrow', () => {
        // The same mistake with the offset reversed: 19:30 EDT has already ticked over
        // to the 10th in UTC.
        const NY = { ...IST, timezone: 'America/New_York' };
        expect(businessDateKey(new Date('2026-03-10T00:30:00Z'), NY)).toBe('2026-03-09');
    });
    it('returns the window oldest-first, ending today, starting at local midnight', () => {
        const { keys, from } = recentBusinessDays(ist('2026-03-10T16:30'), 14, IST);
        expect(keys).toHaveLength(14);
        expect(keys[0]).toBe('2026-02-25');
        expect(keys.at(-1)).toBe('2026-03-10');
        expect(istLabel(from)).toBe('2026-02-25T00:00');
    });
    it('walks back over a year boundary', () => {
        const { keys } = recentBusinessDays(ist('2026-01-02T10:00'), 5, IST);
        expect(keys).toEqual(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    });
    it('neither repeats nor skips a column across spring-forward', () => {
        // 14 days ending Tuesday 10 March 2026 spans Sunday the 8th, when New York
        // loses an hour. Stepping a calendar rather than subtracting 24 h is what keeps
        // the count right; the oracle is the same span walked in UTC, where DST cannot
        // interfere.
        const NY = { ...IST, timezone: 'America/New_York' };
        const { keys } = recentBusinessDays(new Date('2026-03-10T20:30:00Z'), 14, NY);
        const expected = Array.from({ length: 14 }, (_, i) => {
            const day = new Date(Date.UTC(2026, 1, 25) + i * 86_400_000);
            return day.toISOString().slice(0, 10);
        });
        expect(keys).toEqual(expected);
        expect(new Set(keys).size).toBe(14);
    });
    it('always returns at least one column, however small the request', () => {
        for (const days of [1, 0, -5, 0.5]) {
            expect(recentBusinessDays(ist('2026-03-10T16:30'), days, IST).keys).toEqual(['2026-03-10']);
        }
    });
    it('caps a request that would scan a decade', () => {
        const { keys } = recentBusinessDays(ist('2026-03-10T16:30'), 999_999, IST);
        expect(keys).toHaveLength(3660);
        expect(keys.at(-1)).toBe('2026-03-10');
    });
});
