import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Trash2, Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { issuesApi } from '@/api/issues.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import type { Issue } from '@/lib/types';
import { formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

interface IssueDetailCommentsProps {
  issue: Issue;
  projectId: string;
  num: string;
  commentBody: string;
  onCommentBodyChange: (value: string) => void;
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
  basePath,
  orgSlug,
  teamSlug,
}: IssueDetailCommentsProps) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const invalidateIssue = () => {
    queryClient.invalidateQueries({ queryKey: ['issue', projectId, num] });
    queryClient.invalidateQueries({ queryKey: ['activity', projectId, num] });
  };

  const commentMutation = useMutation({
    mutationFn: () => issuesApi.addComment(projectId, parseInt(num), commentBody),
    onSuccess: () => {
      onCommentBodyChange('');
      invalidateIssue();
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      issuesApi.updateComment(projectId, commentId, body),
    onSuccess: () => {
      setEditingCommentId(null);
      invalidateIssue();
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => issuesApi.deleteComment(projectId, commentId),
    onSuccess: () => invalidateIssue(),
  });

  function startEditComment(commentId: string, body: string) {
    setEditCommentBody(body);
    setEditingCommentId(commentId);
  }

  const sortedComments = [...(issue.comments ?? [])].reverse();

  return (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-4">
        Comments
        {sortedComments.length > 0 && (
          <span className="ml-2 inline-flex items-center rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary normal-case tracking-normal">
            {sortedComments.length}
          </span>
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
        />
        <Button
          size="sm"
          disabled={!commentBody.trim() || commentMutation.isPending}
          onClick={() => commentMutation.mutate()}
        >
          {commentMutation.isPending ? (
            <Spinner className="h-4 w-4" />
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
                <Avatar name={comment.author.displayName} size="sm" />
              </div>
              <div className="flex-1 rounded-lg border border-border bg-surface overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary/40 border-b border-border-light">
                  {orgSlug && teamSlug ? (
                    <Link
                      to={`/${orgSlug}/${teamSlug}/members/${comment.author.username}`}
                      className="text-sm font-medium text-text hover:text-primary transition-colors"
                    >
                      {comment.author.displayName}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-text">
                      {comment.author.displayName}
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
                        value={editCommentBody}
                        onChange={setEditCommentBody}
                        compact
                        projectId={projectId}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!editCommentBody.trim() || updateCommentMutation.isPending}
                          onClick={() =>
                            updateCommentMutation.mutate({
                              commentId: comment.id,
                              body: editCommentBody,
                            })
                          }
                        >
                          <Check className="h-4 w-4" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingCommentId(null)}>
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
              </div>
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
