import { useQueryClient } from '@tanstack/react-query';

/**
 * Centralizes query invalidation for wiki-related data.
 * @param spaceId - The wiki space ID for scoping query keys
 * @param pageSlug - Optional page slug for single-page invalidation
 */
export function useWikiInvalidation(spaceId: string, pageSlug?: string) {
  const queryClient = useQueryClient();

  return {
    /** Invalidate a single page and its related data (labels, attachments, linked issues) */
    invalidatePage: () => {
      if (pageSlug !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['page', spaceId, pageSlug] });
        queryClient.invalidateQueries({ queryKey: ['pageHistory', spaceId, pageSlug] });
      }
    },
    /** Invalidate page list/tree and space-level queries */
    invalidateList: () => {
      queryClient.invalidateQueries({ queryKey: ['pageTree', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['wikiPageTree', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['wikiSpaces'] });
    },
    /** Invalidate both the single page and all list views */
    invalidateAll: () => {
      if (pageSlug !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['page', spaceId, pageSlug] });
        queryClient.invalidateQueries({ queryKey: ['pageHistory', spaceId, pageSlug] });
      }
      queryClient.invalidateQueries({ queryKey: ['pageTree', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['wikiPageTree', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['wikiSpaces'] });
    },
    /**
     * Invalidate attachments for a specific page by its ID
     * @param pageId
     */
    invalidateAttachments: (pageId: string) => {
      queryClient.invalidateQueries({ queryKey: ['attachments', pageId] });
    },
  };
}
