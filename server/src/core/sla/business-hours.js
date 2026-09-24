/**
 * ServiceDesk Pro — business-hours arithmetic (pure).
 *
 * An SLA budget of "480 minutes" means eight *working* hours. A ticket raised at
 * 17:00 on a Friday, on a Mon–Fri 09:00–18:00 calendar, is due at 16:00 the
 * following Tuesday — not at 01:00 on Saturday when nobody is reading it. This
 * module is the arithmetic that makes that true, and it is the only place in the
 * codebase that knows what a working day is.
 *
 * ## Three primitives, everything else builds on them
 *
 *  - `isWithinBusinessHours(instant)` — is the desk open right now?
 *  - `addBusinessMinutes(from, n)` — the instant `n` business minutes after `from`.
 *  - `businessMinutesBetween(from, to)` — how many business minutes that span holds.
 *
 * `addBusinessMinutes` and `businessMinutesBetween` are inverses on business time,
 * which is what lets the SLA engine derive "budget consumed" from nothing but the
 * stored deadline and the current clock — no separate start timestamp to keep in
 * step. See `engine.ts`.
 *
 * ## Timezones without a date library
 *
 * Business hours belong to the *business*, not to the server or the viewer, so all
 * of this happens in an IANA zone (`Asia/Kolkata` by default) regardless of the
 * host's `TZ`. `Intl.DateTimeFormat` is the whole timezone database and it ships
 * with Node, so the two conversions we need — instant → local wall clock, and
 * local wall clock → instant — are built on it rather than on a dependency.
 *
 * The one known limitation: a wall-clock time inside a spring-forward gap (a local
 * time that does not exist) resolves to the instant just after the jump. A 09:00
 * opening bell has never landed in a DST gap in any zone this would plausibly run
 * in, and the effect would be a one-hour skew on one day a year rather than a
 * wrong answer, so it is documented instead of solved.
 *
 * Pure module: no Express, no Mongoose, no config, no `Date.now()`. Every function
 * is a total function of its arguments, which is what makes the test suite able to
 * assert exact instants.
 */
import { MINUTE_MS } from '@shared/utils';
const MINUTES_PER_DAY = 1440;
/**
 * Ten years of calendar days. Reached only by a policy with an absurd budget — a
 * bug rather than a use case — and a bounded scan is better than a hung request.
 */
const MAX_DAYS_SCANNED = 3660;
export const DEFAULT_BUSINESS_HOURS = {
    timezone: 'Asia/Kolkata',
    startMinute: 540,
    endMinute: 1080,
    workingDays: [1, 2, 3, 4, 5],
};
/**
 * Clamp a possibly-broken configuration into one the maths cannot trip over.
 *
 * The policy schema validates on `save()`, which does not help if a document was
 * edited straight in the database or seeded by an older build. A window that ends
 * before it starts, or a working week with no days in it, would make
 * `addBusinessMinutes` scan for minutes that do not exist and then throw — so both
 * are repaired here, once, at the entry to every public function.
 */
export function normalizeBusinessHours(hours) {
    const startMinute = clampMinute(hours.startMinute, DEFAULT_BUSINESS_HOURS.startMinute, 0, 1439);
    const rawEnd = clampMinute(hours.endMinute, DEFAULT_BUSINESS_HOURS.endMinute, 1, MINUTES_PER_DAY);
    const endMinute = rawEnd > startMinute ? rawEnd : Math.min(startMinute + 60, MINUTES_PER_DAY);
    const workingDays = Array.from(new Set((hours.workingDays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b);
    return {
        timezone: hours.timezone || DEFAULT_BUSINESS_HOURS.timezone,
        startMinute,
        endMinute,
        workingDays: workingDays.length > 0 ? workingDays : DEFAULT_BUSINESS_HOURS.workingDays,
    };
}
function clampMinute(value, fallback, min, max) {
    if (!Number.isFinite(value))
        return fallback;
    return Math.min(Math.max(Math.floor(value), min), max);
}
/** Business minutes in one full working day. */
export function minutesPerBusinessDay(hours) {
    const safe = normalizeBusinessHours(hours);
    return safe.endMinute - safe.startMinute;
}
/** Business minutes in a full working week — used by the dashboard's copy. */
export function minutesPerBusinessWeek(hours) {
    const safe = normalizeBusinessHours(hours);
    return (safe.endMinute - safe.startMinute) * safe.workingDays.length;
}
const formatters = new Map();
/**
 * Formatters are expensive to construct and are built per timezone, so they are
 * cached. An unknown zone name throws on construction; rather than let a typo in
 * the policy take the SLA engine down, it degrades to UTC and caches that.
 */
function formatterFor(timezone) {
    const cached = formatters.get(timezone);
    if (cached)
        return cached;
    let formatter;
    try {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }
    catch {
        formatter = formatterFor('UTC');
    }
    formatters.set(timezone, formatter);
    return formatter;
}
/** Read the wall-clock fields an observer in `timezone` would see at `instant`. */
function wallClockOf(instant, timezone) {
    const parts = formatterFor(timezone).formatToParts(instant);
    const field = (type) => {
        const part = parts.find((candidate) => candidate.type === type);
        return part ? Number(part.value) : 0;
    };
    return {
        year: field('year'),
        month: field('month'),
        day: field('day'),
        // `hourCycle: 'h23'` keeps midnight at 0 rather than the 24 some engines emit.
        hour: field('hour') % 24,
        minute: field('minute'),
        second: field('second'),
    };
}
/**
 * The zone's offset from UTC at `instant`, in milliseconds east. The trick: format
 * the instant into the zone's wall clock, then read those fields back *as if* they
 * were UTC. The difference between that and the real instant is the offset — which
 * is how one `Intl` formatter stands in for a timezone database.
 */
function zoneOffsetMs(instant, timezone) {
    const wall = wallClockOf(instant, timezone);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    // Offsets are whole minutes, so comparing at second precision is exact.
    return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
/**
 * The inverse: the instant at which the business timezone reads `date` at
 * `minuteOfDay`. Two passes, because the offset we need is the one in force at the
 * *answer*, not at the guess — they differ either side of a DST change.
 *
 * `minuteOfDay` may be 1440 (midnight at the end of the day); `Date.UTC` rolls the
 * overflow into the next date for us.
 */
function instantAtZoned(date, minuteOfDay, timezone) {
    const wallMs = Date.UTC(date.year, date.month - 1, date.day) + minuteOfDay * MINUTE_MS;
    const firstGuess = zoneOffsetMs(new Date(wallMs), timezone);
    let ms = wallMs - firstGuess;
    const corrected = zoneOffsetMs(new Date(ms), timezone);
    if (corrected !== firstGuess)
        ms = wallMs - corrected;
    return new Date(ms);
}
/* ──────────────────────────── the working calendar ─────────────────────────── */
function calendarDateOf(instant, timezone) {
    const wall = wallClockOf(instant, timezone);
    return { year: wall.year, month: wall.month, day: wall.day };
}
/** Comparable key, so "is this date past that one" is an integer comparison. */
function dayKey(date) {
    return date.year * 10_000 + date.month * 100 + date.day;
}
function nextCalendarDay(date) {
    // Month and year rollover, leap years included, courtesy of Date.UTC.
    const rolled = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
    return {
        year: rolled.getUTCFullYear(),
        month: rolled.getUTCMonth() + 1,
        day: rolled.getUTCDate(),
    };
}
/** 0 = Sunday … 6 = Saturday. Independent of any timezone: it is a calendar fact. */
function weekdayOf(date) {
    return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}
function windowOn(date, hours) {
    if (!hours.workingDays.includes(weekdayOf(date)))
        return null;
    return {
        opensAt: instantAtZoned(date, hours.startMinute, hours.timezone).getTime(),
        closesAt: instantAtZoned(date, hours.endMinute, hours.timezone).getTime(),
    };
}
/* ──────────────────────────────── public API ──────────────────────────────── */
/** True when `instant` falls inside a working day's window. The closing bell is out. */
export function isWithinBusinessHours(instant, hours) {
    const safe = normalizeBusinessHours(hours);
    const window = windowOn(calendarDateOf(instant, safe.timezone), safe);
    if (!window)
        return false;
    const ms = instant.getTime();
    return ms >= window.opensAt && ms < window.closesAt;
}
/**
 * `instant` if the desk is already open, otherwise the next opening bell. This is
 * where the SLA clock starts for a ticket raised at 22:00 — the budget begins
 * ticking at 09:00, because nobody was going to answer it at 22:00.
 */
export function nextBusinessStart(instant, hours) {
    const safe = normalizeBusinessHours(hours);
    const ms = instant.getTime();
    let date = calendarDateOf(instant, safe.timezone);
    for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
        const window = windowOn(date, safe);
        if (window && ms < window.closesAt) {
            return ms >= window.opensAt ? new Date(ms) : new Date(window.opensAt);
        }
        date = nextCalendarDay(date);
    }
    // Unreachable for any config `normalizeBusinessHours` can produce.
    return new Date(ms);
}
/**
 * The instant `minutes` business minutes after `from`.
 *
 * `from` need not be inside business hours; it is advanced to the next opening bell
 * first, so a ticket raised at 02:00 gets the same deadline as one raised at 09:00
 * the same morning. Non-positive budgets return `from` untouched.
 *
 * Throws only on a configuration whose budget exceeds ten years of working days,
 * which is a broken policy rather than a slow one — the SLA monitor wraps its sweep
 * so one bad ticket cannot stop the others.
 */
export function addBusinessMinutes(from, minutes, hours) {
    if (!Number.isFinite(minutes) || minutes <= 0)
        return new Date(from.getTime());
    const safe = normalizeBusinessHours(hours);
    let remaining = minutes;
    let cursorMs = from.getTime();
    let date = calendarDateOf(from, safe.timezone);
    for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
        const window = windowOn(date, safe);
        if (window && cursorMs < window.closesAt) {
            // Late in a day we start where we are; on every later day, at the opening bell.
            const position = Math.max(cursorMs, window.opensAt);
            const available = (window.closesAt - position) / MINUTE_MS;
            if (remaining <= available)
                return new Date(position + remaining * MINUTE_MS);
            remaining -= available;
        }
        date = nextCalendarDay(date);
        cursorMs = Number.NEGATIVE_INFINITY;
    }
    throw new Error(`addBusinessMinutes: ${minutes} business minutes exceeds ${MAX_DAYS_SCANNED} days of the configured calendar.`);
}
/**
 * Business minutes contained in `[from, to)`. Zero when `to` is at or before `from`
 * — the caller decides what a negative span means, and for SLA purposes it is the
 * overrun, measured by swapping the arguments.
 *
 * Fractional, because instants are not minute-aligned: a span of 90 seconds of
 * business time is 1.5, not 1 or 2. The engine rounds only when it renders.
 */
export function businessMinutesBetween(from, to, hours) {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    if (toMs <= fromMs)
        return 0;
    const safe = normalizeBusinessHours(hours);
    const lastKey = dayKey(calendarDateOf(to, safe.timezone));
    let date = calendarDateOf(from, safe.timezone);
    let total = 0;
    // A window never crosses midnight in its own zone, so every window overlapping
    // the span belongs to a calendar date between `from`'s and `to`'s, inclusive.
    for (let scanned = 0; scanned < MAX_DAYS_SCANNED && dayKey(date) <= lastKey; scanned += 1) {
        const window = windowOn(date, safe);
        if (window) {
            const start = Math.max(window.opensAt, fromMs);
            const end = Math.min(window.closesAt, toMs);
            if (end > start)
                total += (end - start) / MINUTE_MS;
        }
        date = nextCalendarDay(date);
    }
    return total;
}
/**
 * Wall-clock milliseconds until the desk next opens, or 0 if it is open. Lets the
 * UI say "SLA clock resumes in 3 h" instead of showing a countdown that appears
 * frozen overnight.
 */
export function msUntilBusinessHours(instant, hours) {
    if (isWithinBusinessHours(instant, hours))
        return 0;
    return Math.max(0, nextBusinessStart(instant, hours).getTime() - instant.getTime());
}
/** `540` → `"09:00"`, in the business timezone's own terms. Display only. */
export function formatBusinessWindow(hours) {
    const safe = normalizeBusinessHours(hours);
    const label = (minute) => {
        const h = Math.floor(minute / 60) % 24;
        const m = minute % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    return `${label(safe.startMinute)}–${label(safe.endMinute)} ${safe.timezone}`;
}
/* ────────────────────────── calendar days for charts ────────────────────────── */
/** `{2026, 3, 9}` → `"2026-03-09"`. */
function isoDateOf(date) {
    const month = String(date.month).padStart(2, '0');
    const day = String(date.day).padStart(2, '0');
    return `${date.year}-${month}-${day}`;
}
/**
 * Which business day an instant belongs to, as `YYYY-MM-DD`.
 *
 * The day a ticket counts towards is the one the *business* was living through when
 * it arrived — not the server's, and not UTC's. At 02:00 in Kolkata the UTC date is
 * still yesterday, so bucketing on UTC would file the first hours of every working
 * day under the day before and leave the dashboard's chart permanently skewed.
 */
export function businessDateKey(instant, hours) {
    const safe = normalizeBusinessHours(hours);
    return isoDateOf(calendarDateOf(instant, safe.timezone));
}
/**
 * The `days` business days ending with the one `now` falls in: their `YYYY-MM-DD`
 * keys oldest first, plus the instant the first of them begins.
 *
 * The keys are stepped through the calendar rather than by subtracting 24 hours from
 * an instant repeatedly, which either side of a DST change repeats or skips a day —
 * and a chart with a duplicated or missing column is one nobody trusts. `from` is a
 * real instant so a caller can hand it straight to a query.
 */
export function recentBusinessDays(now, days, hours) {
    const safe = normalizeBusinessHours(hours);
    const span = Math.max(1, Math.min(MAX_DAYS_SCANNED, Math.floor(days)));
    const today = calendarDateOf(now, safe.timezone);
    // One UTC subtraction to find the far end, then forward through the calendar.
    const start = new Date(Date.UTC(today.year, today.month - 1, today.day - (span - 1)));
    let cursor = {
        year: start.getUTCFullYear(),
        month: start.getUTCMonth() + 1,
        day: start.getUTCDate(),
    };
    const from = instantAtZoned(cursor, 0, safe.timezone);
    const keys = [];
    for (let i = 0; i < span; i += 1) {
        keys.push(isoDateOf(cursor));
        cursor = nextCalendarDay(cursor);
    }
    return { keys, from };
}
