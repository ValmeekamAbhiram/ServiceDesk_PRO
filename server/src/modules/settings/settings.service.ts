/**
 * ServiceDesk Pro — system settings access.
 *
 * One document, same shape of problem as the SLA policy: read on paths that run
 * often, written rarely, so it is cached in process and invalidated on write. The
 * caveat from `sla-policy.service.ts` applies here word for word — a single Node
 * process owns this cache, and it would have to go if the API were ever run
 * multi-instance.
 *
 * The reason the *effective* values live here rather than in the callers: two of
 * these settings are subordinate to the environment, and the direction of that
 * relationship is a security property, not a preference. `demoMode` and
 * `aiSuggestionsEnabled` are each an AND of an env flag and a stored flag, so an
 * admin can switch a feature **off** but can never switch one **on** that the
 * deployment did not enable. Written as `env.X && stored.Y` in one place, that
 * cannot be got backwards; copied into three callers, eventually it is.
 */

import type { HydratedDocument } from 'mongoose';
import { AuditAction, AuditEntity } from '@shared/enums';
import type { SettingsDto, UpdateSettingsRequest } from '@shared/types';
import { isTimeShifted, resetClock } from '@/config/clock';
import { env } from '@/config/env';
import type { ActorContext } from '@/core/actor';
import { SETTINGS_KEY, SystemSettings, toObjectId, type SystemSettingsDoc } from '@/models';
import { diff, record } from '@/modules/audit/audit.service';

let cached: SystemSettingsDoc | null = null;

export async function getSystemSettings(): Promise<SystemSettingsDoc> {
  if (cached) return cached;

  /* Upsert, not find-then-create: see `getSlaPolicy()` for why the race matters. */
  const settings = await SystemSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  cached = settings;
  return settings;
}

/** Call after any write to the settings document. */
export function invalidateSystemSettingsCache(): void {
  cached = null;
}

/**
 * Whether ticket suggestions may run at all. `AI_ENABLED=false` in the environment
 * settles it regardless of what the database says.
 */
export async function suggestionsEnabled(): Promise<boolean> {
  if (!env.AI_ENABLED) return false;
  return (await getSystemSettings()).aiSuggestionsEnabled;
}

/** Same rule for the demo panel: the environment has the final say. */
export async function demoModeActive(): Promise<boolean> {
  if (!env.demoMode) return false;
  return (await getSystemSettings()).demoModeRequested;
}

/* ─────────────────────────────── admin surface ─────────────────────────────── */

/**
 * `getSystemSettings()` returns the interface, which has no `save()` on it. Writers
 * need the hydrated document, so the mutator below narrows to this.
 */
export type SystemSettingsRecord = HydratedDocument<SystemSettingsDoc>;

/**
 * Both effective flags are computed here rather than stored, so the client sees the
 * same AND the server enforces. `demoModeRequested` is sent alongside `demoMode` on
 * purpose: an admin who switches the toggle on a production deployment needs to see
 * that their preference was saved *and* that the feature is still off.
 */
export function toSettingsDto(settings: SystemSettingsDoc): SettingsDto {
  return {
    organizationName: settings.organizationName,
    supportEmail: settings.supportEmail,
    demoMode: env.demoMode && settings.demoModeRequested,
    demoModeRequested: settings.demoModeRequested,
    aiSuggestionsEnabled: env.AI_ENABLED && settings.aiSuggestionsEnabled,
    aiSuggestionsRequested: settings.aiSuggestionsEnabled,
    seeded: settings.seeded,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

const AUDITED_SETTINGS_FIELDS = [
  'organizationName',
  'supportEmail',
  'aiSuggestionsEnabled',
  'demoModeRequested',
] as const;

function auditSnapshot(settings: SystemSettingsDoc): Record<string, unknown> {
  return {
    organizationName: settings.organizationName,
    supportEmail: settings.supportEmail,
    aiSuggestionsEnabled: settings.aiSuggestionsEnabled,
    demoModeRequested: settings.demoModeRequested,
  };
}

/**
 * The only writer. Every field is optional and absent means "leave it", so a client
 * that only knows about two of them cannot blank the third.
 *
 * **Switching `demoModeRequested` off resets the clock**, and it has to. The flag closes
 * the door — `demoModeActive()` goes false and every Time Machine route answers 403 from
 * the next request onwards, `reset` included. Leaving a live offset behind that door
 * would mean the whole application keeps reading a shifted clock, with SLA deadlines
 * measured against a time four hours from now, and no way back short of restarting the
 * process. So the door closes and the clock comes home in the same operation.
 */
export async function saveSettings(
  input: UpdateSettingsRequest,
  actor: ActorContext
): Promise<SettingsDto> {
  const settings = (await getSystemSettings()) as SystemSettingsRecord;
  const before = auditSnapshot(settings);

  if (input.organizationName !== undefined) settings.organizationName = input.organizationName;
  if (input.supportEmail !== undefined) settings.supportEmail = input.supportEmail;
  if (input.aiSuggestionsEnabled !== undefined) {
    settings.aiSuggestionsEnabled = input.aiSuggestionsEnabled;
  }
  if (input.demoModeRequested !== undefined) settings.demoModeRequested = input.demoModeRequested;
  settings.updatedById = toObjectId(actor.user.id);

  /* Read before the save, because the audit summary below wants to say what happened. */
  const closingTheDoor =
    input.demoModeRequested === false && env.demoMode && isTimeShifted();
  if (closingTheDoor) resetClock();

  await settings.save();
  /* Before the audit write, for the reason given in `saveSlaPolicy()`: if recording
   * the entry throws, the next read must still see the new values rather than a cache
   * the writer never cleared. */
  invalidateSystemSettingsCache();

  await record(
    {
      action: AuditAction.SETTINGS_UPDATED,
      entityType: AuditEntity.SETTINGS,
      entityId: null,
      entityLabel: 'System settings',
      summary: closingTheDoor
        ? 'Updated the system settings and returned the clock to real time'
        : 'Updated the system settings',
      changes: diff(before, auditSnapshot(settings), AUDITED_SETTINGS_FIELDS),
    },
    actor
  );

  return toSettingsDto(settings);
}
