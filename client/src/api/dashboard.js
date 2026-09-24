/**
 * ServiceDesk Pro — dashboard hook.
 *
 * One request answers the whole page. The server builds it from a handful of
 * aggregations scoped to the caller, so an employee's dashboard counts their own
 * tickets and a technician's counts the queue — which is why there is no query
 * parameter for "whose numbers".
 *
 * `staleTime` is shorter than the global default because these are counts people
 * watch, and `refetchOnWindowFocus` earns its keep here: coming back to the tab is
 * exactly when a stale KPI is noticed.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query';
export function useDashboard() {
    return useQuery({
        queryKey: keys.dashboard.all,
        queryFn: () => api.get('/dashboard'),
        staleTime: 15_000,
        refetchOnWindowFocus: true,
    });
}
