import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Edit, History, ChevronRight, Plus, FileText } from 'lucide-react';
import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn, formatRelative } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import type { PageTreeNode } from '@/lib/types';

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
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">On this page</h3>
      {entries.map((entry, i) => (
        <button
          key={`${entry.id}-${i}`}
          type="button"
          onClick={() => scrollTo(entry.id)}
          className={cn(
            'block w-full text-left text-sm text-text-tertiary hover:text-primary transition-colors truncate',
            entry.level === 1 && 'font-medium text-text-secondary',
            entry.level === 2 && 'pl-3',
            entry.level === 3 && 'pl-6 text-xs',
          )}
        >
          {entry.text}
        </button>
      ))}
    </nav>
  );
}

function Breadcrumbs({ page, basePath }: { page: any; basePath: string }) {
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
          <Link to={`${basePath}/${crumb.slug}`} className="hover:text-primary transition-colors">{crumb.title}</Link>
          <ChevronRight className="h-3 w-3" />
        </span>
      ))}
      <span className="text-text-secondary font-medium">{page.title}</span>
    </nav>
  );
}

function TreeNode({ node, basePath, depth = 0 }: { node: PageTreeNode; basePath: string; depth?: number }) {
  return (
    <div>
      <Link to={`${basePath}/${node.slug}`}
        className="flex items-center gap-2 py-1.5 px-2 rounded-md text-sm hover:bg-surface-tertiary transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        <FileText className="h-3.5 w-3.5 text-text-secondary shrink-0" />
        <span className="truncate">{node.title}</span>
      </Link>
      {node.children?.map((child) => (
        <TreeNode key={child.id} node={child} basePath={basePath} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function PageView() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const basePath = `/${org}/${team}/wiki/${spaceSlug}`;

  // We need spaceId -- get it from spaces list
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: () => import('@/api/orgs.api').then((m) => m.orgsApi.list()) });
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

  const tocEntries = useMemo(() => page?.body ? extractToc(page.body) : [], [page?.body]);

  if (isLoading) return <PageLoader />;

  // If no page slug, show the space overview with tree
  if (!pageSlug) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{currentSpace?.name ?? 'Wiki'}</h1>
          <Link to={`${basePath}/new`}>
            <Button size="sm"><Plus className="h-4 w-4" /> New Page</Button>
          </Link>
        </div>
        {!tree?.length ? (
          <EmptyState icon={<FileText className="h-10 w-10" />} title="No pages yet" description="Create your first page." />
        ) : (
          <div className="rounded-lg border border-border bg-surface p-2">
            {tree.map((node) => <TreeNode key={node.id} node={node} basePath={basePath} />)}
          </div>
        )}
      </div>
    );
  }

  if (!page) return <EmptyState title="Page not found" />;

  return (
    <div>
      <div className="grid grid-cols-4 gap-6">
        {/* Page tree sidebar */}
        <div className="col-span-1 hidden lg:block">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Pages</h3>
          <div className="space-y-0.5 mb-6">
            {tree?.map((node) => <TreeNode key={node.id} node={node} basePath={basePath} />)}
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
            <h1 className="text-2xl font-bold">{page.title}</h1>
            <div className="flex gap-2">
              <Link to={`${basePath}/${pageSlug}/history`}>
                <Button variant="ghost" size="sm"><History className="h-4 w-4" /> History</Button>
              </Link>
              <Link to={`${basePath}/${pageSlug}/edit`}>
                <Button variant="secondary" size="sm"><Edit className="h-4 w-4" /> Edit</Button>
              </Link>
            </div>
          </div>
          {page.versions?.[0] && (
            <p className="text-xs text-text-secondary mb-4">
              Last edited {formatRelative(page.versions[0].createdAt)} by {page.versions[0].author?.displayName}
            </p>
          )}
          <div className="rounded-lg border border-border bg-surface p-6">
            <MarkdownRenderer content={page.body} />
          </div>

          {/* Child pages */}
          {page.children && page.children.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">Child Pages</h2>
              <div className="grid gap-2">
                {page.children.map((child) => (
                  <Link key={child.id} to={`${basePath}/${child.slug}`}
                    className="flex items-center gap-2 p-3 rounded-lg border border-border hover:border-primary/50 transition-all">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{child.title}</span>
                    <ChevronRight className="h-4 w-4 ml-auto text-text-secondary" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
