import { useOutletContext } from 'react-router';

import type { PageTreeNode } from '@/lib/types';
import type { TocEntry } from '@/lib/wiki-types';

interface WikiContextValue {
  currentOrg: { id: string; slug: string; name: string } | undefined;
  currentTeam: { id: string; slug: string; name: string } | undefined;
  currentSpace: { id: string; slug: string; name: string; description?: string } | undefined;
  spaces:
    | Array<{
        id: string;
        slug: string;
        name: string;
        description?: string;
        isArchived?: boolean;
        canManage?: boolean;
        _count?: { pages: number };
      }>
    | undefined;
  tree: PageTreeNode[] | undefined;
  setTocEntries: (entries: TocEntry[]) => void;
}

/**
 *
 */
export function useWikiContext() {
  return useOutletContext<WikiContextValue>();
}
