/**
 * ServiceDesk Pro — system settings (a singleton) and the persisted demo clock.
 *
 * ## A singleton enforced by the database
 *
 * `key` is fixed to `'global'` and uniquely indexed, so a second settings
 * document cannot be created even by a bug. Everything reads through
 * `settingsService.get()`, which upserts the row on first call — there is no
 * "settings missing" branch anywhere else in the codebase.
 *
 * ## Why the demo clock offset is persisted here
 *
 * The Time Machine works by holding an offset that `DemoClock` adds to real
 * time. Keeping that offset only in memory has a specific and embarrassing
 * failure mode: the server restarts mid-demonstration — a file save, a crash, a
 * laptop sleeping — and the clock silently snaps back to real time. Every SLA the
 * presenter just pushed into breach becomes healthy again, and the audience
 * watches the feature un-happen. So the offset is written on every jump and
 * reloaded at boot.
 *
 * ## A setting can switch a feature off, never on
 *
 * `demoModeRequested` is a *request*, not the answer. The effective value is
 * `env.demoMode && demoModeRequested`, and `env.demoMode` is already forced to
 * false in production regardless of configuration. The ordering matters: the Time
 * Machine is a destructive control, and if a database row could enable it then
 * anyone who could write one row — a stray script, a dev backup restored over
 * production — could expose it to real users. Env is the gate; this field only
 * lets an admin switch the panel off in a build that already allows it.
 *
 * The same applies to `aiSuggestionsEnabled`: an admin can turn suggestions off,
 * but cannot turn them on when no provider is configured.
 *
 * ## What deliberately is *not* here
 *
 * SLA budgets, business hours and the at-risk threshold live on `SlaPolicy`,
 * which is the document an administrator edits for exactly that purpose. Two
 * places to set one threshold is one place too many.
 */

import { Schema, Types } from 'mongoose';
import { CLOCK_MODES, ClockMode } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, enumField, ref, versioned } from '@/models/helpers';

/** There is exactly one settings document, and this is its key. */
export const SETTINGS_KEY = 'global';

export interface SystemSettingsDoc {
  _id: Types.ObjectId;
  key: string;

  /** Shown in the app header and in outbound mail. */
  organizationName: string;
  supportEmail: string;

  /** Lets an admin switch off ticket suggestions. Cannot switch them on. */
  aiSuggestionsEnabled: boolean;

  /** Subordinate to `env.demoMode` — see the header. */
  demoModeRequested: boolean;
  clockMode: ClockMode;
  /** Milliseconds added to real time by `DemoClock`. Survives restarts. */
  clockOffsetMs: number;
  clockOffsetUpdatedAt: Date | null;

  /** True once the seeder has run, so the demo panel can say so honestly. */
  seeded: boolean;
  seededAt: Date | null;

  updatedById: Types.ObjectId | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const systemSettingsSchema = new Schema<SystemSettingsDoc>(
  {
    key: { type: String, required: true, default: SETTINGS_KEY, index: false },

    organizationName: { type: String, default: 'Northwind Industries', maxlength: 160 },
    supportEmail: { type: String, default: 'support@servicedesk.local', lowercase: true, trim: true },

    aiSuggestionsEnabled: { type: Boolean, default: true },

    demoModeRequested: { type: Boolean, default: true },
    clockMode: enumField(CLOCK_MODES, { required: true, default: ClockMode.REAL }),
    clockOffsetMs: { type: Number, default: 0 },
    clockOffsetUpdatedAt: { type: Date, default: null },

    seeded: { type: Boolean, default: false },
    seededAt: { type: Date, default: null },

    updatedById: ref('User', { index: false }),
  },
  BASE_SCHEMA_OPTIONS
);

versioned(systemSettingsSchema);

/** The singleton guarantee — see the header. */
systemSettingsSchema.index({ key: 1 }, { unique: true });

export const SystemSettings = defineModel<SystemSettingsDoc>(
  'SystemSettings',
  systemSettingsSchema
);
