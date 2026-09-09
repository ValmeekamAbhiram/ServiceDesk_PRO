/**
 * ServiceDesk Pro — the Time Machine.
 *
 * Winding a clock forward is how an SLA demonstration is given without waiting four
 * hours for a deadline to pass, and it is also the single most dangerous control in
 * the product: everything downstream of `actor.clock` believes it. So it sits behind
 * three independent gates, and all three have to be open:
 *
 *  1. `DEMO_MODE` in the environment, which `config/env.ts` forces off outside
 *     development. A production build cannot turn this on from the admin screen.
 *  2. `demoModeRequested` in the settings document, so an administrator can close it
 *     on a development deployment without a restart.
 *  3. `demo:control`, which only an administrator holds.
 *
 * Nothing here rewrites a stored timestamp. The clock shifts what `now()` *reads*, so
 * a ticket raised ten minutes ago still says ten minutes ago after a one-day jump —
 * which is precisely what makes the deadline move without the history becoming a lie.
 */

import { AuditAction, AuditEntity } from '@shared/enums';
import type { DemoClockDto } from '@shared/types';
import { ServerEvent } from '@shared/socket';
import {
  advanceMinutes,
  clockState,
  offsetLabel,
  resetClock,
  setAbsolute,
} from '@/config/clock';
import { moduleLogger } from '@/config/logger';
import type { ActorContext } from '@/core/actor';
import { record } from '@/modules/audit/audit.service';
import { demoModeActive } from '@/modules/settings/settings.service';
import { emitToEveryone } from '@/realtime/emit';
import { DemoDisabledError } from '@/utils/errors';

const log = moduleLogger('demo');

/**
 * Gates 1 and 2. Gate 3 is `requirePermission(Permission.DEMO_CONTROL)` at the route.
 *
 * Called at the top of every mutator rather than once in the router, so a route added
 * later cannot be the one that forgot — and so the read below can share the check.
 */
async function assertDemoAvailable(): Promise<void> {
  if (!(await demoModeActive())) {
    throw new DemoDisabledError('The Time Machine is switched off on this deployment.');
  }
}

/** The panel's state. Readable by anyone who can reach the demo routes at all. */
export function currentClock(): DemoClockDto {
  return clockState();
}

/**
 * One place where a jump is announced, so all three buttons audit and broadcast on
 * identical terms.
 *
 * The broadcast goes to everyone, not to staff: a jump moves the countdown on an
 * employee's own ticket too, and a page that does not refetch would keep showing a
 * deadline that has already passed.
 *
 * The audit entry records the *offset*, not the simulated time. "Somebody moved the
 * desk's clock four hours ahead of real time" is the fact an administrator reading the
 * trail needs; the simulated instant that produced it is a consequence of it and of
 * when the button was pressed.
 */
async function announce(previousOffsetMs: number, summary: string, actor: ActorContext) {
  const state = clockState();

  log.warn(
    { requestId: actor.requestId, byUserId: actor.user.id, offsetMs: state.offsetMs },
    'Demo clock changed'
  );

  await record(
    {
      action: AuditAction.DEMO_CLOCK_CHANGED,
      entityType: AuditEntity.SETTINGS,
      entityId: null,
      entityLabel: 'Demo clock',
      summary,
      changes: [
        {
          field: 'clockOffset',
          from: offsetLabel(previousOffsetMs),
          to: state.offsetLabel,
        },
      ],
    },
    actor
  );

  emitToEveryone(ServerEvent.CLOCK_CHANGED, state);
  return state;
}

export async function advance(minutes: number, actor: ActorContext): Promise<DemoClockDto> {
  await assertDemoAvailable();
  const previous = clockState().offsetMs;
  advanceMinutes(minutes);

  const direction = minutes < 0 ? 'back' : 'forward';
  return announce(
    previous,
    `Moved the demo clock ${direction} by ${offsetLabel(Math.abs(minutes) * 60_000)}`,
    actor
  );
}

export async function jumpTo(instant: Date, actor: ActorContext): Promise<DemoClockDto> {
  await assertDemoAvailable();
  const previous = clockState().offsetMs;
  setAbsolute(instant);
  return announce(previous, `Set the demo clock to ${instant.toISOString()}`, actor);
}

export async function reset(actor: ActorContext): Promise<DemoClockDto> {
  await assertDemoAvailable();
  const previous = clockState().offsetMs;
  resetClock();
  return announce(previous, 'Reset the demo clock to real time', actor);
}
