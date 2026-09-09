/**
 * ServiceDesk Pro — the process-wide clock.
 *
 * `core/clock/clock.ts` holds the pure `Clock` classes; this module owns the one
 * mutable instance the running application reads from, so `core/` stays
 * stateless and independently testable.
 *
 * In production this is always a `RealClock` and the mutators below are
 * unreachable: `config/env.ts` forces `demoMode` off outside development, and
 * `swapToDemoClock()` refuses to run when it is off. The demo routes sit behind
 * the `demo:control` permission on top of that, so there are two independent
 * gates between an ordinary user and the Time Machine.
 *
 * Nothing in the codebase should import `RealClock`/`DemoClock` directly — call
 * `getClock()`, or better, read `actor.clock`, which the request pipeline sets
 * from here.
 */

import { ClockMode } from '@shared/enums';
import type { DemoClockDto } from '@shared/types';
import { DemoClock, RealClock, type Clock } from '@/core/clock';
import { env } from '@/config/env';
import { moduleLogger } from '@/config/logger';

const log = moduleLogger('clock');

/**
 * Demo mode starts on a `DemoClock` with a zero offset. That reads exactly like
 * real time until someone presses a Time Machine button, and it means arming the
 * demo never requires swapping the instance out from under live sockets.
 */
let current: Clock = env.demoMode ? new DemoClock(0) : new RealClock();

export function getClock(): Clock {
  return current;
}

/** True when the current clock can be advanced (i.e. demo mode is armed). */
export function isTimeTravelAvailable(): boolean {
  return env.demoMode && current instanceof DemoClock;
}

/**
 * Guard used by every mutator. Returns the demo clock or throws — callers in the
 * demo module translate the throw into a `DemoDisabledError`.
 */
function requireDemoClock(): DemoClock {
  if (!env.demoMode) {
    throw new Error('Time travel is disabled: DEMO_MODE is off on this deployment.');
  }
  if (!(current instanceof DemoClock)) {
    throw new Error('Time travel is unavailable: the process is running on the real clock.');
  }
  return current;
}

/* ─────────────────────────────── Time Machine ───────────────────────────────
 * These four functions back the +15m / +30m / +1h / +4h / +1d / RESET buttons.
 * They shift only the *reading* of time — no stored timestamp is ever rewritten,
 * so a ticket created ten minutes ago still says so after a one-day jump.
 * ------------------------------------------------------------------------- */

export function advanceMinutes(minutes: number): Date {
  const clock = requireDemoClock();
  clock.advanceMinutes(minutes);
  log.warn({ minutes, offsetMs: clock.offsetMs() }, 'Demo clock advanced');
  return clock.now();
}

export function setAbsolute(instant: Date): Date {
  const clock = requireDemoClock();
  clock.setAbsolute(instant);
  log.warn({ target: instant.toISOString(), offsetMs: clock.offsetMs() }, 'Demo clock set');
  return clock.now();
}

export function resetClock(): Date {
  const clock = requireDemoClock();
  clock.reset();
  log.warn('Demo clock reset to real time');
  return clock.now();
}

/**
 * Test-only escape hatch: run a callback against a specific clock and always put
 * the previous one back. Integration tests use this instead of mutating the
 * singleton and hoping to clean up.
 */
export async function withClock<T>(clock: Clock, fn: () => Promise<T> | T): Promise<T> {
  const previous = current;
  current = clock;
  try {
    return await fn();
  } finally {
    current = previous;
  }
}

/* ──────────────────────────────── formatting ──────────────────────────────── */

/**
 * Wall-clock rendering in the configured business timezone. `Intl` is used
 * rather than a date library so an IANA zone (`Asia/Kolkata`) is handled
 * correctly including DST, with nothing added to the dependency tree.
 */
const localFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: env.BUSINESS_TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export function formatBusinessLocal(instant: Date): string {
  return localFormatter.format(instant);
}

/**
 * How far the demo clock is from real time, in words: `real time`, `+45m`,
 * `+2d 4h`. Rendered here rather than in the client because the panel's whole
 * job is to make the shift obvious, and a raw millisecond count does not.
 */
export function offsetLabel(offsetMs: number): string {
  if (offsetMs === 0) return 'real time';
  const sign = offsetMs < 0 ? '-' : '+';
  const totalMinutes = Math.round(Math.abs(offsetMs) / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return sign + parts.join(' ');
}

/**
 * Snapshot for `GET /api/demo/clock` and the `clock:changed` socket event.
 *
 * Both times are sent so the panel can show them side by side: the point of the
 * feature is that the audience sees a *simulated* clock moving away from the real
 * one, which a single timestamp cannot convey.
 */
export function clockState(): DemoClockDto {
  const clock = current;
  return {
    mode: clock.mode,
    simulatedTime: clock.now().toISOString(),
    realTime: clock.realNow().toISOString(),
    offsetMs: clock.offsetMs(),
    offsetLabel: offsetLabel(clock.offsetMs()),
  };
}

/** True when the process is reading a shifted clock right now. */
export function isTimeShifted(): boolean {
  return current.mode === ClockMode.DEMO && current.offsetMs() !== 0;
}
