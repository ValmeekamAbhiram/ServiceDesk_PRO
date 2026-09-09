/**
 * ServiceDesk Pro — asset hooks.
 *
 * The update mutation takes the whole asset, not just the fields being changed,
 * because `version` has to travel with the patch and the caller already holds the
 * loaded record. A 409 comes back as `ApiClientError.isVersionConflict`, which the
 * form turns into "somebody else saved first" rather than a toast about numbers.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import type { AssetDto, AssetInput, AssetListQuery, Paginated } from '@shared/types';
import { api, type QueryParams } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';

export type AssetQuery = AssetListQuery & {
  sortBy?: 'name' | 'tag' | 'createdAt' | 'warrantyExpiryDate';
  sortOrder?: 'asc' | 'desc';
};

/* Spelled out rather than spread, so a stray form field never reaches the wire. */
const asParams = (query: AssetQuery): QueryParams => ({
  page: query.page,
  limit: query.limit,
  sortBy: query.sortBy,
  sortOrder: query.sortOrder,
  q: query.q,
  type: query.type,
  status: query.status,
  assignedToId: query.assignedToId,
  warrantyWithinDays: query.warrantyWithinDays,
});

export function useAssets(query: AssetQuery, enabled = true) {
  return useQuery({
    queryKey: keys.assets.list(query),
    queryFn: () => api.get<Paginated<AssetDto>>('/assets', asParams(query)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useAsset(id: string | undefined) {
  return useQuery({
    queryKey: keys.assets.detail(id ?? 'none'),
    queryFn: () => api.get<AssetDto>(`/assets/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateAsset() {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: AssetInput) => api.post<AssetDto>('/assets', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.assets.all }),
  });
}

export function useUpdateAsset(id: string) {
  return useMutation({
    meta: { silent: true },
    mutationFn: (input: Partial<AssetInput> & { version: number }) =>
      api.patch<AssetDto>(`/assets/${id}`, input),
    onSuccess: (asset) => {
      queryClient.setQueryData(keys.assets.detail(id), asset);
      void queryClient.invalidateQueries({ queryKey: keys.assets.all });
      /* An asset's name is embedded in the tickets that link to it. */
      void queryClient.invalidateQueries({ queryKey: keys.tickets.all });
    },
  });
}
