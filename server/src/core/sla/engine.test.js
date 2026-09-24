/**
 * The SLA engine.
 *
 * Same conventions as the business-hours suite: instants are written as
 * `Asia/Kolkata` wall clocks, and 2026-01-05 is a Monday. The policy below is the
 * shipped default, so a failure here is a failure a user would actually have seen.
 */
import { describe, expect, it } from 'vitest';
import { Priority, SlaState } from '@shared/enums';
import { FixedClock } from '@/core/clock';
import { budgetFor, emptyTarget, escalate, evaluateTarget, evaluateTicketSla, markTargetMet, reopenTicketSla, repriceTicketSla, startTarget, startTicketSla, sweepTicketSla, worstSlaState, } from '@/core/sla/engine';
const IST = {
    timezone: 'Asia/Kolkata',
    startMinute: 540,
    endMinute: 1080,
    workingDays: [1, 2, 3, 4, 5],
};
const POLICY = {
    name: 'Standard support policy',
    businessHours: IST,
    atRiskThresholdPercent: 75,
    targets: {
        [Priority.URGENT]: { responseMinutes: 15, resolutionMinutes: 240 },
        [Priority.HIGH]: { responseMinutes: 60, resolutionMinutes: 480 },
        [Priority.MEDIUM]: { responseMinutes: 240, resolutionMinutes: 1440 },
        [Priority.LOW]: { responseMinutes: 480, resolutionMinutes: 2880 },
    },
};
function ist(wallClock) {
    return new Date(`${wallClock}:00+05:30`);
}
function istLabel(date) {
    if (!date)
        return 'null';
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
const MINUTE = 60_000;
describe('starting the clock', () => {
    it('snapshots the budget and computes both deadlines in business time', () => {
        const sla = startTicketSla(ist('2026-01-05T09:00'), Priority.URGENT, POLICY);
        expect(sla.policyName).toBe('Standard support policy');
        expect(sla.response.budgetMinutes).toBe(15);
        expect(istLabel(sla.response.dueAt)).toBe('2026-01-05T09:15');
        expect(sla.resolution.budgetMinutes).toBe(240);
        expect(istLabel(sla.resolution.dueAt)).toBe('2026-01-05T13:00');
        expect(sla.response.state).toBe(SlaState.ON_TRACK);
        expect(sla.response.metAt).toBeNull();
    });
    it('does not spend the weekend on a ticket raised on Saturday', () => {
        const sla = startTicketSla(ist('2026-01-10T12:00'), Priority.URGENT, POLICY);
        // The budget starts at Monday's opening bell, not at 12:00 on Saturday.
        expect(istLabel(sla.response.dueAt)).toBe('2026-01-12T09:15');
        expect(istLabel(sla.resolution.dueAt)).toBe('2026-01-12T13:00');
    });
    it('gives a zero budget no deadline at all', () => {
        const target = startTarget(ist('2026-01-05T09:00'), 0, IST);
        expect(target).toEqual(emptyTarget());
        const view = evaluateTarget(target, ist('2027-01-01T09:00'), POLICY);
        expect(view.state).toBe(SlaState.ON_TRACK);
        expect(view.remainingMs).toBeNull();
        expect(view.percentUsed).toBe(0);
    });
    it('falls back to the MEDIUM budget for a priority the policy omits', () => {
        const thin = {
            ...POLICY,
            targets: { [Priority.MEDIUM]: POLICY.targets[Priority.MEDIUM] },
        };
        expect(budgetFor(thin, Priority.URGENT)).toEqual({
            responseMinutes: 240,
            resolutionMinutes: 1440,
        });
        expect(budgetFor({ ...thin, targets: {} }, Priority.LOW)).toEqual({ responseMinutes: 0, resolutionMinutes: 0 });
    });
});
describe('ON_TRACK → AT_RISK → BREACHED', () => {
    const created = ist('2026-01-05T09:00');
    const target = startTarget(created, 15, IST); // URGENT response: due 09:15
    it('is on track early in the budget', () => {
        const view = evaluateTarget(target, ist('2026-01-05T09:05'), POLICY);
        expect(view.state).toBe(SlaState.ON_TRACK);
        expect(view.percentUsed).toBe(33); // 5 of 15 minutes
        expect(view.remainingMs).toBe(10 * MINUTE);
    });
    it('flips to at risk once the threshold is crossed and not before', () => {
        // 11 of 15 minutes is 73% — still on track at a 75% threshold.
        expect(evaluateTarget(target, ist('2026-01-05T09:11'), POLICY).state).toBe(SlaState.ON_TRACK);
        const atRisk = evaluateTarget(target, ist('2026-01-05T09:12'), POLICY);
        expect(atRisk.percentUsed).toBe(80);
        expect(atRisk.state).toBe(SlaState.AT_RISK);
    });
    it('breaches the moment the deadline passes', () => {
        const onTheBell = evaluateTarget(target, ist('2026-01-05T09:15'), POLICY);
        expect(onTheBell.remainingMs).toBe(0);
        expect(onTheBell.state).toBe(SlaState.BREACHED);
        const over = evaluateTarget(target, ist('2026-01-05T09:20'), POLICY);
        expect(over.state).toBe(SlaState.BREACHED);
        expect(over.remainingMs).toBe(-5 * MINUTE);
        expect(over.percentUsed).toBe(133); // 20 of 15 minutes
    });
    it('honours a policy that warns earlier', () => {
        const jumpy = { ...POLICY, atRiskThresholdPercent: 25 };
        expect(evaluateTarget(target, ist('2026-01-05T09:05'), jumpy).state).toBe(SlaState.AT_RISK);
    });
});
describe('stopping the clock', () => {
    const target = startTarget(ist('2026-01-05T09:00'), 15, IST); // due 09:15
    it('records MET with the margin it finished with', () => {
        const met = markTargetMet(target, ist('2026-01-05T09:10'));
        expect(met.state).toBe(SlaState.MET);
        // Read an hour later: the row still shows the five minutes it had spare, rather
        // than a countdown that keeps running after the work was done.
        const view = evaluateTarget(met, ist('2026-01-05T10:10'), POLICY);
        expect(view.state).toBe(SlaState.MET);
        expect(view.remainingMs).toBe(5 * MINUTE);
        expect(view.percentUsed).toBe(67);
    });
    it('records BREACHED when the reply came late, and keeps saying so', () => {
        const met = markTargetMet(target, ist('2026-01-05T09:25'));
        expect(met.state).toBe(SlaState.BREACHED);
        const view = evaluateTarget(met, ist('2026-01-06T09:00'), POLICY);
        expect(view.state).toBe(SlaState.BREACHED);
        expect(view.remainingMs).toBe(-10 * MINUTE);
    });
    it('ignores a second attempt to stop the clock', () => {
        const met = markTargetMet(target, ist('2026-01-05T09:10'));
        expect(markTargetMet(met, ist('2026-01-05T09:30'))).toBe(met);
    });
});
describe('consumption is measured in business minutes', () => {
    // HIGH response, 60 minutes, raised at 17:00 on Friday → due at 18:00 that evening.
    const target = startTarget(ist('2026-01-09T17:00'), 60, IST);
    it('does not burn budget while the desk is shut', () => {
        expect(istLabel(target.dueAt)).toBe('2026-01-09T18:00');
        const saturday = evaluateTarget(target, ist('2026-01-10T12:00'), POLICY);
        expect(saturday.state).toBe(SlaState.BREACHED);
        // Eighteen wall-clock hours late, but exactly the budget in business time.
        expect(saturday.percentUsed).toBe(100);
        expect(saturday.remainingMs).toBeLessThan(0);
        const sunday = evaluateTarget(target, ist('2026-01-11T23:00'), POLICY);
        expect(sunday.percentUsed).toBe(100);
    });
    it('resumes counting when the desk reopens', () => {
        const monday = evaluateTarget(target, ist('2026-01-12T09:30'), POLICY);
        expect(monday.percentUsed).toBe(150); // 90 business minutes against a 60 budget
    });
});
describe('escalate', () => {
    it('takes the more severe of the two', () => {
        expect(escalate(SlaState.ON_TRACK, SlaState.AT_RISK)).toBe(SlaState.AT_RISK);
        expect(escalate(SlaState.AT_RISK, SlaState.BREACHED)).toBe(SlaState.BREACHED);
    });
    it('never softens a cached state', () => {
        expect(escalate(SlaState.AT_RISK, SlaState.ON_TRACK)).toBe(SlaState.AT_RISK);
        expect(escalate(SlaState.BREACHED, SlaState.ON_TRACK)).toBe(SlaState.BREACHED);
        expect(escalate(SlaState.BREACHED, SlaState.AT_RISK)).toBe(SlaState.BREACHED);
    });
    it('keeps a verdict already recorded, and accepts a fresh one', () => {
        expect(escalate(SlaState.MET, SlaState.BREACHED)).toBe(SlaState.MET);
        expect(escalate(SlaState.ON_TRACK, SlaState.MET)).toBe(SlaState.MET);
        expect(escalate(SlaState.AT_RISK, SlaState.MET)).toBe(SlaState.MET);
    });
});
describe('sweepTicketSla', () => {
    const created = ist('2026-01-05T09:00');
    const sla = startTicketSla(created, Priority.URGENT, POLICY); // 09:15 / 13:00
    it('reports nothing to do while both targets are healthy', () => {
        expect(sweepTicketSla(sla, ist('2026-01-05T09:05'), POLICY)).toBeNull();
    });
    it('escalates each target independently', () => {
        // 09:13: the 15-minute response is at risk, the 4-hour resolution is fine.
        expect(sweepTicketSla(sla, ist('2026-01-05T09:13'), POLICY)).toEqual({
            response: SlaState.AT_RISK,
            resolution: SlaState.ON_TRACK,
        });
        expect(sweepTicketSla(sla, ist('2026-01-05T14:00'), POLICY)).toEqual({
            response: SlaState.BREACHED,
            resolution: SlaState.BREACHED,
        });
    });
    it('will not walk a breach back if the clock moves backwards', () => {
        const breached = { ...sla, response: { ...sla.response, state: SlaState.BREACHED } };
        expect(sweepTicketSla(breached, ist('2026-01-05T09:01'), POLICY)).toBeNull();
    });
});
describe('repriceTicketSla', () => {
    const created = ist('2026-01-05T09:00');
    const medium = startTicketSla(created, Priority.MEDIUM, POLICY); // 13:00 / Wed 15:00
    it('tightens both deadlines when a ticket is escalated', () => {
        const urgent = repriceTicketSla(medium, Priority.URGENT, ist('2026-01-05T09:30'), POLICY);
        // Urgent from the moment it was raised, not from the moment somebody noticed.
        expect(istLabel(urgent.response.dueAt)).toBe('2026-01-05T09:15');
        expect(istLabel(urgent.resolution.dueAt)).toBe('2026-01-05T13:00');
        expect(urgent.response.state).toBe(SlaState.BREACHED);
        expect(urgent.resolution.state).toBe(SlaState.ON_TRACK);
    });
    it('clears a breach recorded against a deadline that no longer applies', () => {
        const now = ist('2026-01-05T14:00');
        expect(evaluateTarget(medium.response, now, POLICY).state).toBe(SlaState.BREACHED);
        const relaxed = repriceTicketSla(medium, Priority.LOW, now, POLICY);
        expect(istLabel(relaxed.response.dueAt)).toBe('2026-01-05T17:00');
        expect(relaxed.response.state).toBe(SlaState.ON_TRACK);
    });
    it('reprices a reopened ticket from the reopen, not from the original report', () => {
        /* This is what the per-target `startedAt` is for. After a reopen the two clocks
         * genuinely started at different instants, so repricing from one ticket-level
         * value would have to be wrong for one of them — here it would drag the fresh
         * resolution budget back to Monday and breach it on the spot. */
        const reopened = reopenTicketSla(medium, ist('2026-01-08T10:00'), Priority.MEDIUM, POLICY);
        const escalated = repriceTicketSla(reopened, Priority.URGENT, ist('2026-01-08T10:30'), POLICY);
        // Response: still measured from Monday 09:00, so 15 urgent minutes lands at 09:15.
        expect(istLabel(escalated.response.dueAt)).toBe('2026-01-05T09:15');
        // Resolution: measured from the Thursday reopen, so four urgent hours to 14:00.
        expect(istLabel(escalated.resolution.dueAt)).toBe('2026-01-08T14:00');
        expect(escalated.resolution.state).toBe(SlaState.ON_TRACK);
    });
    it('keeps when the reply happened and only re-judges whether it was in time', () => {
        const replied = {
            ...medium,
            response: markTargetMet(medium.response, ist('2026-01-05T12:00')),
        };
        expect(replied.response.state).toBe(SlaState.MET);
        const urgent = repriceTicketSla(replied, Priority.URGENT, ist('2026-01-05T12:05'), POLICY);
        expect(istLabel(urgent.response.metAt)).toBe('2026-01-05T12:00');
        expect(urgent.response.state).toBe(SlaState.BREACHED);
    });
});
describe('reopenTicketSla', () => {
    const created = ist('2026-01-05T09:00');
    const resolved = (() => {
        const sla = startTicketSla(created, Priority.URGENT, POLICY);
        return {
            ...sla,
            response: markTargetMet(sla.response, ist('2026-01-05T09:10')),
            resolution: markTargetMet(sla.resolution, ist('2026-01-05T10:00')),
        };
    })();
    it('restarts the resolution clock and leaves the response verdict alone', () => {
        const reopened = reopenTicketSla(resolved, ist('2026-01-06T11:00'), Priority.URGENT, POLICY);
        expect(reopened.response).toBe(resolved.response);
        expect(reopened.response.state).toBe(SlaState.MET);
        expect(reopened.resolution.metAt).toBeNull();
        expect(reopened.resolution.state).toBe(SlaState.ON_TRACK);
        expect(istLabel(reopened.resolution.dueAt)).toBe('2026-01-06T15:00');
    });
});
describe('evaluateTicketSla', () => {
    const sla = startTicketSla(ist('2026-01-05T09:00'), Priority.URGENT, POLICY);
    it('rolls both targets up to the one flag a list row needs', () => {
        expect(evaluateTicketSla(sla, ist('2026-01-05T09:05'), POLICY).breached).toBe(false);
        const late = evaluateTicketSla(sla, ist('2026-01-05T09:20'), POLICY);
        expect(late.response.state).toBe(SlaState.BREACHED);
        expect(late.resolution.state).toBe(SlaState.ON_TRACK);
        expect(late.breached).toBe(true);
    });
    it('reports the policy name the deadlines were set under', () => {
        expect(evaluateTicketSla(sla, ist('2026-01-05T09:05'), POLICY).policyName).toBe('Standard support policy');
        // A ticket seeded before the field existed still gets a usable label.
        const nameless = { ...sla, policyName: '' };
        expect(evaluateTicketSla(nameless, ist('2026-01-05T09:05'), POLICY).policyName).toBe('Standard support policy');
    });
});
describe('worstSlaState', () => {
    it('picks the state that needs attention', () => {
        expect(worstSlaState([])).toBe(SlaState.MET);
        expect(worstSlaState([SlaState.MET, SlaState.ON_TRACK])).toBe(SlaState.ON_TRACK);
        expect(worstSlaState([SlaState.ON_TRACK, SlaState.BREACHED, SlaState.AT_RISK])).toBe(SlaState.BREACHED);
    });
});
describe('driven by an injectable clock', () => {
    /**
     * The Time Machine works by swapping the clock, and this is the whole mechanism:
     * the engine reads `now` from whatever clock it is handed, so advancing a
     * `FixedClock` in a test is the same operation as an admin jumping the demo clock
     * forward in the browser.
     */
    it('walks a ticket through its states as the clock advances', () => {
        const clock = new FixedClock(ist('2026-01-05T09:00'));
        const sla = startTicketSla(clock.now(), Priority.URGENT, POLICY);
        expect(evaluateTicketSla(sla, clock.now(), POLICY).response.state).toBe(SlaState.ON_TRACK);
        clock.advanceMinutes(12);
        expect(evaluateTicketSla(sla, clock.now(), POLICY).response.state).toBe(SlaState.AT_RISK);
        clock.advanceMinutes(5);
        const breached = evaluateTicketSla(sla, clock.now(), POLICY);
        expect(breached.response.state).toBe(SlaState.BREACHED);
        expect(breached.breached).toBe(true);
        // Jump past the four-hour resolution deadline too.
        clock.advanceMinutes(4 * 60);
        expect(evaluateTicketSla(sla, clock.now(), POLICY).resolution.state).toBe(SlaState.BREACHED);
    });
    it('skips the closed hours a demo jump lands in', () => {
        // Friday 17:30, urgent: 30 minutes of Friday left, so the 4-hour resolution
        // deadline lands on Monday morning.
        const clock = new FixedClock(ist('2026-01-09T17:30'));
        const sla = startTicketSla(clock.now(), Priority.URGENT, POLICY);
        expect(istLabel(sla.resolution.dueAt)).toBe('2026-01-12T12:30');
        // Jumping into Saturday consumes only the half hour that was actually open.
        clock.advanceMinutes(24 * 60);
        const saturday = evaluateTicketSla(sla, clock.now(), POLICY);
        expect(saturday.resolution.percentUsed).toBe(13); // 30 of 240 business minutes
        expect(saturday.resolution.state).toBe(SlaState.ON_TRACK);
    });
});
