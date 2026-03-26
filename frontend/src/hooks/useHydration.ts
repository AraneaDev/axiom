import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface HydrationMapping<T> {
  queryKey: QueryKey;
  field: keyof T;
}

/**
 * Seeds React Query cache from a hydration response.
 * Only seeds non-null fields (null means partial backend failure).
 */
export function useHydrationSeeder<T extends Record<string, unknown>>(
  data: T | undefined,
  mappings: HydrationMapping<T>[],
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!data) return;
    for (const { queryKey, field } of mappings) {
      const value = data[field];
      if (value !== null && value !== undefined) {
        queryClient.setQueryData(queryKey, value);
      }
    }
  }, [data, mappings, queryClient]);
}
