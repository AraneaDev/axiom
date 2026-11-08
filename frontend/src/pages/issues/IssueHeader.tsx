import { ArrowUp, Check, Eye, EyeOff, Pencil, X } from 'lucide-react';
import { useRef, useEffect } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { authorName } from '@/lib/authors';
import { cn, formatRelative } from '@/lib/utils';

interface IssueHeaderProps {
  issue: {
    title: string;
    key: string;
    type: string;
    createdAt: string;
    creator?: { displayName: string } | null;
    externalAuthorLogin?: string | null;
  };
  titleDraft: string;
  isTitleEditing: boolean;
  onTitleDraftChange: (value: string) => void;
  onStartEditTitle: () => void;
  onSaveTitle: () => void;
  onCancelTitle: () => void;
  voteData?: { voted: boolean; count: number } | null;
  watcherData?: { watching: boolean; watchers?: unknown[] } | null;
  onVote: () => void;
  onWatch: () => void;
}

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.titleDraft
 * @param root0.isTitleEditing
 * @param root0.onTitleDraftChange
 * @param root0.onStartEditTitle
 * @param root0.onSaveTitle
 * @param root0.onCancelTitle
 * @param root0.voteData
 * @param root0.watcherData
 * @param root0.onVote
 * @param root0.onWatch
 */
export function IssueHeader({
  issue,
  titleDraft,
  isTitleEditing,
  onTitleDraftChange,
  onStartEditTitle,
  onSaveTitle,
  onCancelTitle,
  voteData,
  watcherData,
  onVote,
  onWatch,
}: IssueHeaderProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isTitleEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isTitleEditing]);

  return (
    <div className="flex items-start gap-3 mb-6">
      <IssueTypeIcon type={issue.type} className="h-5 w-5 mt-1.5 shrink-0" />
      <div className="flex-1 min-w-0">
        {isTitleEditing ? (
          <div className="flex items-center gap-2">
            <Input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => onTitleDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveTitle();
                if (e.key === 'Escape') onCancelTitle();
              }}
              className="flex-1 text-2xl font-bold bg-transparent border-b-2 border-primary outline-none py-0.5"
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={onSaveTitle}
              className="text-success"
              title="Save"
              aria-label="Save"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={onCancelTitle}
              className="text-text-tertiary"
              title="Cancel"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <h1 className="text-2xl font-bold group cursor-pointer" onClick={onStartEditTitle}>
            {issue.title}
            <Pencil className="h-3.5 w-3.5 ml-2 inline opacity-0 group-hover:opacity-40 transition-opacity" />
          </h1>
        )}
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm text-text-tertiary">
            {issue.key} &middot; opened {formatRelative(issue.createdAt)} by{' '}
            {authorName(issue.creator, issue.externalAuthorLogin)}
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={onVote}
            className={cn(
              'ml-2 gap-1',
              voteData?.voted && 'border-primary bg-primary/10 text-primary',
            )}
            title={voteData?.voted ? 'Remove vote' : 'Vote for this issue'}
          >
            <ArrowUp className="h-3.5 w-3.5" />
            {voteData?.count ?? 0}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={onWatch}
            className={cn(
              'gap-1',
              watcherData?.watching && 'border-primary bg-primary/10 text-primary',
            )}
            title={watcherData?.watching ? 'Stop watching this issue' : 'Watch this issue'}
          >
            {watcherData?.watching ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {watcherData?.watchers?.length ?? 0}
          </Button>
        </div>
      </div>
    </div>
  );
}
