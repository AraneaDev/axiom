import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Edit,
  History,
  ChevronRight,
  Plus,
  FileText,
  Hash,
  Download,
  FileType,
  BookOpen,
  FileCode,
  Type,
  Tag,
  X,
  ArrowRight,
  Copy,
  Trash2,
  MoreVertical,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';

import { wikiApi } from '@/api/wiki.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { PageComments } from '@/components/wiki/PageComments';
import type { PageTreeNode } from '@/lib/types';
import { cn, formatRelative } from '@/lib/utils';

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function extractToc(markdown: string): TocEntry[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const entries: TocEntry[] = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    entries.push({ level: match[1].length, text, id });
  }
  return entries;
}

function TableOfContents({ entries }: { entries: TocEntry[] }) {
  if (!entries.length) return null;

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav className="space-y-1">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
        On this page
      </h3>
      {entries.map((entry, i) => (
        <Button
          key={`${entry.id}-${i}`}
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => scrollTo(entry.id)}
          className={cn(
            'w-full justify-start text-text-tertiary hover:text-primary truncate',
            entry.level === 1 && 'font-medium text-text-secondary',
            entry.level === 2 && 'pl-3',
            entry.level === 3 && 'pl-6 text-xs',
          )}
        >
          <Hash className="h-3 w-3" /> {entry.text}
        </Button>
      ))}
    </nav>
  );
}

interface PageCrumb {
  title: string;
  slug: string;
  parent?: PageCrumb;
}

function Breadcrumbs({
  page,
  basePath,
}: {
  page: { parent?: PageCrumb; title: string; slug: string };
  basePath: string;
}) {
  const crumbs: { title: string; slug: string }[] = [];
  let current = page?.parent;
  while (current) {
    crumbs.unshift({ title: current.title, slug: current.slug });
    current = current.parent;
  }
  if (!crumbs.length) return null;
  return (
    <nav className="flex items-center gap-1 text-xs text-text-tertiary mb-3 flex-wrap">
      {crumbs.map((crumb) => (
        <span key={crumb.slug} className="flex items-center gap-1">
          <Link to={`${basePath}/${crumb.slug}`} className="hover:text-primary transition-colors">
            {crumb.title}
          </Link>
          <ChevronRight className="h-3 w-3" />
        </span>
      ))}
      <span className="text-text-secondary font-medium">{page.title}</span>
    </nav>
  );
}

function TreeNode({
  node,
  basePath,
  depth = 0,
}: {
  node: PageTreeNode;
  basePath: string;
  depth?: number;
}) {
  return (
    <div>
      <Link
        to={`${basePath}/${node.slug}`}
        className="flex items-center gap-2 py-1.5 px-2 rounded-md text-sm hover:bg-surface-tertiary transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText className="h-3.5 w-3.5 text-text-secondary shrink-0" />
        <span className="truncate">{node.title}</span>
      </Link>
      {node.children?.map((child) => (
        <TreeNode key={child.id} node={child} basePath={basePath} depth={depth + 1} />
      ))}
    </div>
  );
}

const EXPORT_FORMATS = [
  { key: 'html', label: 'HTML', icon: FileCode },
  { key: 'docx', label: 'Word (DOCX)', icon: FileType },
  { key: 'epub', label: 'EPUB', icon: BookOpen },
  { key: 'pdf', label: 'PDF', icon: FileText },
  { key: 'latex', label: 'LaTeX', icon: FileCode },
  { key: 'plain', label: 'Plain Text', icon: Type },
];

function ExportDropdown({ spaceId, pageSlug }: { spaceId: string; pageSlug: string }) {
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  async function handleExport(format: string) {
    setExporting(true);
    try {
      await wikiApi.exportPage(spaceId, pageSlug, format);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dropdown
      align="right"
      trigger={
        <Button variant="ghost" size="sm" disabled={exporting}>
          {exporting ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />} Export
        </Button>
      }
    >
      {EXPORT_FORMATS.map(({ key, label, icon: Icon }) => (
        <DropdownItem key={key} onClick={() => handleExport(key)}>
          <Icon className="h-4 w-4" /> {label}
        </DropdownItem>
      ))}
    </Dropdown>
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

  const [labelInput, setLabelInput] = useState('');
  const [showAddLabel, setShowAddLabel] = useState(false);
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
      setLabelInput('');
      setShowAddLabel(false);
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

  if (isLoading) return <PageLoader />;

  // If no page slug, show the space overview with tree
  if (!pageSlug) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{currentSpace?.name ?? 'Wiki'}</h1>
          <Link to={`${basePath}/new`}>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New Page
            </Button>
          </Link>
        </div>
        {!tree?.length ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No pages yet"
            description="Create your first page."
          />
        ) : (
          <div className="rounded-lg border border-border bg-surface p-2">
            {tree.map((node) => (
              <TreeNode key={node.id} node={node} basePath={basePath} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!page) return <EmptyState title="Page not found" />;

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Page tree sidebar */}
        <div className="col-span-1 hidden lg:block">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Pages
          </h3>
          <div className="space-y-0.5 mb-6">
            {tree?.map((node) => (
              <TreeNode key={node.id} node={node} basePath={basePath} />
            ))}
          </div>

          {/* Table of contents */}
          {tocEntries.length > 0 && (
            <div className="border-t border-border-light pt-4">
              <TableOfContents entries={tocEntries} />
            </div>
          )}
        </div>

        {/* Page content */}
        <div className="col-span-4 lg:col-span-3">
          <Breadcrumbs page={page} basePath={basePath} />

          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-text">{page.title}</h1>
            <div className="flex gap-2">
              <ExportDropdown spaceId={currentSpace!.id} pageSlug={pageSlug!} />
              <Link to={`${basePath}/${pageSlug}/history`}>
                <Button variant="ghost" size="sm">
                  <History className="h-4 w-4" /> History
                </Button>
              </Link>
              <Link to={`${basePath}/${pageSlug}/edit`}>
                <Button variant="secondary" size="sm">
                  <Edit className="h-4 w-4" /> Edit
                </Button>
              </Link>
              <Dropdown
                align="right"
                trigger={
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" /> Actions
                  </Button>
                }
              >
                <DropdownItem onClick={() => setShowMoveModal(true)}>
                  <ArrowRight className="h-4 w-4" /> Move
                </DropdownItem>
                <DropdownItem onClick={() => copyMutation.mutate()}>
                  <Copy className="h-4 w-4" /> Copy
                </DropdownItem>
                <DropdownItem danger onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownItem>
              </Dropdown>
            </div>
          </div>

          {/* Labels */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {labels.map((pl) => (
              <span
                key={pl.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                <Tag className="h-3 w-3" />
                {pl.label}
                <button
                  type="button"
                  onClick={() => removeLabelMutation.mutate(pl.label)}
                  className="ml-0.5 hover:text-danger transition-colors"
                  title="Remove label"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {showAddLabel ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (labelInput.trim()) addLabelMutation.mutate(labelInput.trim());
                }}
                className="flex items-center gap-1"
              >
                <Input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="Label name"
                  className="h-6 w-32 rounded border border-border bg-surface px-2 text-xs focus:border-border-focus focus:ring-1 focus:ring-primary/15 focus:outline-none"
                  autoFocus
                />
                <Button type="submit" size="xs" disabled={!labelInput.trim()}>
                  <Plus className="h-3 w-3" /> Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setShowAddLabel(false);
                    setLabelInput('');
                  }}
                >
                  <X className="h-3 w-3" /> Cancel
                </Button>
              </form>
            ) : (
              <Button variant="ghost" size="xs" onClick={() => setShowAddLabel(true)}>
                <Tag className="h-3 w-3" /> Add label
              </Button>
            )}
          </div>

          {page.versions?.[0] && (
            <p className="text-xs text-text-tertiary mb-4">
              Last edited {formatRelative(page.versions[0].createdAt)} by{' '}
              <span className="text-text-secondary">{page.versions[0].author?.displayName}</span>
            </p>
          )}
          <div className="rounded-lg border border-border bg-surface p-8">
            <div className="prose max-w-3xl leading-relaxed">
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
