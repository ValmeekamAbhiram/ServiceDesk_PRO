/**
 * ServiceDesk Pro — settings and Time Machine request schemas.
 *
 * The two demo bodies are separate on purpose. Advancing by a relative amount and
 * jumping to an absolute instant are different operations with different failure
 * modes, and folding them into one optional-everything body would make "neither
 * field was sent" a runtime problem rather than a validation one.
 */
import { z } from 'zod';
import { textField } from '@/utils/zod';
const body = z
    .object({
    organizationName: textField(2, 160).optional(),
    /* Lowercased so the stored value matches the model's `lowercase: true` and a
     * comparison in a later diff does not report a change nobody made. */
    supportEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
    aiSuggestionsEnabled: z.boolean().optional(),
    demoModeRequested: z.boolean().optional(),
})
    .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one setting to change.',
});
export const updateSettingsSchema = { body };
/**
 * The Time Machine's relative jump. Bounded at a fortnight in either direction: the
 * feature exists to make an SLA countdown cross a threshold on stage, and an
 * unbounded number is a way to push every date in the demo past the year 275760,
 * where `new Date()` stops being valid.
 *
 * Negative is allowed — winding back is how you undo an over-eager jump without
 * losing the offset entirely.
 */
const MAX_JUMP_MINUTES = 20_160;
const advanceBody = z.object({
    minutes: z
        .number()
        .int('Give the jump in whole minutes.')
        .refine((value) => value !== 0, 'A jump of zero minutes would do nothing.')
        .refine((value) => Math.abs(value) <= MAX_JUMP_MINUTES, 'Jumps are limited to fourteen days at a time.'),
});
export const advanceClockSchema = { body: advanceBody };
const setClockBody = z.object({
    /* An ISO instant, parsed here so the route never sees an unparseable string. */
    at: z.coerce.date({ invalid_type_error: 'Give a valid date and time.' }),
});
export const setClockSchema = { body: setClockBody };
