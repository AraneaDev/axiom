/* eslint-disable react-refresh/only-export-components */
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronDown, FolderPlus, Library, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router';

import { CreateFolderModal } from './CreateFolderModal';
import { PageViewSidebar } from './PageViewSidebar';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import type { PageTreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

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
        _count?: { pages: number };
      }>
    | undefined;
  tree: PageTreeNode[] | undefined;
  setTocEntries: (entries: TocEntry[]) => void;
}

/**
 * Hook for child routes to access wiki context from WikiLayout.
 */
export function useWikiContext() {
  return useOutletContext<WikiContextValue>();
}

/**
 * Persistent two-column layout for all wiki views.
 * Left sidebar: space name, page tree, TOC.
 * Right content area: child route via Outlet.
 */
export default function WikiLayout() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();

  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderModalParent, setFolderModalParent] = useState<string | undefined>(undefined);

  // Fetch org -> team -> spaces chain
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === team);

  const { data: spaces } = useQuery({
    queryKey: ['wikiSpaces', currentTeam?.id],
    queryFn: () => wikiApi.listSpaces(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentSpace = spaces?.find((s) => s.slug === spaceSlug);

  const { data: tree } = useQuery({
    queryKey: ['pageTree', currentSpace?.id],
    queryFn: () => wikiApi.getPageTree(currentSpace!.id),
    enabled: !!currentSpace?.id,
  });

  const basePath = `/${org}/${team}/wiki/${spaceSlug}`;

  const handleNewFolder = useCallback((parentId?: string) => {
    setFolderModalParent(parentId);
    setShowFolderModal(true);
  }, []);

  const contextValue = useMemo<WikiContextValue>(
    () => ({
      currentOrg,
      currentTeam,
      currentSpace,
      spaces,
      tree,
      setTocEntries,
    }),
    [currentOrg, currentTeam, currentSpace, spaces, tree],
  );

  // When no space is selected, show a simplified sidebar with space list
  const showSpaceTree = !!spaceSlug && !!currentSpace;

  return (
    <div className="flex gap-6">
      {/* Persistent sidebar */}
      <aside className="hidden lg:block w-[280px] shrink-0 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
        {showSpaceTree ? (
          <>
            {/* Space heading / selector */}
            {spaces && spaces.length > 1 ? (
              <Dropdown
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md hover:bg-surface-tertiary transition-colors mb-3"
                  >
                    <Library className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold text-text truncate flex-1">
                      {currentSpace.name}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                  </button>
                }
                align="left"
              >
                {spaces.map((s) => (
                  <DropdownItem key={s.id}>
                    <Link
                      to={`/${org}/${team}/wiki/${s.slug}`}
                      className="flex items-center gap-2 w-full"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      {s.name}
                    </Link>
                  </DropdownItem>
                ))}
              </Dropdown>
            ) : (
              <div className="flex items-center gap-2 px-2 py-1.5 mb-3">
                <Library className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-semibold text-text truncate">
                  {currentSpace.name}
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-1 mb-3 px-1">
              <Link to={`${basePath}/new/edit`} className="flex-1">
                <Button variant="ghost" size="xs" className="w-full justify-start">
                  <Plus className="h-3.5 w-3.5" /> New Page
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="xs"
                title="New Folder"
                onClick={() => handleNewFolder()}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Page tree */}
            <PageViewSidebar
              tree={tree}
              basePath={basePath}
              tocEntries={[]}
              activeSlug={pageSlug}
              onNewFolder={handleNewFolder}
              embedded
            />
          </>
        ) : (
          <>
            {/* Wiki home sidebar: list of spaces */}
            <div className="flex items-center gap-2 px-2 py-1.5 mb-3">
              <Library className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-text">Wiki Spaces</span>
            </div>
            {spaces?.map((s) => (
              <Link
                key={s.id}
                to={`/${org}/${team}/wiki/${s.slug}`}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-surface-tertiary transition-colors',
                  s.slug === spaceSlug && 'bg-primary-light text-primary font-medium',
                )}
              >
                <BookOpen className="h-3.5 w-3.5 text-text-secondary" />
                <span className="truncate">{s.name}</span>
                {s._count?.pages != null && (
                  <span className="ml-auto text-xs text-text-tertiary">{s._count.pages}</span>
                )}
              </Link>
            ))}
          </>
        )}
      </aside>

      {/* Content area */}
      <main className="flex-1 min-w-0">
        <Outlet context={contextValue} />
      </main>

      {/* Right sidebar: Table of Contents -- mt-24 aligns with page body below header */}
      {tocEntries.length > 0 && (
        <aside className="hidden xl:block w-[220px] shrink-0 mt-24 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
            On This Page
          </h3>
          <nav className="space-y-1">
            {tocEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  const el = document.getElementById(entry.id);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="block w-full text-left text-sm text-text-secondary hover:text-primary transition-colors truncate"
                style={{ paddingLeft: `${(entry.level - 1) * 12}px` }}
              >
                {entry.text}
              </button>
            ))}
          </nav>
        </aside>
      )}

      {/* Folder modal */}
      {currentSpace?.id && (
        <CreateFolderModal
          open={showFolderModal}
          onClose={() => setShowFolderModal(false)}
          spaceId={currentSpace.id}
          parentId={folderModalParent}
          onCreated={() => {
            // Tree query will be invalidated by the modal itself
          }}
        />
      )}
    </div>
  );
}
