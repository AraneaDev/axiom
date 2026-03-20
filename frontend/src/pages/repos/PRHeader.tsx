import { Pencil, Check, X } from 'lucide-react';
import { Link } from 'react-router';

import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatRelative } from '@/lib/utils';

const STATUS_BADGE: Record<string, 'primary' | 'success' | 'default'> = {
  OPEN: 'primary',
  MERGED: 'success',
  CLOSED: 'default',
};

interface PRHeaderProps {
  pr: {
    title: string;
    status: string;
    number: number;
    sourceBranch: string;
    targetBranch: string;
    createdAt: string;
    body?: string | null;
  };
  org: string;
  teamSlug: string;
  repoSlug: string;
  editingDescription: boolean;
  descriptionBody: string;
  onDescriptionBodyChange: (val: string) => void;
  onEditDescription: () => void;
  onSaveDescription: () => void;
  onCancelEditDescription: () => void;
  isSavingDescription: boolean;
}

/**
 *
 * @param root0
 * @param root0.pr
 * @param root0.org
 * @param root0.teamSlug
 * @param root0.repoSlug
 * @param root0.editingDescription
 * @param root0.descriptionBody
 * @param root0.onDescriptionBodyChange
 * @param root0.onEditDescription
 * @param root0.onSaveDescription
 * @param root0.onCancelEditDescription
 * @param root0.isSavingDescription
 */
export function PRHeader({
  pr,
  org,
  teamSlug,
  repoSlug,
  editingDescription,
  descriptionBody,
  onDescriptionBodyChange,
  onEditDescription,
  onSaveDescription,
  onCancelEditDescription,
  isSavingDescription,
}: PRHeaderProps) {
  return (
    <>
      <div className="border-b border-border pb-5">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-xl font-bold text-text">{pr.title}</h1>
          <Badge variant={STATUS_BADGE[pr.status]}>{pr.status}</Badge>
        </div>
        <p className="text-sm text-text-secondary flex items-center gap-1.5 flex-wrap">
          <span className="text-text-tertiary">#{pr.number}</span>
          <span className="text-text-tertiary">&middot;</span>
          <Link
            to={`/${org}/${teamSlug}/repos/${repoSlug}/tree/${encodeURIComponent(pr.sourceBranch)}`}
            className="hover:text-primary transition-colors"
          >
            <code className="bg-surface-secondary px-1.5 py-0.5 rounded text-xs font-mono">
              {pr.sourceBranch}
            </code>
          </Link>
          <span className="text-text-tertiary">&rarr;</span>
          <Link
            to={`/${org}/${teamSlug}/repos/${repoSlug}/tree/${encodeURIComponent(pr.targetBranch)}`}
            className="hover:text-primary transition-colors"
          >
            <code className="bg-surface-secondary px-1.5 py-0.5 rounded text-xs font-mono">
              {pr.targetBranch}
            </code>
          </Link>
          <span className="text-text-tertiary">&middot;</span>
          <span className="text-text-tertiary">{formatRelative(pr.createdAt)}</span>
        </p>
      </div>

      {/* Description */}
      {(pr.body || editingDescription) && (
        <div className="rounded-lg border border-border bg-surface p-4">
          {editingDescription ? (
            <div className="space-y-2">
              <MarkdownEditor value={descriptionBody} onChange={onDescriptionBodyChange} />
              <div className="flex gap-2">
                <Button size="sm" disabled={isSavingDescription} onClick={onSaveDescription}>
                  <Check className="h-4 w-4" /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelEditDescription}>
                  <X className="h-4 w-4" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <MarkdownRenderer content={pr.body ?? ''} className="text-sm flex-1" />
              {pr.status === 'OPEN' && (
                <Button
                  size="xs"
                  variant="ghost"
                  title="Edit description"
                  onClick={onEditDescription}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
