import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const REFUSALS = new Set([401, 403, 404]);

/**
 * Whether the server said no to this user, rather than failing to answer.
 * @param error - What a query failed with
 */
function isRefusal(error: unknown): error is Error {
  return REFUSALS.has((error as { status?: number } | null)?.status ?? 0);
}

/**
 * A query for something the user can lose access to. React Query keeps the last data when a refetch
 * fails, which is right for a server that is busy or down and wrong for one that refused: then the
 * data goes from the screen and the cache, and it is not asked for again.
 * @param queryKey - The query's key
 * @param queryFn - What fetches it
 * @param options - Passed on to the query
 * @param options.refetchOnWindowFocus - Whether to refetch when the window gets focus
 * @returns The query's data and state, and the server's message once it refused
 */
export function useRefusableQuery<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  options: { refetchOnWindowFocus?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const identity = JSON.stringify(queryKey);
  const [refused, setRefused] = useState<{ identity: string; message: string } | null>(null);
  const known = refused?.identity === identity ? refused.message : null;

  const { data, isLoading, error } = useQuery({
    ...options,
    queryKey,
    queryFn,
    enabled: known === null,
    retry: (failures, err) => !isRefusal(err) && failures < 1,
  });
  const refusal = isRefusal(error) ? error.message : null;

  // Set while rendering, so that no frame shows the data of a refused query
  if (refusal !== null && known === null) setRefused({ identity, message: refusal });

  useEffect(() => {
    if (known !== null) queryClient.removeQueries({ queryKey: JSON.parse(identity) as QueryKey });
  }, [known, identity, queryClient]);

  const refusedWith = refusal ?? known;
  return {
    data: refusedWith === null ? data : undefined,
    isLoading: refusedWith === null && isLoading,
    error: refusedWith === null ? error : null,
    refusedWith,
  };
}
