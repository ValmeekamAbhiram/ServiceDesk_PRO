/**
 * ServiceDesk Pro — the four administrative endpoints.
 *
 * Grouped in one module because they share a shape rather than a subject: each is a
 * single document or an append-only list, none of them is paginated the way tickets
 * are, and all four are read by exactly one page.
 *
 * Two caching decisions worth stating:
 *
 *  - **The SLA policy and the settings are cached for a long time.** They change when
 *    an administrator changes them, and every ticket page reads the policy for its
 *    countdown labels. Re-fetching it per navigation would be traffic for nothing.
 *  - **The audit trail is never cached.** It is append-only and read to answer "what
 *    just happened", so a stale page is worse than a slow one.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AuditLogDto,
  DemoClockDto,
  Paginated,
  SettingsDto,
  SlaPolicyDto,
  UpdateSettingsRequest,
} from '@shared/types';
import { api, type QueryParams } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';

const SETTINGS_STALE_MS = 10 * 60_000;

/* ───────────────────────────── SLA policy ───────────────────────────── */

/**
 * Readable by anyone signed in — the ticket page shows the budget beside the
 * countdown, and an employee is entitled to know what the desk committed to.
 */
export function useSlaPolicy() {
  return useQuery({
    queryKey: keys.slaPolicy,
    queryFn: () => api.get<SlaPolicyDto>('/sla-policy'),
    staleTime: SETTINGS_STALE_MS,
  });
}

/** Only the fields the form touched. Everything absent is left as it was. */
export interface SlaPolicyPatch {
  businessHours?: {
    timezone?: string;
    startMinute?: number;
    endMinute?: number;
    workingDays?: number[];
  };
  atRiskThresholdPercent?: number;
  targets?: Record<string, { responseMinutes?: number; resolutionMinutes?: number }>;
}

export function useUpdateSlaPolicy() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: SlaPolicyPatch) => api.patch<SlaPolicyDto>('/sla-policy', input),
    onSuccess: (policy) => {
      queryClient.setQueryData(keys.slaPolicy, policy);
      /* Business hours and the threshold are read live by the engine, so every
       * countdown on screen is now being measured against different numbers. */
      void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
      void queryClient.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

/* ────────────────────────────── settings ────────────────────────────── */

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<SettingsDto>('/settings'),
    staleTime: SETTINGS_STALE_MS,
  });
}

export function useUpdateSettings() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: UpdateSettingsRequest) => api.patch<SettingsDto>('/settings', input),
    onSuccess: (settings) => {
      queryClient.setQueryData(keys.settings, settings);
      /* Switching demo mode off closes the Time Machine, so its panel has to re-read
       * whether it is allowed to exist. */
      void queryClient.invalidateQueries({ queryKey: keys.demoClock });
    },
  });
}

/* ───────────────────────────── Time Machine ─────────────────────────── */

/**
 * `enabled` is passed by the panel, which only mounts for an administrator. The route
 * needs `demo:control` and answers 403 without it, so asking unconditionally would put
 * a red error in the console of every technician's browser.
 */
export function useDemoClock(enabled: boolean) {
  return useQuery({
    queryKey: keys.demoClock,
    queryFn: () => api.get<DemoClockDto>('/demo/clock'),
    enabled,
    staleTime: 0,
  });
}

/**
 * A jump changes what *every* timestamp in the app means, so this invalidates
 * everything rather than trying to be clever about which queries moved. It is one
 * button press by one administrator on a demo deployment; a full refetch is the
 * honest response to "the clock is now four hours ahead".
 */
function onClockMoved(state: DemoClockDto) {
  queryClient.setQueryData(keys.demoClock, state);
  void queryClient.invalidateQueries();
}

export function useAdvanceClock() {
  return useMutation({
    mutationFn: (minutes: number) => api.post<DemoClockDto>('/demo/clock/advance', { minutes }),
    onSuccess: onClockMoved,
  });
}

export function useResetClock() {
  return useMutation({
    mutationFn: () => api.post<DemoClockDto>('/demo/clock/reset'),
    onSuccess: onClockMoved,
  });
}

/* ─────────────────────────────── audit ──────────────────────────────── */

export interface AuditQuery extends QueryParams {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

/**
 * `placeholderData` keeps the previous page on screen while the next one loads, so
 * paging through the trail does not flash an empty table. `staleTime: 0` because the
 * point of opening this page is to see what happened a moment ago.
 */
export function useAuditLog(query: AuditQuery) {
  return useQuery({
    queryKey: keys.audit.list(query),
    queryFn: () => api.get<Paginated<AuditLogDto>>('/audit', query),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}
