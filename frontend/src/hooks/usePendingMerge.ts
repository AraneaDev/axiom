import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { wikiApi } from '@/api/wiki.api';
import { countMergeChanges, mergeMarkdown, type MergeHunk } from '@/editor-core/merge';
import type { PendingMerge } from '@/lib/types';

/**
 * Query key prefix for a page's pending merge; invalidate it to reload.
 * @param spaceId
 * @param pageSlug
 */
export const pendingMergeKey = (spaceId: string, pageSlug: string) =>
  ['pendingMerge', spaceId, pageSlug] as const;

/**
 * Full query key of one pending change's merge.
 * @param spaceId
 * @param pageSlug
 * @param externalVersionId
 */
export const pendingMergeQueryKey = (
  spaceId: string,
  pageSlug: string,
  externalVersionId: string,
) => [...pendingMergeKey(spaceId, pageSlug), externalVersionId] as const;

/**
 * Run the three-way merge over a loaded pending merge.
 * @param data
 */
export function computeMerge(data: PendingMerge): ComputedMerge {
  const { merged, hunks } = mergeMarkdown(data.base, data.ours, data.theirs);
  return { merged, hunks, counts: countMergeChanges(data.base, data.ours, data.theirs, hunks) };
}

export interface ComputedMerge {
  /** The merged Markdown, or null when there are conflicts */
  merged: string | null;
  hunks: MergeHunk[];
  counts: { clean: number; conflicts: number };
}

/**
 * Load the pending merge of a page and run the three-way merge over it.
 * @param spaceId
 * @param pageSlug
 * @param externalVersionId - The pending change this merge is for; a newer one reloads
 * @param enabled - Whether to load at all (only editors may)
 * @returns The query, the computed merge, and whether the user may not merge (403)
 */
export function usePendingMerge(
  spaceId: string | undefined,
  pageSlug: string | undefined,
  externalVersionId: string | undefined,
  enabled = true,
) {
  const query = useQuery({
    queryKey: pendingMergeQueryKey(spaceId ?? '', pageSlug ?? '', externalVersionId ?? ''),
    queryFn: () => wikiApi.getPendingMerge(spaceId!, pageSlug!),
    enabled: enabled && !!spaceId && !!pageSlug && !!externalVersionId,
    // A refetch on focus would only reshuffle a merge the user is in the middle of resolving
    refetchOnWindowFocus: false,
    retry: (count, err) => (err as { status?: number }).status !== 403 && count < 2,
  });

  const merge = useMemo<ComputedMerge | null>(() => {
    return query.data ? computeMerge(query.data) : null;
  }, [query.data]);

  const forbidden = (query.error as { status?: number } | null)?.status === 403;

  return { query, pending: query.data ?? null, merge, forbidden };
}
