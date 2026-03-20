import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, FileText, X, ArrowRight, Trash2, Library, Files } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';

import { PageViewHeader } from './PageViewHeader';
import { PageViewSidebar, extractToc } from './PageViewSidebar';

import { wikiApi } from '@/api/wiki.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { PageComments } from '@/components/wiki/PageComments';
import type { PageTreeNode } from '@/lib/types';

function countTreePages(nodes: PageTreeNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + 1 + (node.children ? countTreePages(node.children) : 0),
    0,
  );
}

/**
 *
 */
export default function PageView() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const basePath = `/${org}/${team}/wiki/${spaceSlug}`;

  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [moveTargetParent, setMoveTargetParent] = useState('');

  // We need spaceId -- get it from spaces list
  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => import('@/api/orgs.api').then((m) => m.orgsApi.list()),
  });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => import('@/api/teams.api').then((m) => m.teamsApi.listByOrg(currentOrg!.id)),
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

  const { data: page, isLoading } = useQuery({
    queryKey: ['page', currentSpace?.id, pageSlug],
    queryFn: () => wikiApi.getPage(currentSpace!.id, pageSlug!),
    enabled: !!currentSpace?.id && !!pageSlug,
  });

  const { data: labels = [] } = useQuery({
    queryKey: ['pageLabels', page?.id],
    queryFn: () => wikiApi.listPageLabels(page!.id),
    enabled: !!page?.id,
  });

  const tocEntries = useMemo(() => (page?.body ? extractToc(page.body) : []), [page?.body]);

  const addLabelMutation = useMutation({
    mutationFn: (label: string) => wikiApi.addPageLabel(page!.id, label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageLabels', page?.id] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to add label'),
  });

  const removeLabelMutation = useMutation({
    mutationFn: (label: string) => wikiApi.removePageLabel(page!.id, label),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pageLabels', page?.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => wikiApi.deletePage(currentSpace!.id, pageSlug!),
    onSuccess: () => {
      toast.success('Page deleted');
      navigate(`/${org}/${team}/wiki/${spaceSlug}`);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to delete page'),
  });

  const copyMutation = useMutation({
    mutationFn: () => wikiApi.copyPage(page!.id, {}),
    onSuccess: (copied) => {
      toast.success('Page copied');
      queryClient.invalidateQueries({ queryKey: ['pageTree', currentSpace?.id] });
      navigate(`${basePath}/${copied.slug}`);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to copy page'),
  });

  const moveMutation = useMutation({
    mutationFn: (data: { targetParentId?: string | null }) =>
      wikiApi.movePage(page!.id, { targetParentId: data.targetParentId }),
    onSuccess: () => {
      toast.success('Page moved');
      queryClient.invalidateQueries({ queryKey: ['pageTree', currentSpace?.id] });
      setShowMoveModal(false);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to move page'),
  });

  // Fetch first page content for welcome preview
  const firstPageSlug = tree?.[0]?.slug;
  const { data: welcomePage } = useQuery({
    queryKey: ['page', currentSpace?.id, firstPageSlug],
    queryFn: () => wikiApi.getPage(currentSpace!.id, firstPageSlug!),
    enabled: !!currentSpace?.id && !!firstPageSlug && !pageSlug,
  });

  if (isLoading) return <DetailSkeleton />;

  // If no page slug, show the space overview
  if (!pageSlug) {
    return (
      <div className="max-w-5xl mx-auto">
        {/* Hero section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center">
                <Library className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-text">{currentSpace?.name ?? 'Wiki'}</h1>
                {currentSpace?.description && (
                  <p className="text-sm text-text-secondary mt-0.5">{currentSpace.description}</p>
                )}
              </div>
            </div>
            <Link to={`${basePath}/new`}>
              <Button size="sm">
                <Plus className="h-4 w-4" /> New Page
              </Button>
            </Link>
          </div>
          {tree && tree.length > 0 && (
            <div className="flex items-center gap-4 mt-3 text-xs text-text-tertiary">
              <span className="flex items-center gap-1">
                <Files className="h-3.5 w-3.5" />
                {countTreePages(tree)} pages
              </span>
            </div>
          )}
        </div>

        {!tree?.length ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No pages yet"
            description="Create your first page."
          />
        ) : (
          <>
            {/* Welcome page preview (first page rendered inline) */}
            {welcomePage?.body && (
              <div className="mb-8">
                <Link
                  to={`${basePath}/${welcomePage.slug}`}
                  className="group block rounded-xl border border-border bg-surface overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <div className="px-6 py-4 border-b border-border-light bg-surface-secondary/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-text">{welcomePage.title}</span>
                    </div>
                    <span className="text-xs text-text-tertiary group-hover:text-primary transition-colors flex items-center gap-1">
                      Read more <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                  <div className="px-6 py-5 max-h-64 overflow-hidden relative">
                    <div className="prose max-w-none text-sm leading-relaxed pointer-events-none">
                      <MarkdownRenderer content={welcomePage.body} />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface to-transparent" />
                  </div>
                </Link>
              </div>
            )}

            {/* Page index as cards */}
            <div>
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                All Pages
              </h2>
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                {tree.map((node) => (
                  <Link
                    key={node.id}
                    to={`${basePath}/${node.slug}`}
                    className="group flex items-start gap-3 p-4 rounded-lg border border-border bg-surface hover:border-primary/40 hover:shadow-sm transition-all"
                  >
                    <div className="h-8 w-8 rounded-md bg-primary-light flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-text group-hover:text-primary transition-colors truncate">
                        {node.title}
                      </h3>
                      {node.children && node.children.length > 0 && (
                        <p className="text-xs text-text-tertiary mt-1">
                          {node.children.length} sub-page{node.children.length !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-text-tertiary group-hover:text-primary shrink-0 mt-1 transition-colors" />
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!page) return <EmptyState title="Page not found" />;

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Page tree sidebar */}
        <PageViewSidebar tree={tree} basePath={basePath} tocEntries={tocEntries} />

        {/* Page content */}
        <div className="col-span-4 lg:col-span-3">
          <PageViewHeader
            page={page}
            basePath={basePath}
            pageSlug={pageSlug!}
            spaceId={currentSpace!.id}
            labels={labels}
            onAddLabel={(label) => addLabelMutation.mutate(label)}
            onRemoveLabel={(label) => removeLabelMutation.mutate(label)}
            onMove={() => setShowMoveModal(true)}
            onCopy={() => copyMutation.mutate()}
            onDelete={() => setShowDeleteConfirm(true)}
          />

          <div className="rounded-lg border border-border bg-surface p-6">
            <div className="prose max-w-4xl leading-relaxed">
              <MarkdownRenderer content={page.body} />
            </div>
          </div>

          {/* Child pages */}
          {page.children && page.children.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">Child Pages</h2>
              <div className="grid gap-2">
                {page.children.map((child) => (
                  <Link
                    key={child.id}
                    to={`${basePath}/${child.slug}`}
                    className="flex items-center gap-2 p-3 rounded-lg border border-border hover:border-primary/50 transition-all"
                  >
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{child.title}</span>
                    <ChevronRight className="h-4 w-4 ml-auto text-text-secondary" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="mt-8 border-t border-border-light pt-6">
            <PageComments pageId={page.id} />
          </div>
        </div>
      </div>

      {/* Move page modal */}
      <Modal open={showMoveModal} onClose={() => setShowMoveModal(false)} title="Move Page">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Move &quot;{page.title}&quot; to a new parent page. Leave empty to move to root level.
          </p>
          <Input
            id="move-parent"
            label="Parent page ID (leave empty for root)"
            value={moveTargetParent}
            onChange={(e) => setMoveTargetParent(e.target.value)}
            placeholder="Parent page ID"
          />
          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowMoveModal(false)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              onClick={() =>
                moveMutation.mutate({
                  targetParentId: moveTargetParent.trim() || null,
                })
              }
              disabled={moveMutation.isPending}
            >
              <ArrowRight className="h-4 w-4" /> Move
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete Page"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to delete &quot;{page.title}&quot;? This action cannot be undone.
          </p>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setShowDeleteConfirm(false);
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
}
