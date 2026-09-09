/**
 * ServiceDesk Pro — SLA policy access.
 *
 * There is exactly one policy document, enforced by a unique index on `key`. It is
 * read on every ticket create, every priority change and every monitor sweep, so it
 * is cached in process and invalidated on write rather than fetched each time.
 *
 * The cache is safe here for a specific reason: a single Node process owns it, and
 * the only writer is `saveSlaPolicy()` below, which clears it. If this ever ran
 * multi-instance the cache would have to go — a stale budget would quietly give one
 * instance different deadlines from another, which is the kind of bug that looks
 * like a clock problem for a week.
 *
 * `getSlaPolicy()` creates the document from the schema defaults on first read, so a
 * fresh database has working SLAs before anyone opens the admin screen.
 */

import { AuditAction, AuditEntity, PRIORITIES, type Priority } from '@shared/enums';
import type { SlaPolicyDto } from '@shared/types';
import type { ActorContext } from '@/core/actor';
import { SLA_POLICY_KEY, SlaPolicy, type SlaPolicyDoc } from '@/models';
import { formatBusinessWindow, normalizeBusinessHours } from '@/core/sla';
import { diff, record } from '@/modules/audit/audit.service';
import type { HydratedDocument } from 'mongoose';
import type { UpdateSlaPolicyInput } from '@/modules/sla/sla-policy.schema';

/**
 * The hydrated form, not the plain interface: `saveSlaPolicy()` mutates and saves this
 * document, and the read paths only need it to satisfy `SlaPolicySnapshot`, which a
 * hydrated document does structurally.
 */
export type SlaPolicyRecord = HydratedDocument<SlaPolicyDoc>;

let cached: SlaPolicyRecord | null = null;

export async function getSlaPolicy(): Promise<SlaPolicyRecord> {
  if (cached) return cached;

  /*
   * Upsert rather than find-then-create: two requests arriving together on an empty
   * database would otherwise both try to insert, and one would hit the unique index.
   * `setDefaultsOnInsert` is what fills in the business hours and the four budgets.
   */
  const policy = await SlaPolicy.findOneAndUpdate(
    { key: SLA_POLICY_KEY },
    { $setOnInsert: { key: SLA_POLICY_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  cached = policy;
  return policy;
}

/** Call after any write to the policy. Cheap, and forgetting it is a real bug. */
export function invalidateSlaPolicyCache(): void {
  cached = null;
}

export function toSlaPolicyDto(policy: SlaPolicyDoc): SlaPolicyDto {
  const hours = normalizeBusinessHours(policy.businessHours);
  return {
    id: policy._id.toString(),
    name: policy.name,
    businessHours: {
      timezone: hours.timezone,
      startMinute: hours.startMinute,
      endMinute: hours.endMinute,
      workingDays: [...hours.workingDays],
      label: formatBusinessWindow(hours),
    },
    atRiskThresholdPercent: policy.atRiskThresholdPercent,
    targets: policy.targets as Record<Priority, { responseMinutes: number; resolutionMinutes: number }>,
    updatedAt: policy.updatedAt.toISOString(),
  };
}

/* ─────────────────────────────── writing ───────────────────────────────── */

/**
 * Update the policy. Admin-only at the route; the whole document is one row.
 *
 * ## What a change does and does not reach
 *
 * This is the part worth being precise about, because the two halves of the policy
 * behave differently and a demo that gets it wrong looks like a bug:
 *
 *  - **Business hours and the at-risk threshold apply immediately, to every open
 *    ticket.** Neither is copied onto the ticket — the engine reads them from the
 *    policy each time it evaluates a countdown — so widening the working day moves
 *    every existing deadline's *state* at the next sweep.
 *  - **Budgets apply to tickets raised afterwards.** A ticket stores the
 *    `budgetMinutes` and `dueAt` it was given, so shortening HIGH from 480 to 240
 *    minutes does not retroactively breach last week's tickets. That is deliberate:
 *    the deadline was a commitment made when the ticket was raised, and moving it
 *    under the technician working to it would be worse than an inconsistency.
 *    A priority change on an individual ticket does reprice it, through
 *    `repriceTicketSla` — one ticket, one deliberate act.
 *
 * The cache is cleared before the audit entry is written rather than after, so a
 * failure in the audit write cannot leave a stale policy cached behind a successful
 * update.
 */
export async function saveSlaPolicy(
  input: UpdateSlaPolicyInput,
  actor: ActorContext
): Promise<SlaPolicyDto> {
  const existing = await getSlaPolicy();
  const before = snapshotFor(existing);

  if (input.name !== undefined) existing.name = input.name;
  if (input.atRiskThresholdPercent !== undefined) {
    existing.atRiskThresholdPercent = input.atRiskThresholdPercent;
  }
  if (input.businessHours) {
    Object.assign(existing.businessHours, input.businessHours);
    /* `workingDays` is an array on a subdocument: `Object.assign` replaces the value
     * but Mongoose only notices a mutation it can see, so say so explicitly. */
    existing.markModified('businessHours');
  }
  if (input.targets) {
    for (const [priority, budget] of Object.entries(input.targets)) {
      if (budget) existing.targets[priority as Priority] = { ...budget };
    }
    existing.markModified('targets');
  }

  await existing.save();
  invalidateSlaPolicyCache();

  await record(
    {
      action: AuditAction.SETTINGS_UPDATED,
      entityType: AuditEntity.SLA_POLICY,
      entityId: existing._id.toString(),
      entityLabel: existing.name,
      summary: `Updated the SLA policy "${existing.name}"`,
      changes: diff(before, snapshotFor(existing), SNAPSHOT_FIELDS),
    },
    actor
  );

  return toSlaPolicyDto(existing);
}

/**
 * A flat, comparable view of the policy, for the audit trail.
 *
 * Flattened on purpose: `diff()` compares values, and an audit row reading
 * `targets HIGH 60/480 → 30/240` is what an administrator needs six weeks later.
 * Handing it the nested objects instead would record `[object Object] → [object
 * Object]`, which is worse than recording nothing.
 */
const SNAPSHOT_FIELDS = [
  'name',
  'atRiskThresholdPercent',
  'businessHours',
  ...PRIORITIES.map((priority) => `targets.${priority}`),
] as const;

function snapshotFor(policy: SlaPolicyRecord): Record<string, string | number> {
  const hours = normalizeBusinessHours(policy.businessHours);
  const snapshot: Record<string, string | number> = {
    name: policy.name,
    atRiskThresholdPercent: policy.atRiskThresholdPercent,
    businessHours: `${hours.timezone} ${formatBusinessWindow(hours)}`,
  };
  for (const priority of PRIORITIES) {
    const budget = policy.targets[priority];
    snapshot[`targets.${priority}`] =
      `${budget.responseMinutes}/${budget.resolutionMinutes} min`;
  }
  return snapshot;
}
