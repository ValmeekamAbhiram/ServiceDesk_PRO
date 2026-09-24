/**
 * ServiceDesk Pro — injectable clock.
 *
 * Every piece of time-dependent logic in this codebase reads the current instant
 * from a `Clock`, never from `Date.now()`. That single indirection is what makes
 * three otherwise-hard things possible:
 *
 *  1. **The Time Machine.** A `DemoClock` shifts the whole application's
 *     notion of "now" forward, so an SLA that is 40 minutes from breaching can be
 *     pushed over the line in a demo without waiting 40 minutes or mutating any
 *     stored timestamp.
 *  2. **Deterministic SLA tests.** A `FixedClock` pins "now" to an exact instant,
 *     so a business-hours assertion is reproducible on any machine in any month.
 *  3. **Honest data.** The demo clock changes only the *reading* of time. Ticket
 *     `createdAt` values are never rewritten, so nothing in the database becomes
 *     a lie after a time jump.
 *
 * This module is pure: no Express, no Mongoose, no config, no I/O. The
 * process-wide instance lives in `config/clock.ts`.
 */
import { ClockMode } from '@shared/enums';
import { MINUTE_MS } from '@shared/utils';
/** Production clock. Reads the host clock and nothing else. */
export class RealClock {
    mode = ClockMode.REAL;
    now() {
        return new Date();
    }
    nowMs() {
        return Date.now();
    }
    offsetMs() {
        return 0;
    }
    realNow() {
        return new Date();
    }
}
/**
 * Demo clock: real time plus a mutable offset.
 *
 * The offset — not a frozen instant — is what makes the demo convincing. After
 * `advanceMinutes(30)` the clock keeps ticking second by second from the new
 * position, so live countdowns keep animating and the SLA monitor keeps firing
 * on its normal interval.
 *
 * Never reachable in production: `config/env.ts` forces `demoMode` off there and
 * the `/api/demo/*` routes are gated behind the `demo:control` permission.
 */
export class DemoClock {
    mode = ClockMode.DEMO;
    offset;
    constructor(offsetMs = 0) {
        this.offset = Number.isFinite(offsetMs) ? offsetMs : 0;
    }
    now() {
        return new Date(Date.now() + this.offset);
    }
    nowMs() {
        return Date.now() + this.offset;
    }
    offsetMs() {
        return this.offset;
    }
    realNow() {
        return new Date();
    }
    /** Shift the clock by a signed number of minutes (the +15m / +1d buttons). */
    advanceMinutes(minutes) {
        if (!Number.isFinite(minutes))
            return;
        this.offset += minutes * MINUTE_MS;
    }
    advanceMs(ms) {
        if (!Number.isFinite(ms))
            return;
        this.offset += ms;
    }
    /** Jump to a specific instant, keeping the clock ticking from there. */
    setAbsolute(instant) {
        const target = instant.getTime();
        if (!Number.isFinite(target))
            return;
        this.offset = target - Date.now();
    }
    /** Back to real time — the RESET button. */
    reset() {
        this.offset = 0;
    }
}
/**
 * Test clock: a completely frozen instant that only moves when a test moves it.
 * Used by the SLA suite so "Friday 17:45" means exactly that, forever.
 */
export class FixedClock {
    mode = ClockMode.DEMO;
    instantMs;
    constructor(instant) {
        this.instantMs = FixedClock.toMs(instant);
    }
    static toMs(instant) {
        const ms = instant instanceof Date
            ? instant.getTime()
            : typeof instant === 'number'
                ? instant
                : new Date(instant).getTime();
        if (!Number.isFinite(ms)) {
            throw new Error(`FixedClock received an invalid instant: ${String(instant)}`);
        }
        return ms;
    }
    now() {
        return new Date(this.instantMs);
    }
    nowMs() {
        return this.instantMs;
    }
    offsetMs() {
        return this.instantMs - Date.now();
    }
    realNow() {
        return new Date();
    }
    set(instant) {
        this.instantMs = FixedClock.toMs(instant);
    }
    advanceMinutes(minutes) {
        this.instantMs += minutes * MINUTE_MS;
    }
    advanceMs(ms) {
        this.instantMs += ms;
    }
}
/**
 * Adapter for the common case of "I have an instant, not a clock" — lets a pure
 * function keep a single `Clock` parameter instead of an awkward union.
 */
export function clockAt(instant) {
    return new FixedClock(instant);
}
export function isDemoClock(clock) {
    return clock instanceof DemoClock;
}
