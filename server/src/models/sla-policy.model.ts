/**
 * ServiceDesk Pro — the SLA policy.
 *
 * One singleton document holding the organisation's business hours and the
 * per-priority time budgets. A singleton rather than a collection of policies
 * because one policy is what this application needs, and a table with exactly
 * one row that pretends it might have many is a feature nobody asked for.
 *
 * ## Business hours are minutes from midnight
 *
 * `startMinute: 540` is 09:00, `endMinute: 1080` is 18:00. Not `"09:00"`,
 * because the SLA engine does arithmetic on these values on every request, and a
 * string that has to be parsed at each comparison is how one call site ends up
 * treating 09:30 as 9.3 hours. Parsed once, at the edge, into the unit the maths
 * actually uses.
 *
 * `timezone` is an IANA name, and it belongs to the *business*, not to the
 * server or the viewer. A ticket raised at 17:55 in Kolkata has five minutes of
 * business time left however the server is configured — so the deadline is
 * computed in the business timezone and rendered in the viewer's.
 *
 * ## Budgets are in business minutes
 *
 * `resolutionMinutes: 480` for HIGH means eight *working* hours, not eight
 * elapsed hours. A ticket raised at 17:00 on a Friday is due at 16:00 on the
 * following Wednesday, not at 01:00 on Saturday. That distinction is the whole
 * reason `core/sla` exists rather than a `deadline = createdAt + hours` one-liner.
 */

import { Schema, Types } from 'mongoose';
import { Priority, PRIORITIES } from '@shared/enums';
import { BASE_SCHEMA_OPTIONS, defineModel, versioned } from '@/models/helpers';

/** The single policy document's fixed key. */
export const SLA_POLICY_KEY = 'default';

export interface SlaTargetBudget {
  /** Business minutes allowed for a first human reply. */
  responseMinutes: number;
  /** Business minutes allowed to resolve. */
  resolutionMinutes: number;
}

export interface BusinessHoursConfig {
  /** IANA zone, e.g. `Asia/Kolkata`. Belongs to the business — see the header. */
  timezone: string;
  /** Minutes from midnight. 540 = 09:00. */
  startMinute: number;
  /** Minutes from midnight. 1080 = 18:00. */
  endMinute: number;
  /** 0 = Sunday … 6 = Saturday. Default Mon–Fri. */
  workingDays: number[];
}

export interface SlaPolicyDoc {
  _id: Types.ObjectId;
  /** Always `SLA_POLICY_KEY`; the unique index enforces the singleton. */
  key: string;
  name: string;
  businessHours: BusinessHoursConfig;
  targets: Record<Priority, SlaTargetBudget>;
  /** Percent of the budget consumed at which a target flips to AT_RISK. */
  atRiskThresholdPercent: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const businessHoursSchema = new Schema<BusinessHoursConfig>(
  {
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    startMinute: { type: Number, required: true, default: 540, min: 0, max: 1439 },
    endMinute: { type: Number, required: true, default: 1080, min: 1, max: 1440 },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
  },
  { _id: false }
);

const targetBudgetSchema = new Schema<SlaTargetBudget>(
  {
    responseMinutes: { type: Number, required: true, min: 1 },
    resolutionMinutes: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

/**
 * Defaults chosen so the four priorities are visibly different in a demo: an
 * URGENT ticket breaches in under an hour of business time, a LOW one takes days.
 */
export const DEFAULT_SLA_TARGETS: Record<Priority, SlaTargetBudget> = {
  [Priority.URGENT]: { responseMinutes: 15, resolutionMinutes: 240 },
  [Priority.HIGH]: { responseMinutes: 60, resolutionMinutes: 480 },
  [Priority.MEDIUM]: { responseMinutes: 240, resolutionMinutes: 1440 },
  [Priority.LOW]: { responseMinutes: 480, resolutionMinutes: 2880 },
};

const slaPolicySchema = new Schema<SlaPolicyDoc>(
  {
    key: { type: String, required: true, default: SLA_POLICY_KEY, index: false },
    name: { type: String, required: true, default: 'Standard support policy', maxlength: 120 },
    businessHours: { type: businessHoursSchema, required: true, default: () => ({}) },
    targets: {
      type: Object,
      of: targetBudgetSchema,
      required: true,
      default: () => ({ ...DEFAULT_SLA_TARGETS }),
    },
    atRiskThresholdPercent: { type: Number, required: true, default: 75, min: 1, max: 99 },
  },
  BASE_SCHEMA_OPTIONS
);

versioned(slaPolicySchema);

slaPolicySchema.index({ key: 1 }, { unique: true });

/**
 * A window that ends before it starts would make the SLA engine loop forever
 * looking for business minutes that do not exist, and every priority must have a
 * budget or a ticket at that priority silently gets no deadline at all. Both are
 * cheap to check here and expensive to debug later.
 */
slaPolicySchema.pre('validate', function validatePolicy(next) {
  const hours = this.businessHours;
  if (hours && hours.endMinute <= hours.startMinute) {
    next(new Error('businessHours.endMinute must be after startMinute.'));
    return;
  }
  if (hours && (!hours.workingDays || hours.workingDays.length === 0)) {
    next(new Error('businessHours.workingDays must contain at least one day.'));
    return;
  }
  const targets = this.targets as Record<string, SlaTargetBudget> | undefined;
  for (const priority of PRIORITIES) {
    if (!targets?.[priority]) {
      next(new Error(`targets is missing a budget for priority ${priority}.`));
      return;
    }
  }
  next();
});

export const SlaPolicy = defineModel<SlaPolicyDoc>('SlaPolicy', slaPolicySchema);
