/**
 * ServiceDesk Pro — SLA policy update shape.
 *
 * Every field is optional because the admin form patches one section at a time, but
 * each field that *is* present is fully validated here rather than in the service:
 * a budget of zero minutes or a business day of `9` would produce deadlines the
 * engine cannot reason about, and the cheapest place to refuse them is before they
 * reach a document that every ticket's countdown reads.
 *
 * The cross-field rule — `endMinute` after `startMinute` — is checked in the model's
 * pre-save hook too. Both, deliberately: this one gives the form a field-level error,
 * and that one guarantees no other writer can get around it.
 */
import { z } from 'zod';
import { PRIORITIES } from '@shared/enums';
/** Minutes past midnight, so 09:00 is 540. See `sla-policy.model.ts`. */
const minuteOfDay = z.coerce.number().int().min(0).max(1440);
const businessHours = z
    .object({
    /** An IANA name. Validated by trying it, because a typo here silently shifts every deadline. */
    timezone: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .refine(isKnownTimezone, { message: 'Not a timezone this system recognises.' }),
    startMinute: minuteOfDay,
    endMinute: minuteOfDay,
    workingDays: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7),
})
    .partial()
    .refine((hours) => hours.startMinute === undefined ||
    hours.endMinute === undefined ||
    hours.endMinute > hours.startMinute, { message: 'The working day must end after it starts.', path: ['endMinute'] });
const target = z.object({
    responseMinutes: z.coerce.number().int().min(1).max(100_000),
    resolutionMinutes: z.coerce.number().int().min(1).max(100_000),
});
function isKnownTimezone(zone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * The four priorities, each optional.
 *
 * Built from `PRIORITIES` rather than written out, so adding a priority to the enum
 * cannot leave a budget nobody can edit. A target that is present must give *both*
 * minutes — a response budget without a resolution budget is not a partial update, it
 * is an incomplete one, and merging it would leave the old resolution figure attached
 * to a new response figure that was chosen against different assumptions.
 */
const targets = z.object(Object.fromEntries(PRIORITIES.map((priority) => [priority, target.optional()])));
const body = z
    .object({
    name: z.string().trim().min(1).max(80),
    businessHours,
    targets,
    /**
     * Bounded 1–99 by the model as well. Zero would make every ticket AT_RISK the
     * instant it was raised, and 100 would make the state unreachable — the deadline
     * has passed by then, so it is BREACHED, not at risk.
     */
    atRiskThresholdPercent: z.coerce.number().int().min(1).max(99),
})
    .partial()
    .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Change at least one setting.',
});
export const updateSlaPolicySchema = { body };
