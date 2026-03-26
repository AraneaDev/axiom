import { useQueryClient } from '@tanstack/react-query';

/**
 * Centralizes query invalidation for issue-related data.
 * @param projectId - The project ID for scoping query keys
 * @param issueNum - Optional issue number (as string) for single-issue invalidation
 */
export function useIssueInvalidation(projectId: string, issueNum?: string) {
  const queryClient = useQueryClient();

  return {
    /** Invalidate the single issue and its activity feed */
    invalidateIssue: () => {
      if (issueNum !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['issue', projectId, issueNum] });
        queryClient.invalidateQueries({ queryKey: ['activity', projectId, issueNum] });
      }
    },
    /** Invalidate list views: issues table, board, and backlog */
    invalidateList: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['board', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    },
    /** Invalidate both the single issue and all list views */
    invalidateAll: () => {
      if (issueNum !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['issue', projectId, issueNum] });
        queryClient.invalidateQueries({ queryKey: ['activity', projectId, issueNum] });
      }
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['board', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    },
    /** Invalidate worklogs for the current issue */
    invalidateWorklogs: () => {
      if (issueNum !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['worklogs', projectId, issueNum] });
      }
    },
    /** Invalidate sprint-related queries */
    invalidateSprints: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    },
  };
}
