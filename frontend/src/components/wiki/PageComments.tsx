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
  ThumbsUp,
  Heart,
  Eye,
  Rocket,
  HelpCircle,
  Plus,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

import { wikiApi } from '@/api/wiki.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { UserName } from '@/components/ui/UserName';
import type { PageComment } from '@/lib/types';
import { cn, formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

const REACTION_ICONS = {
  thumbsup: ThumbsUp,
  heart: Heart,
  eyes: Eye,
  rocket: Rocket,
  thinking: HelpCircle,
  check: Check,
} as const;

const REACTION_TYPES = Object.keys(REACTION_ICONS) as (keyof typeof REACTION_ICONS)[];

interface ReactionGroup {
  type: string;
  count: number;
  userIds: string[];
}

function groupReactions(reactions: PageComment['reactions']): ReactionGroup[] {
  if (!reactions?.length) return [];
  const map = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const existing = map.get(r.reactionType);
    if (existing) {
      existing.count++;
      existing.userIds.push(r.userId);
    } else {
      map.set(r.reactionType, { type: r.reactionType, count: 1, userIds: [r.userId] });
    }
  }
  return Array.from(map.values());
}

function ReactionPicker({
  onSelect,
  onClose,
}: {
  onSelect: (type: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute bottom-full left-0 mb-1 z-10">
      <Card className="flex items-center gap-1 p-1 shadow-lg">
        {REACTION_TYPES.map((type) => {
          const Icon = REACTION_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              className="rounded p-1.5 hover:bg-surface-hover transition-colors"
              title={type}
              onClick={() => {
                onSelect(type);
                onClose();
              }}
            >
              <Icon className="h-4 w-4 text-text-secondary" />
            </button>
          );
        })}
      </Card>
    </div>
  );
}

function ReactionBar({
  comment,
  currentUserId,
  onToggle,
}: {
  comment: PageComment;
  currentUserId?: string;
  onToggle: (commentId: string, reactionType: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const groups = groupReactions(comment.reactions);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {groups.map((group) => {
        const Icon = REACTION_ICONS[group.type as keyof typeof REACTION_ICONS];
        if (!Icon) return null;
        const hasReacted = currentUserId ? group.userIds.includes(currentUserId) : false;
        return (
          <button
            key={group.type}
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors',
              hasReacted
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-surface-hover text-text-secondary hover:border-primary/50',
            )}
            onClick={() => onToggle(comment.id, group.type)}
            title={group.type}
          >
            <Icon className="h-3 w-3" />
            <span>{group.count}</span>
          </button>
        );
      })}
      <div className="relative">
        <Button
          variant="ghost"
          size="xs"
          title="Add reaction"
          onClick={() => setShowPicker(!showPicker)}
          className="rounded-full"
        >
          <Plus className="h-3 w-3" />
        </Button>
        {showPicker && (
          <ReactionPicker
            onSelect={(type) => onToggle(comment.id, type)}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>
    </div>
  );
}

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

  const reactionMutation = useMutation({
    mutationFn: ({ commentId, reactionType }: { commentId: string; reactionType: string }) =>
      wikiApi.toggleReaction(commentId, reactionType),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pageComments', pageId] }),
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
          <Card key={comment.id} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar name={comment.user.displayName} size="sm" />
                <span className="text-sm font-medium text-text">
                  <UserName user={comment.user} />
                </span>
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
            <ReactionBar
              comment={comment}
              currentUserId={user?.id}
              onToggle={(cId, type) =>
                reactionMutation.mutate({ commentId: cId, reactionType: type })
              }
            />
          </Card>
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
                <Card key={comment.id} className="p-3 space-y-2 opacity-60">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar name={comment.user.displayName} size="sm" />
                      <span className="text-sm font-medium text-text">
                        <UserName user={comment.user} />
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
                  <ReactionBar
                    comment={comment}
                    currentUserId={user?.id}
                    onToggle={(cId, type) =>
                      reactionMutation.mutate({ commentId: cId, reactionType: type })
                    }
                  />
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
