import { MessageSquare, Pencil, Trash2, Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { issuesApi } from '@/api/issues.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { useDraftState } from '@/hooks/useDraftState';
import { useIssueInvalidation } from '@/hooks/useIssueInvalidation';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { authorName } from '@/lib/authors';
import type { Issue } from '@/lib/types';
import { formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

interface IssueDetailCommentsProps {
  issue: Issue;
  projectId: string;
  num: string;
  commentBody: string;
  onCommentBodyChange: (value: string) => void;
  onCommentReset: () => void;
  basePath?: string;
  orgSlug?: string;
  teamSlug?: string;
}

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.projectId
 * @param root0.num
 * @param root0.commentBody
 * @param root0.onCommentBodyChange
 * @param root0.onCommentReset
 * @param root0.basePath
 * @param root0.orgSlug
 * @param root0.teamSlug
 */
export function IssueDetailComments({
  issue,
  projectId,
  num,
  commentBody,
  onCommentBodyChange,
  onCommentReset,
  basePath,
  orgSlug,
  teamSlug,
}: IssueDetailCommentsProps) {
  const { user } = useAuthStore();
  const editCommentDraft = useDraftState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { invalidateIssue } = useIssueInvalidation(projectId, num);

  const commentMutation = useMutationWithToast(
    () => issuesApi.addComment(projectId, parseInt(num), commentBody),
    {
      successMessage: null,
      onSuccess: () => {
        onCommentReset();
        invalidateIssue();
      },
    },
  );

  const updateCommentMutation = useMutationWithToast(
    ({ commentId, body }: { commentId: string; body: string }) =>
      issuesApi.updateComment(projectId, commentId, body),
    {
      successMessage: null,
      onSuccess: () => {
        setEditingCommentId(null);
        editCommentDraft.reset();
        invalidateIssue();
      },
    },
  );

  const deleteCommentMutation = useMutationWithToast(
    (commentId: string) => issuesApi.deleteComment(projectId, commentId),
    {
      successMessage: null,
      onSuccess: () => invalidateIssue(),
    },
  );

  function startEditComment(commentId: string, body: string) {
    editCommentDraft.startEditing(body);
    setEditingCommentId(commentId);
  }

  const sortedComments = [...(issue.comments ?? [])].reverse();

  return (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-4">
        Comments
        {sortedComments.length > 0 && (
          <Badge size="sm" className="ml-2">
            {sortedComments.length}
          </Badge>
        )}
      </h2>

      {/* Add comment -- input first */}
      <div className="space-y-2 mb-6">
        <MarkdownEditor
          value={commentBody}
          onChange={onCommentBodyChange}
          placeholder="Write a comment... Use @ to mention users, ^ to reference issues"
          compact
          projectId={projectId}
          uploadTarget={{ issueId: issue.id }}
        />
        <Button
          size="sm"
          disabled={!commentBody.trim() || commentMutation.isPending}
          onClick={() => commentMutation.mutate()}
        >
          {commentMutation.isPending ? (
            <Spinner size="sm" />
          ) : (
            <>
              <MessageSquare className="h-4 w-4" /> Comment
            </>
          )}
        </Button>
      </div>

      {/* Comments -- newest first */}
      <div className="relative mb-6">
        {sortedComments.length > 0 && (
          <div className="absolute left-4 top-6 bottom-6 w-px bg-border-light" />
        )}
        <div className="space-y-4">
          {sortedComments.map((comment) => (
            <div key={comment.id} className="relative flex gap-3 group">
              <div className="relative z-10 shrink-0">
                <Avatar name={authorName(comment.author, comment.externalAuthorLogin)} size="sm" />
              </div>
              <Card className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary/40 border-b border-border-light">
                  {orgSlug && teamSlug && !comment.externalAuthorLogin ? (
                    <Link
                      to={`/${orgSlug}/${teamSlug}/members/${comment.author.username}`}
                      className="text-sm font-medium text-text hover:text-primary transition-colors"
                    >
                      {comment.author.displayName}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-text">
                      {authorName(comment.author, comment.externalAuthorLogin)}
                    </span>
                  )}
                  <span className="text-xs text-text-tertiary">
                    {formatRelative(comment.createdAt)}
                  </span>
                  {comment.updatedAt !== comment.createdAt && (
                    <span className="text-xs text-text-tertiary italic">(edited)</span>
                  )}
                  {user?.id === comment.author.id && (
                    <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="xs"
                        title="Edit comment"
                        onClick={() => startEditComment(comment.id, comment.body)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        title="Delete comment"
                        onClick={() => setDeleteTarget(comment.id)}
                      >
                        <Trash2 className="h-3 w-3 text-danger" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="px-4 py-3">
                  {editingCommentId === comment.id ? (
                    <div className="space-y-2">
                      <MarkdownEditor
                        value={editCommentDraft.draft}
                        onChange={editCommentDraft.setDraft}
                        compact
                        projectId={projectId}
                        uploadTarget={{ issueId: issue.id }}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={
                            !editCommentDraft.draft.trim() || updateCommentMutation.isPending
                          }
                          onClick={() =>
                            updateCommentMutation.mutate({
                              commentId: comment.id,
                              body: editCommentDraft.draft,
                            })
                          }
                        >
                          <Check className="h-4 w-4" /> Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingCommentId(null);
                            editCommentDraft.cancel();
                          }}
                        >
                          <X className="h-4 w-4" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <MarkdownRenderer
                      content={comment.body}
                      className="text-sm"
                      basePath={basePath}
                    />
                  )}
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>

      {/* Delete comment confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteCommentMutation.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        title="Delete Comment"
        description="Are you sure you want to delete this comment? This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteCommentMutation.isPending}
      />
    </>
  );
}
