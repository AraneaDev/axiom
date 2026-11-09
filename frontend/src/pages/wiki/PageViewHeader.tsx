import { useQuery } from '@tanstack/react-query';
import {
  Edit,
  Eye,
  History,
  ChevronRight,
  Plus,
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
  FileText,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { UserName } from '@/components/ui/UserName';
import { PageRestrictions } from '@/components/wiki/PageRestrictions';
import { StarButton } from '@/components/wiki/StarButton';
import type { PageRestriction, UserKind } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

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

const EXPORT_FORMATS = [
  { key: 'md', label: 'Markdown', icon: FileText },
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
          {exporting ? <Spinner size="sm" /> : <Download className="h-4 w-4" />} Export
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

interface PageLabel {
  id: string;
  label: string;
}

function ViewCount({ pageId }: { pageId: string }) {
  const { data } = useQuery({
    queryKey: ['pageAnalytics', pageId],
    queryFn: () => wikiApi.getAnalytics(pageId),
    enabled: !!pageId,
    staleTime: 60_000,
  });

  if (!data) return null;

  return (
    <span
      className="flex items-center gap-1 text-xs text-text-tertiary px-2"
      title={`${data.uniqueViewers} unique viewer${data.uniqueViewers !== 1 ? 's' : ''}`}
    >
      <Eye className="h-3.5 w-3.5" />
      {data.viewCount}
    </span>
  );
}

interface PageViewHeaderProps {
  page: {
    id: string;
    title: string;
    slug: string;
    parent?: PageCrumb;
    versions?: { createdAt: string; author?: { displayName: string; kind?: UserKind } }[];
    restrictions?: PageRestriction[];
  };
  basePath: string;
  pageSlug: string;
  spaceId: string;
  teamId: string;
  labels: PageLabel[];
  onAddLabel: (label: string) => void;
  onRemoveLabel: (label: string) => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

/**
 *
 * @param root0
 * @param root0.page
 * @param root0.basePath
 * @param root0.pageSlug
 * @param root0.spaceId
 * @param root0.teamId
 * @param root0.labels
 * @param root0.onAddLabel
 * @param root0.onRemoveLabel
 * @param root0.onMove
 * @param root0.onCopy
 * @param root0.onDelete
 */
export function PageViewHeader({
  page,
  basePath,
  pageSlug,
  spaceId,
  teamId,
  labels,
  onAddLabel,
  onRemoveLabel,
  onMove,
  onCopy,
  onDelete,
}: PageViewHeaderProps) {
  const [labelInput, setLabelInput] = useState('');
  const [showAddLabel, setShowAddLabel] = useState(false);

  return (
    <>
      <Breadcrumbs page={page} basePath={basePath} />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-text">{page.title}</h1>
        <div className="flex gap-2 items-center">
          <ViewCount pageId={page.id} />
          <StarButton pageId={page.id} />
          <PageRestrictions
            pageId={page.id}
            teamId={teamId}
            restrictions={page.restrictions ?? []}
          />
          <ExportDropdown spaceId={spaceId} pageSlug={pageSlug} />
          <ButtonLink to={`${basePath}/${pageSlug}/history`} variant="ghost" size="sm">
            <History className="h-4 w-4" /> History
          </ButtonLink>
          <ButtonLink to={`${basePath}/${pageSlug}/edit`} variant="secondary" size="sm">
            <Edit className="h-4 w-4" /> Edit
          </ButtonLink>
          <Dropdown
            align="right"
            trigger={
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" /> Actions
              </Button>
            }
          >
            <DropdownItem onClick={onMove}>
              <ArrowRight className="h-4 w-4" /> Move
            </DropdownItem>
            <DropdownItem onClick={onCopy}>
              <Copy className="h-4 w-4" /> Copy
            </DropdownItem>
            <DropdownItem danger onClick={onDelete}>
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
            <Link
              to={`/search?q=${encodeURIComponent(pl.label)}&type=wiki&label=${encodeURIComponent(pl.label)}`}
              className="hover:underline"
              title={`Search pages with label "${pl.label}"`}
            >
              {pl.label}
            </Link>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onRemoveLabel(pl.label)}
              className="ml-0.5 p-0 hover:text-danger"
              title="Remove label"
            >
              <X className="h-3 w-3" />
            </Button>
          </span>
        ))}
        {showAddLabel ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (labelInput.trim()) {
                onAddLabel(labelInput.trim());
                setLabelInput('');
                setShowAddLabel(false);
              }
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
          <span className="text-text-secondary">
            <UserName user={page.versions[0].author} />
          </span>
        </p>
      )}
    </>
  );
}
