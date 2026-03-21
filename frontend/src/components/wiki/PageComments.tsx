import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  CheckCircle,
  Trash2,
  Send,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { wikiApi } from '@/api/wiki.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn, formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

interface PageCommentsProps {
  pageId: string;
}

/**
 *
 * @param root0
 * @param root0.pageId
 */
export function PageComments({ pageId }: PageCommentsProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const [body, setBody] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');

  const { data: comments = [] } = useQuery({
    queryKey: ['pageComments', pageId],
    queryFn: () => wikiApi.listPageComments(pageId),
    enabled: !!pageId,
  });

  const addMutation = useMutation({
    mutationFn: (data: { body: string }) => wikiApi.addPageComment(pageId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageComments', pageId] });
      setBody('');
      toast.success('Comment added');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to add comment'),
  });

  const resolveMutation = useMutation({
    mutationFn: (commentId: string) => wikiApi.resolveComment(commentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pageComments', pageId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => wikiApi.deletePageComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageComments', pageId] });
      toast.success('Comment deleted');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      wikiApi.updatePageComment(commentId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageComments', pageId] });
      setEditingCommentId(null);
      toast.success('Comment updated');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to update comment'),
  });

  const activeComments = comments.filter((c) => !c.resolved).reverse();
  const resolvedComments = comments.filter((c) => c.resolved).reverse();

  function handleSubmit() {
    if (!body.trim()) return;
    addMutation.mutate({ body: body.trim() });
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-text flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Comments ({comments.length})
      </h3>

      {/* Add comment form */}
      <div className="space-y-2">
        <MarkdownEditor value={body} onChange={setBody} placeholder="Add a comment..." compact />
        <div className="flex justify-end">
          <Button size="sm" disabled={addMutation.isPending || !body.trim()} onClick={handleSubmit}>
            <Send className="h-4 w-4" /> Comment
          </Button>
        </div>
      </div>

      {/* Active comments */}
      <div className="space-y-3">
        {activeComments.map((comment) => (
          <div
            key={comment.id}
            className="rounded-lg border border-border bg-surface p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar name={comment.user.displayName} size="sm" />
                <span className="text-sm font-medium text-text">{comment.user.displayName}</span>
                <span className="text-xs text-text-tertiary">
                  {formatRelative(comment.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  title="Resolve"
                  onClick={() => resolveMutation.mutate(comment.id)}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                </Button>
                {user?.id === comment.userId && (
                  <>
                    <Button
                      variant="ghost"
                      size="xs"
                      title="Edit"
                      onClick={() => {
                        setEditCommentBody(comment.body);
                        setEditingCommentId(comment.id);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      title="Delete"
                      onClick={() => deleteMutation.mutate(comment.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            {comment.anchorText && (
              <div className="text-xs text-text-tertiary italic border-l-2 border-primary/30 pl-2">
                {comment.anchorText}
              </div>
            )}
            {editingCommentId === comment.id ? (
              <div className="space-y-2">
                <MarkdownEditor value={editCommentBody} onChange={setEditCommentBody} compact />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!editCommentBody.trim() || updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({ commentId: comment.id, body: editCommentBody })
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
              <MarkdownRenderer content={comment.body} className="text-sm" />
            )}
          </div>
        ))}
      </div>

      {/* Resolved comments */}
      {resolvedComments.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowResolved(!showResolved)}
            className="text-text-tertiary hover:text-text-secondary"
          >
            {showResolved ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {resolvedComments.length} resolved comment{resolvedComments.length !== 1 ? 's' : ''}
          </Button>
          {showResolved && (
            <div className="space-y-2 mt-2">
              {resolvedComments.map((comment) => (
                <div
                  key={comment.id}
                  className={cn(
                    'rounded-lg border border-border bg-surface p-3 space-y-2 opacity-60',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar name={comment.user.displayName} size="sm" />
                      <span className="text-sm font-medium text-text">
                        {comment.user.displayName}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        {formatRelative(comment.createdAt)}
                      </span>
                      <span className="text-xs text-success flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Resolved
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        title="Unresolve"
                        onClick={() => resolveMutation.mutate(comment.id)}
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </Button>
                      {user?.id === comment.userId && (
                        <Button
                          variant="ghost"
                          size="xs"
                          title="Delete"
                          onClick={() => deleteMutation.mutate(comment.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <MarkdownRenderer content={comment.body} className="text-sm" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
