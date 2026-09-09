/**
 * ServiceDesk Pro — suggestion request schema.
 *
 * The minimum title length here (3) is deliberately shorter than the 5 characters
 * `POST /api/tickets` demands. This endpoint is called *while* the title is being
 * typed, and rejecting a half-written one with a 400 would mean the assistant sat
 * silent until the exact keystroke that satisfied the create form. The description
 * ceiling matches the ticket field so a suggestion can be asked for on text that is
 * about to be submitted unchanged.
 */

import { z } from 'zod';
import { textField } from '@/utils/zod';

export const suggestTicketSchema = {
  body: z.object({
    title: textField(3, 200, 'Type at least three characters for a suggestion.'),
    description: textField(0, 10_000).optional(),
  }),
};

export type SuggestTicketInput = z.infer<typeof suggestTicketSchema.body>;
