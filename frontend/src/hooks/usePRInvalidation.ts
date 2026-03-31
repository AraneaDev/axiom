import { useQueryClient } from '@tanstack/react-query';

/**
 * Centralizes query invalidation for PR-related data.
 * @param repoId - The repository ID for scoping query keys
 * @param prNumber - Optional PR number for single-PR invalidation
 */
export function usePRInvalidation(repoId: string, prNumber?: number) {
  const queryClient = useQueryClient();

  return {
    /** Invalidate the single PR, its diff, commits, statuses, and code owners */
    invalidatePR: () => {
      if (prNumber !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['pr', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prDiff', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prCommits', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prStatuses', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prCodeOwners', repoId, prNumber] });
      }
    },
    /** Invalidate PR list views */
    invalidateList: () => {
      queryClient.invalidateQueries({ queryKey: ['prs', repoId] });
    },
    /** Invalidate both the single PR and all list views */
    invalidateAll: () => {
      if (prNumber !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['pr', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prDiff', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prCommits', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prStatuses', repoId, prNumber] });
        queryClient.invalidateQueries({ queryKey: ['prCodeOwners', repoId, prNumber] });
      }
      queryClient.invalidateQueries({ queryKey: ['prs', repoId] });
    },
  };
}
