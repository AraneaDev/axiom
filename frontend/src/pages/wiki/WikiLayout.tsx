/* eslint-disable react-refresh/only-export-components */
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronDown, FolderPlus, Library, Plus, Search, Star } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router';

import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useModalState } from '@/hooks/useModalState';
import { useRealtimeRoom } from '@/hooks/useRealtimeInvalidation';
import { useTeamContext } from '@/hooks/useTeamContext';
import type { PageTreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { TocEntry } from '@/lib/wiki-types';

import { CreateFolderModal } from './CreateFolderModal';
import { PageViewSidebar } from './PageViewSidebar';

export { useWikiContext } from '@/hooks/useWikiContext';

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
        _count?: { pages: number };
      }>
    | undefined;
  tree: PageTreeNode[] | undefined;
  setTocEntries: (entries: TocEntry[]) => void;
}

/**
 * Persistent two-column layout for all wiki views.
 * Left sidebar: space name, page tree, TOC.
 * Right content area: child route via Outlet.
 */
export default function WikiLayout() {
  const { org, teamSlug: team, currentOrg, currentTeam } = useTeamContext();
  const { space: spaceSlug, page: pageSlug } = useParams();

  const navigate = useNavigate();
  const [, setTocEntries] = useState<TocEntry[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const folderModal = useModalState();
  const [folderModalParent, setFolderModalParent] = useState<string | undefined>(undefined);

  const { data: spaces, isLoading: spacesLoading } = useQuery({
    queryKey: ['wikiSpaces', currentTeam?.id],
    queryFn: () => wikiApi.listSpaces(currentTeam!.id, true),
    enabled: !!currentTeam?.id,
  });
  const currentSpace = spaces?.find((s) => s.slug === spaceSlug);
  // Join the space's realtime room once the space has loaded
  useRealtimeRoom(currentSpace ? `space:${currentSpace.id}` : null);

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['pageTree', currentSpace?.id],
    queryFn: () => wikiApi.getPageTree(currentSpace!.id),
    enabled: !!currentSpace?.id,
  });

  const { data: starredPages } = useQuery({
    queryKey: ['starredPages'],
    queryFn: () => wikiApi.getStarredPages(),
    staleTime: 30_000,
  });

  const basePath = `/${org}/${team}/wiki/${spaceSlug}`;

  const handleNewFolder = useCallback(
    (parentId?: string) => {
      setFolderModalParent(parentId);
      folderModal.open();
    },
    [folderModal],
  );

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
      <aside className="hidden lg:block w-[280px] shrink-0 sticky top-20 self-start min-h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] overflow-y-auto">
        {showSpaceTree ? (
          <>
            {/* Space heading / selector */}
            {spaces && spaces.filter((s) => !s.isArchived).length > 1 ? (
              <Dropdown
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2 w-full justify-start px-2 py-1.5 mb-3"
                  >
                    <Library className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold text-text truncate flex-1">
                      {currentSpace.name}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                  </Button>
                }
                align="left"
              >
                {spaces
                  .filter((s) => !s.isArchived)
                  .map((s) => (
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

            {/* Space search */}
            <form
              className="mb-3 px-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (searchInput.trim() && currentSpace) {
                  navigate(
                    `/search?q=${encodeURIComponent(searchInput.trim())}&type=wiki&spaceId=${currentSpace.id}`,
                  );
                  setSearchInput('');
                }
              }}
            >
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary pointer-events-none" />
                <Input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search in space..."
                  className="h-7 pl-7 text-xs w-full"
                />
              </div>
            </form>

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

            {/* Starred pages */}
            {starredPages &&
              starredPages.filter((s) => s.page.spaceId === currentSpace?.id).length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                    <Star className="h-3 w-3" />
                    Starred
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {starredPages
                      .filter((s) => s.page.spaceId === currentSpace?.id)
                      .map((s) => (
                        <Link
                          key={s.id}
                          to={`${basePath}/${s.page.slug}`}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1 rounded-md text-sm hover:bg-surface-tertiary transition-colors',
                            s.page.slug === pageSlug && 'bg-primary-light text-primary font-medium',
                          )}
                        >
                          <Star className="h-3 w-3 fill-warning text-warning shrink-0" />
                          <span className="truncate">{s.page.title}</span>
                        </Link>
                      ))}
                  </div>
                </div>
              )}

            {/* Page tree */}
            {treeLoading ? (
              <div className="flex items-center justify-center py-4">
                <Spinner className="h-4 w-4" />
              </div>
            ) : (
              <PageViewSidebar
                tree={tree}
                basePath={basePath}
                tocEntries={[]}
                activeSlug={pageSlug}
                onNewFolder={handleNewFolder}
                embedded
                spaceId={currentSpace?.id}
              />
            )}
          </>
        ) : (
          <>
            {/* Wiki home sidebar: list of spaces */}
            <div className="flex items-center gap-2 px-2 py-1.5 mb-3">
              <Library className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-text">Wiki Spaces</span>
            </div>
            {spacesLoading ? (
              <div className="flex items-center justify-center py-4">
                <Spinner className="h-4 w-4" />
              </div>
            ) : (
              spaces
                ?.filter((s) => !s.isArchived)
                .map((s) => (
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
                ))
            )}
          </>
        )}
      </aside>

      {/* Content area */}
      <main className="flex-1 min-w-0">
        <Outlet context={contextValue} />
      </main>

      {/* Folder modal */}
      {currentSpace?.id && (
        <CreateFolderModal
          open={folderModal.isOpen}
          onClose={folderModal.close}
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
