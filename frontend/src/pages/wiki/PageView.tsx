import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronRight,
  CircleDot,
  Hash,
  Plus,
  FileText,
  Paperclip,
  X,
  ArrowRight,
  Library,
  Files,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';

import { PageViewHeader } from './PageViewHeader';
import { extractToc } from './PageViewSidebar';
import { useWikiContext } from './WikiLayout';

import { attachmentsApi } from '@/api/attachments.api';
import { hydrateApi } from '@/api/hydrate.api';
import { wikiIssueLinksApi } from '@/api/wiki-issue-links.api';
import { wikiApi } from '@/api/wiki.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileUpload } from '@/components/ui/FileUpload';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { PageComments } from '@/components/wiki/PageComments';
import { useModalState } from '@/hooks/useModalState';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useWikiInvalidation } from '@/hooks/useWikiInvalidation';
import type { PageTreeNode } from '@/lib/types';
import { useAuthStore } from '@/stores/auth.store';

function TocSidebar({ tocEntries }: { tocEntries: { level: number; text: string; id: string }[] }) {
  if (!tocEntries.length) return null;
  return (
    <aside className="hidden xl:block w-[340px] shrink-0 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface-secondary/50">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            On This Page
          </h3>
        </div>
        <nav className="p-3 space-y-1">
          {tocEntries.map((entry, i) => (
            <Button
              key={`${entry.id}-${i}`}
              variant="ghost"
              size="xs"
              type="button"
              onClick={() => {
                const el = document.getElementById(entry.id);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="w-full justify-start text-sm text-text-secondary hover:text-primary truncate"
              style={{ paddingLeft: `${(entry.level - 1) * 12}px` }}
            >
              <Hash className="h-3 w-3 shrink-0 opacity-40" />
              {entry.text}
            </Button>
          ))}
        </nav>
      </Card>
    </aside>
  );
}

function countTreePages(nodes: PageTreeNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + 1 + (node.children ? countTreePages(node.children) : 0),
    0,
  );
}

/**
 * Page view -- renders a single wiki page or the space overview (no page slug).
 * Sidebar is provided by WikiLayout; this component only renders the content area.
 */
export default function PageView() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const basePath = `/${org}/${team}/wiki/${spaceSlug}`;

  const { currentSpace, currentTeam, tree, setTocEntries } = useWikiContext();
  const { invalidateAttachments } = useWikiInvalidation(currentSpace?.id ?? '', pageSlug);

  const moveModal = useModalState();
  const deleteConfirm = useModalState();
  const [moveTargetParent, setMoveTargetParent] = useState('');

  // Hydration: single request for all wiki page data
  const hydrationQuery = useQuery({
    queryKey: ['wiki-hydrate', currentSpace?.id, pageSlug],
    queryFn: () => hydrateApi.wikiPage(currentSpace!.id, pageSlug!),
    enabled: !!currentSpace?.id && !!pageSlug,
    retry: 1,
    staleTime: 30_000,
  });

  // Seed individual caches from hydration response
  const hydrationMappings = useMemo(
    () => [{ key: ['page', currentSpace?.id, pageSlug], field: 'page' as const }],
    [currentSpace?.id, pageSlug],
  );

  useEffect(() => {
    if (!hydrationQuery.data) return;
    const hd = hydrationQuery.data;
    for (const { key, field } of hydrationMappings) {
      const value = hd[field];
      if (value !== null && value !== undefined) {
        queryClient.setQueryData(key, value);
      }
    }
    const pageId = (hd.page as { id?: string })?.id;
    if (pageId) {
      if (hd.labels !== null) queryClient.setQueryData(['pageLabels', pageId], hd.labels);
      if (hd.attachments !== null)
        queryClient.setQueryData(['attachments', pageId], hd.attachments);
    }
  }, [hydrationQuery.data, hydrationMappings, queryClient]);

  const {
    data: page,
    isLoading,
    error: pageError,
  } = useQuery({
    queryKey: ['page', currentSpace?.id, pageSlug],
    queryFn: () => wikiApi.getPage(currentSpace!.id, pageSlug!),
    enabled: !!currentSpace?.id && !!pageSlug,
  });

  const { data: labels = [] } = useQuery({
    queryKey: ['pageLabels', page?.id],
    queryFn: () => wikiApi.listPageLabels(page!.id),
    enabled:
      !!page?.id &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.labels === null)),
  });

  const { user } = useAuthStore();

  const { data: pageAttachments = [] } = useQuery({
    queryKey: ['attachments', page?.id],
    queryFn: () => attachmentsApi.list({ pageId: page!.id }),
    enabled:
      !!page?.id &&
      (hydrationQuery.isError ||
        (hydrationQuery.isSuccess && hydrationQuery.data?.attachments === null)),
  });

  const deleteAttachmentMutation = useMutationWithToast((id: string) => attachmentsApi.remove(id), {
    successMessage: null,
    invalidateKeys: [['attachments', page?.id]],
  });

  const { data: linkedIssues = [] } = useQuery({
    queryKey: ['wikiLinkedIssues', page?.id],
    queryFn: () => wikiIssueLinksApi.listForPage(page!.id),
    enabled: !!page?.id,
  });

  // Record page view when page loads
  useEffect(() => {
    if (page?.id) {
      wikiApi.recordView(page.id).catch(() => {
        // silently ignore view tracking errors
      });
    }
  }, [page?.id]);

  const pageBody = page?.body ?? '';
  const tocEntries = useMemo(() => (pageBody ? extractToc(pageBody) : []), [pageBody]);

  // Push TOC entries up to WikiLayout whenever page changes
  useEffect(() => {
    setTocEntries(tocEntries);
    return () => setTocEntries([]);
  }, [pageSlug, tocEntries, setTocEntries]);

  const addLabelMutation = useMutationWithToast(
    (label: string) => wikiApi.addPageLabel(page!.id, label),
    {
      successMessage: null,
      errorMessage: 'Failed to add label',
      invalidateKeys: [['pageLabels', page?.id]],
    },
  );

  const removeLabelMutation = useMutationWithToast(
    (label: string) => wikiApi.removePageLabel(page!.id, label),
    { successMessage: null, invalidateKeys: [['pageLabels', page?.id]] },
  );

  const deleteMutation = useMutationWithToast(
    () => wikiApi.deletePage(currentSpace!.id, pageSlug!),
    {
      successMessage: 'Page deleted',
      errorMessage: 'Failed to delete page',
      onSuccess: () => navigate(`/${org}/${team}/wiki/${spaceSlug}`),
    },
  );

  const copyMutation = useMutationWithToast(() => wikiApi.copyPage(page!.id, {}), {
    successMessage: 'Page copied',
    errorMessage: 'Failed to copy page',
    invalidateKeys: [['pageTree', currentSpace?.id]],
    onSuccess: (copied) => navigate(`${basePath}/${copied.slug}`),
  });

  const moveMutation = useMutationWithToast(
    (data: { targetParentId?: string | null }) =>
      wikiApi.movePage(page!.id, { targetParentId: data.targetParentId }),
    {
      successMessage: 'Page moved',
      errorMessage: 'Failed to move page',
      invalidateKeys: [['pageTree', currentSpace?.id]],
      onSuccess: () => moveModal.close(),
    },
  );

  // Fetch first page content for welcome preview
  const firstPageSlug = tree?.[0]?.slug;
  const { data: welcomePage } = useQuery({
    queryKey: ['page', currentSpace?.id, firstPageSlug],
    queryFn: () => wikiApi.getPage(currentSpace!.id, firstPageSlug!),
    enabled: !!currentSpace?.id && !!firstPageSlug && !pageSlug,
  });

  if (isLoading) return <DetailSkeleton />;

  if (pageError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load wiki page</p>
        </div>
      </div>
    );
  }

  // If no page slug, show the space overview
  if (!pageSlug) {
    return (
      <div>
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
                  className="group block bg-surface rounded-lg border border-border overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all"
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
                    className="group bg-surface flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/40 hover:shadow-sm transition-all"
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
      <PageViewHeader
        page={page}
        basePath={basePath}
        pageSlug={pageSlug!}
        spaceId={currentSpace!.id}
        teamId={currentTeam!.id}
        labels={labels}
        onAddLabel={(label) => addLabelMutation.mutate(label)}
        onRemoveLabel={(label) => removeLabelMutation.mutate(label)}
        onMove={() => moveModal.open()}
        onCopy={() => copyMutation.mutate()}
        onDelete={() => deleteConfirm.open()}
      />

      <div className="flex gap-6 items-start">
        <Card className="flex-1 min-w-0 p-6">
          <div className="prose max-w-none leading-relaxed">
            <MarkdownRenderer content={page.body} />
          </div>
        </Card>
        <TocSidebar tocEntries={tocEntries} />
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

      {/* Attachments */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-3 flex items-center gap-2">
          <Paperclip className="h-3.5 w-3.5" />
          Attachments
          {pageAttachments.length > 0 && <Badge size="sm">{pageAttachments.length}</Badge>}
        </h2>
        <AttachmentList
          attachments={pageAttachments}
          currentUserId={user?.id}
          onDelete={(id) => deleteAttachmentMutation.mutate(id)}
        />
        <FileUpload
          className="mt-3"
          uploadFn={(file) => attachmentsApi.upload(file, { pageId: page.id })}
          onUpload={() => invalidateAttachments(page.id)}
        />
      </div>

      {/* Linked Issues */}
      {linkedIssues.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-3 flex items-center gap-2">
            <CircleDot className="h-3.5 w-3.5" />
            Linked Issues
            <Badge size="sm">{linkedIssues.length}</Badge>
          </h2>
          <div className="grid gap-2">
            {linkedIssues.map((link) => (
              <Link
                key={link.id}
                to={`/${link.issue.project.team.org.slug}/${link.issue.project.team.slug}/${link.issue.project.slug}/issues/${link.issue.number}`}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <CircleDot className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-mono font-medium text-text-secondary shrink-0">
                  {link.issue.project.prefix}-{link.issue.number}
                </span>
                <span className="text-sm font-medium text-text truncate">{link.issue.title}</span>
                {link.issue.column && (
                  <Badge size="sm" variant="outline" className="ml-auto shrink-0">
                    {link.issue.column.name}
                  </Badge>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Comments */}
      <div className="mt-8 border-t border-border-light pt-6">
        <PageComments pageId={page.id} />
      </div>

      {/* Move page modal */}
      <Modal open={moveModal.isOpen} onClose={moveModal.close} title="Move Page">
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
            <Button variant="secondary" onClick={moveModal.close}>
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
      <ConfirmDialog
        open={deleteConfirm.isOpen}
        onClose={deleteConfirm.close}
        onConfirm={() => {
          deleteConfirm.close();
          deleteMutation.mutate();
        }}
        title="Delete Page"
        description={`Are you sure you want to delete "${page.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
