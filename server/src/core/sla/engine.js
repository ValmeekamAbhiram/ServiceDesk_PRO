/**
 * ServiceDesk Pro — the SLA engine (pure).
 *
 * Two targets run on every ticket: **response** (a human replied) and
 * **resolution** (it was fixed). Each is a budget in business minutes, a deadline
 * computed from that budget, and a verdict.
 *
 * ## Persist the inputs, derive the verdict
 *
 * A ticket stores `budgetMinutes` and `dueAt` — facts, written once. It does *not*
 * store how much of the budget is used, because that changes every second. Every
 * read recomputes it here, so the countdown a user sees is exact rather than as
 * fresh as the last background sweep.
 *
 * The neat part: consumption needs no start timestamp. `businessMinutesBetween(now,
 * dueAt)` is what is left of the budget in business time, so `budget - that` is what
 * has been spent — and because `dueAt` was itself produced by `addBusinessMinutes`,
 * the two agree exactly. Nights and weekends fall out of the arithmetic for free:
 * a ticket raised at 17:30 on Friday has consumed 30 minutes all weekend.
 *
 * ## The cached `state` may only ever be conservative
 *
 * `state` is stored on the ticket purely so "show me everything breached" is an
 * index scan. `escalate()` is the only function the background monitor writes
 * through, and it moves ON_TRACK → AT_RISK → BREACHED and never back. A ticket the
 * sweep has not reached yet can therefore under-report its urgency for at most one
 * interval; it can never claim to be healthy after breaching.
 *
 * ## What the clock does *not* do
 *
 * There is no pause. A ticket sitting in ON_HOLD waiting on the requester keeps
 * burning its resolution budget. Pausing is the honest thing for a real service
 * desk and the wrong thing for this one: it doubles the state a reader has to hold
 * and every demo then needs a story about who is allowed to stop the clock.
 *
 * Pure module: `Date` in, `Date` out, no `Date.now()`, no Mongoose, no config.
 */
import { Priority, SlaState, TERMINAL_SLA_STATES } from '@shared/enums';
import { addBusinessMinutes, businessMinutesBetween, } from '@/core/sla/business-hours';
/**
 * Ordering for "worst first" sorts and for `escalate`. MET sits at the bottom: it is
 * the good verdict, and a met target needs no attention.
 */
export const SLA_SEVERITY = {
    [SlaState.MET]: 0,
    [SlaState.ON_TRACK]: 1,
    [SlaState.AT_RISK]: 2,
    [SlaState.BREACHED]: 3,
};
/** MET and BREACHED are verdicts, not projections: neither is ever revisited. */
export function isTerminalSlaState(state) {
    return TERMINAL_SLA_STATES.includes(state);
}
/** A target with no budget: nothing to breach, nothing to count down. */
export function emptyTarget() {
    return { startedAt: null, budgetMinutes: 0, dueAt: null, metAt: null, state: SlaState.ON_TRACK };
}
/* ──────────────────────────── starting the clock ──────────────────────────── */
/**
 * The budget for a priority. Falls back to MEDIUM, then to "no target", rather than
 * throwing: a policy missing one priority should degrade a single ticket's SLA, not
 * refuse to create the ticket.
 */
export function budgetFor(policy, priority) {
    return (policy.targets?.[priority] ??
        policy.targets?.[Priority.MEDIUM] ?? { responseMinutes: 0, resolutionMinutes: 0 });
}
/**
 * Open a target: snapshot the budget and compute the deadline in business time.
 * A ticket raised at 22:00 gets the deadline it would have had at the next opening
 * bell, because `addBusinessMinutes` starts counting when the desk opens.
 */
export function startTarget(startedAt, budgetMinutes, hours) {
    if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0)
        return emptyTarget();
    return {
        startedAt,
        budgetMinutes: Math.round(budgetMinutes),
        dueAt: addBusinessMinutes(startedAt, budgetMinutes, hours),
        metAt: null,
        state: SlaState.ON_TRACK,
    };
}
/** Both targets for a new ticket. Called once, at creation. */
export function startTicketSla(createdAt, priority, policy) {
    const budget = budgetFor(policy, priority);
    return {
        policyName: policy.name,
        response: startTarget(createdAt, budget.responseMinutes, policy.businessHours),
        resolution: startTarget(createdAt, budget.resolutionMinutes, policy.businessHours),
    };
}
/**
 * Stop a target's clock. `at` is when the thing actually happened — the first staff
 * comment for response, the resolve for resolution — so a late sweep cannot make a
 * reply look later than it was. The verdict is decided here and never revisited:
 * on time is MET, after the deadline is BREACHED.
 */
export function markTargetMet(target, at) {
    if (target.metAt)
        return target;
    const onTime = !target.dueAt || at.getTime() <= target.dueAt.getTime();
    return { ...target, metAt: at, state: onTime ? SlaState.MET : SlaState.BREACHED };
}
/* ──────────────────────────── reading the clock ───────────────────────────── */
/**
 * Business minutes consumed, as a percentage of the budget.
 *
 * Derived backwards from the deadline — see the header — so no start timestamp has
 * to be stored or kept in step. Overrun is measured in business minutes too, which
 * is why a ticket that breached on Friday evening still reads 105% on Sunday rather
 * than climbing all weekend: the desk was shut, so nothing was consumed.
 */
function percentConsumed(target, reference, hours) {
    const { dueAt, budgetMinutes } = target;
    if (!dueAt || budgetMinutes <= 0)
        return 0;
    const remainingBusinessMinutes = reference.getTime() >= dueAt.getTime()
        ? -businessMinutesBetween(dueAt, reference, hours)
        : businessMinutesBetween(reference, dueAt, hours);
    const consumed = budgetMinutes - remainingBusinessMinutes;
    return Math.max(0, Math.round((consumed / budgetMinutes) * 100));
}
/**
 * The truth about one target at `now`. This is what every read path calls; the
 * stored `state` is only ever a query accelerator.
 *
 * For a met target the reference instant is `metAt`, not `now` — so the row keeps
 * showing the margin it finished with ("2 h to spare") instead of a countdown that
 * drifts on after the work was done.
 */
export function evaluateTarget(target, now, policy) {
    const { dueAt, metAt, budgetMinutes } = target;
    if (!dueAt) {
        return {
            state: metAt ? SlaState.MET : SlaState.ON_TRACK,
            dueAt: null,
            metAt: metAt ?? null,
            remainingMs: null,
            percentUsed: 0,
            budgetMinutes,
        };
    }
    const reference = metAt ?? now;
    const remainingMs = dueAt.getTime() - reference.getTime();
    const percentUsed = percentConsumed(target, reference, policy.businessHours);
    const threshold = policy.atRiskThresholdPercent;
    let state;
    if (metAt) {
        state = remainingMs >= 0 ? SlaState.MET : SlaState.BREACHED;
    }
    else if (remainingMs <= 0) {
        state = SlaState.BREACHED;
    }
    else {
        state = percentUsed >= threshold ? SlaState.AT_RISK : SlaState.ON_TRACK;
    }
    return { state, dueAt, metAt: metAt ?? null, remainingMs, percentUsed, budgetMinutes };
}
/** The state a target *should* hold at `now`, ignoring what is cached. */
export function projectTargetState(target, now, policy) {
    return evaluateTarget(target, now, policy).state;
}
/** Both targets, plus the one flag a list row needs. */
export function evaluateTicketSla(sla, now, policy) {
    const response = evaluateTarget(sla.response, now, policy);
    const resolution = evaluateTarget(sla.resolution, now, policy);
    return {
        policyName: sla.policyName || policy.name,
        response,
        resolution,
        breached: response.state === SlaState.BREACHED || resolution.state === SlaState.BREACHED,
    };
}
/* ──────────────────────── maintaining the cached state ─────────────────────── */
/**
 * Merge a freshly computed state into the cached one **without ever softening it**.
 * The single write path for the background monitor, and the reason a stale cache is
 * safe to query: severity only rises.
 *
 * A verdict on either side wins outright — a cached MET or BREACHED is a decision
 * already recorded, and a newly computed one is a fact that has just become true.
 */
export function escalate(cached, computed) {
    if (isTerminalSlaState(cached))
        return cached;
    if (isTerminalSlaState(computed))
        return computed;
    return SLA_SEVERITY[computed] > SLA_SEVERITY[cached] ? computed : cached;
}
/**
 * What the sweep should persist for one ticket, or `null` when nothing changed —
 * which is the common case, so the monitor can skip the write entirely.
 */
export function sweepTicketSla(sla, now, policy) {
    const response = escalate(sla.response.state, projectTargetState(sla.response, now, policy));
    const resolution = escalate(sla.resolution.state, projectTargetState(sla.resolution, now, policy));
    if (response === sla.response.state && resolution === sla.resolution.state)
        return null;
    return { response, resolution };
}
/* ───────────────────────── the clock changing shape ────────────────────────── */
/**
 * Recompute a target after its budget changed, keeping the same start instant.
 *
 * This is the **only** path allowed to soften a state, and it is legitimate: the
 * deadline moved because a person deliberately changed the ticket's priority, so a
 * breach recorded against a deadline that no longer applies should not survive. An
 * URGENT escalation tightens the deadline the same way, which is the point — the
 * ticket was urgent from the moment it was raised, not from the moment somebody
 * noticed.
 *
 * `metAt` is preserved: when the reply happened is a fact, and only the verdict on
 * whether it was in time is recomputed.
 */
export function repriceTarget(existing, budgetMinutes, now, policy) {
    /* The start instant comes off the target itself, never from the caller. A target
     * that never had a budget has no recorded start, and `now` is the only honest
     * answer: this clock is beginning here. */
    const startedAt = existing.startedAt ?? now;
    const fresh = startTarget(startedAt, budgetMinutes, policy.businessHours);
    const carried = { ...fresh, metAt: existing.metAt };
    return { ...carried, state: projectTargetState(carried, now, policy) };
}
/**
 * Both targets, after a priority change. Each keeps the instant its own clock
 * started, so escalating a reopened ticket reprices the resolution budget from the
 * reopen rather than dragging it back to the original report.
 */
export function repriceTicketSla(sla, priority, now, policy) {
    const budget = budgetFor(policy, priority);
    return {
        policyName: policy.name,
        response: repriceTarget(sla.response, budget.responseMinutes, now, policy),
        resolution: repriceTarget(sla.resolution, budget.resolutionMinutes, now, policy),
    };
}
/**
 * Reopening restarts the **resolution** clock from the reopen instant with a full
 * budget, and leaves the response target alone: whether the original report got a
 * timely first reply is settled history, and `reopenCount` is the metric that says
 * the fix did not hold.
 */
export function reopenTicketSla(sla, reopenedAt, priority, policy) {
    const budget = budgetFor(policy, priority);
    return {
        policyName: policy.name,
        response: sla.response,
        resolution: startTarget(reopenedAt, budget.resolutionMinutes, policy.businessHours),
    };
}
/** Worst of several states — for rolling a list of tickets up to one badge. */
export function worstSlaState(states) {
    return states.reduce((worst, state) => (SLA_SEVERITY[state] > SLA_SEVERITY[worst] ? state : worst), SlaState.MET);
}
