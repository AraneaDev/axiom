import {
  Check,
  X,
  ListChecks,
  Pencil,
  Trash2,
  Loader2,
  GitCommitHorizontal,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';

import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { hasSuggestion } from '@/components/suggestion-utils';
import { SuggestionBlock } from '@/components/SuggestionBlock';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils';

interface Review {
  id: string;
  status: string;
  body?: string;
  createdAt: string;
}

interface Comment {
  id: string;
  authorId: string;
  filePath?: string;
  line?: number;
  body: string;
  parentId?: string | null;
  createdAt: string;
}

interface CommentThread {
  root: Comment;
  replies: Comment[];
}

function groupIntoThreads(comments: Comment[]): CommentThread[] {
  const threads: CommentThread[] = [];
  const replyMap = new Map<string, Comment[]>();

  for (const c of comments) {
    if (c.parentId) {
      const arr = replyMap.get(c.parentId) || [];
      arr.push(c);
      replyMap.set(c.parentId, arr);
    } else {
      threads.push({ root: c, replies: [] });
    }
  }

  for (const thread of threads) {
    thread.replies = replyMap.get(thread.root.id) || [];
  }

  return threads;
}

interface PRTimelineProps {
  pr: {
    status: string;
    reviews?: Review[];
    comments?: Comment[];
  };
  userId: string | undefined;
  // Comment editing
  editingCommentId: string | null;
  editCommentBody: string;
  onEditCommentBodyChange: (val: string) => void;
  onStartEditComment: (commentId: string, body: string) => void;
  onSaveEditComment: (commentId: string) => void;
  onCancelEditComment: () => void;
  isSavingComment: boolean;
  // Comment delete
  deleteTarget: string | null;
  onSetDeleteTarget: (id: string | null) => void;
  onDeleteComment: (id: string) => void;
  // Suggestion handling
  selectedSuggestions: Set<string>;
  applyingComment: string | null;
  onApplySuggestion: (commentId: string) => void;
  onToggleSuggestion: (commentId: string) => void;
  onBatchApply: () => void;
  isBatchApplying: boolean;
  // Add comment
  commentBody: string;
  onCommentBodyChange: (val: string) => void;
  onSubmitComment: () => void;
  isSubmittingComment: boolean;
  // Reply to comment
  onSubmitReply: (parentId: string, body: string) => void;
  isSubmittingReply: boolean;
  // Review actions
  onApprove: () => void;
  onRequestChanges: () => void;
}

/**
 *
 * @param root0
 * @param root0.pr
 * @param root0.userId
 * @param root0.editingCommentId
 * @param root0.editCommentBody
 * @param root0.onEditCommentBodyChange
 * @param root0.onStartEditComment
 * @param root0.onSaveEditComment
 * @param root0.onCancelEditComment
 * @param root0.isSavingComment
 * @param root0.deleteTarget
 * @param root0.onSetDeleteTarget
 * @param root0.onDeleteComment
 * @param root0.selectedSuggestions
 * @param root0.applyingComment
 * @param root0.onApplySuggestion
 * @param root0.onToggleSuggestion
 * @param root0.onBatchApply
 * @param root0.isBatchApplying
 * @param root0.commentBody
 * @param root0.onCommentBodyChange
 * @param root0.onSubmitComment
 * @param root0.isSubmittingComment
 * @param root0.onSubmitReply
 * @param root0.isSubmittingReply
 * @param root0.onApprove
 * @param root0.onRequestChanges
 */
export function PRTimeline({
  pr,
  userId,
  editingCommentId,
  editCommentBody,
  onEditCommentBodyChange,
  onStartEditComment,
  onSaveEditComment,
  onCancelEditComment,
  isSavingComment,
  deleteTarget,
  onSetDeleteTarget,
  onDeleteComment,
  selectedSuggestions,
  applyingComment,
  onApplySuggestion,
  onToggleSuggestion,
  onBatchApply,
  isBatchApplying,
  commentBody,
  onCommentBodyChange,
  onSubmitComment,
  isSubmittingComment,
  onSubmitReply,
  isSubmittingReply,
  onApprove,
  onRequestChanges,
}: PRTimelineProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const threads = groupIntoThreads(pr.comments ?? []);

  const handleSubmitReply = (parentId: string) => {
    if (!replyBody.trim()) return;
    onSubmitReply(parentId, replyBody);
    setReplyBody('');
    setReplyingTo(null);
  };

  const toggleThreadExpand = (threadId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  return (
    <>
      {/* Reviews */}
      {pr.reviews && pr.reviews.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Reviews</h2>
          <div className="space-y-2">
            {pr.reviews.map((r) => (
              <Card key={r.id} className="p-3 flex items-start gap-3">
                <Badge
                  variant={
                    r.status === 'APPROVED'
                      ? 'success'
                      : r.status === 'CHANGES_REQUESTED'
                        ? 'danger'
                        : 'default'
                  }
                >
                  {r.status === 'APPROVED'
                    ? 'Approved'
                    : r.status === 'CHANGES_REQUESTED'
                      ? 'Changes requested'
                      : 'Commented'}
                </Badge>
                {r.body && <p className="text-sm flex-1">{r.body}</p>}
                <span className="text-xs text-text-secondary">{formatRelative(r.createdAt)}</span>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Add comment -- input first */}
      {pr.status === 'OPEN' && (
        <div className="space-y-2">
          <MarkdownEditor
            value={commentBody}
            onChange={onCommentBodyChange}
            placeholder="Leave a comment..."
            compact
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!commentBody.trim() || isSubmittingComment}
              onClick={onSubmitComment}
            >
              {isSubmittingComment ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <GitCommitHorizontal className="h-4 w-4" /> Comment
                </>
              )}
            </Button>
            <Button size="sm" variant="secondary" onClick={onApprove}>
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={onRequestChanges}>
              <X className="h-4 w-4" /> Request changes
            </Button>
          </div>
        </div>
      )}

      {/* Comments -- threaded, newest first */}
      {pr.comments && pr.comments.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Comments ({pr.comments.length})</h2>
            {selectedSuggestions.size > 0 && pr.status === 'OPEN' && (
              <Button size="sm" disabled={isBatchApplying} onClick={onBatchApply}>
                {isBatchApplying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListChecks className="h-3.5 w-3.5" />
                )}
                Apply {selectedSuggestions.size} suggestion
                {selectedSuggestions.size !== 1 ? 's' : ''}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {[...threads].reverse().map((thread) => {
              const c = thread.root;
              const replies = thread.replies;
              const isExpanded = expandedThreads.has(c.id);
              const hasHiddenReplies = replies.length > 3 && !isExpanded;
              const visibleReplies = hasHiddenReplies ? [replies[0]] : replies;

              return (
                <div key={c.id}>
                  {/* Root comment */}
                  <Card className="p-3 group">
                    {c.filePath && (
                      <p className="text-xs font-mono text-text-secondary mb-1">
                        {c.filePath}:{c.line}
                      </p>
                    )}
                    {editingCommentId === c.id ? (
                      <div className="space-y-2">
                        <MarkdownEditor
                          value={editCommentBody}
                          onChange={onEditCommentBodyChange}
                          compact
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={!editCommentBody.trim() || isSavingComment}
                            onClick={() => onSaveEditComment(c.id)}
                          >
                            <Check className="h-4 w-4" /> Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={onCancelEditComment}>
                            <X className="h-4 w-4" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <MarkdownRenderer content={c.body} className="text-sm" />
                        {pr.status === 'OPEN' && hasSuggestion(c.body) && (
                          <SuggestionBlock
                            commentId={c.id}
                            body={c.body}
                            isApplying={applyingComment === c.id}
                            isSelected={selectedSuggestions.has(c.id)}
                            onApply={onApplySuggestion}
                            onToggleSelect={onToggleSuggestion}
                          />
                        )}
                      </>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-text-secondary">{formatRelative(c.createdAt)}</p>
                        {pr.status === 'OPEN' && (
                          <Button
                            variant="ghost"
                            size="xs"
                            title="Reply to comment"
                            onClick={() => {
                              setReplyingTo(replyingTo === c.id ? null : c.id);
                              setReplyBody('');
                            }}
                          >
                            <MessageSquare className="h-3 w-3" /> Reply
                            {replies.length > 0 && ` (${replies.length})`}
                          </Button>
                        )}
                      </div>
                      {userId === c.authorId && editingCommentId !== c.id && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="xs"
                            title="Edit comment"
                            onClick={() => onStartEditComment(c.id, c.body)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            title="Delete comment"
                            onClick={() => onSetDeleteTarget(c.id)}
                          >
                            <Trash2 className="h-3 w-3 text-danger" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Inline reply form */}
                  {replyingTo === c.id && (
                    <div className="ml-6 border-l-2 border-border pl-4 mt-1">
                      <Card className="p-3 space-y-2">
                        <MarkdownEditor
                          value={replyBody}
                          onChange={setReplyBody}
                          placeholder="Write a reply..."
                          compact
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={!replyBody.trim() || isSubmittingReply}
                            onClick={() => handleSubmitReply(c.id)}
                          >
                            {isSubmittingReply ? (
                              <Spinner size="sm" />
                            ) : (
                              <>
                                <MessageSquare className="h-4 w-4" /> Reply
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReplyingTo(null);
                              setReplyBody('');
                            }}
                          >
                            <X className="h-4 w-4" /> Cancel
                          </Button>
                        </div>
                      </Card>
                    </div>
                  )}

                  {/* Replies */}
                  {replies.length > 0 && (
                    <div className="ml-6 border-l-2 border-border pl-4 space-y-1 mt-1">
                      {visibleReplies.map((reply) => (
                        <Card key={reply.id} className="p-3 group">
                          {editingCommentId === reply.id ? (
                            <div className="space-y-2">
                              <MarkdownEditor
                                value={editCommentBody}
                                onChange={onEditCommentBodyChange}
                                compact
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={!editCommentBody.trim() || isSavingComment}
                                  onClick={() => onSaveEditComment(reply.id)}
                                >
                                  <Check className="h-4 w-4" /> Save
                                </Button>
                                <Button size="sm" variant="ghost" onClick={onCancelEditComment}>
                                  <X className="h-4 w-4" /> Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <MarkdownRenderer content={reply.body} className="text-sm" />
                          )}
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-text-secondary">
                              {formatRelative(reply.createdAt)}
                            </p>
                            {userId === reply.authorId && editingCommentId !== reply.id && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  title="Edit comment"
                                  onClick={() => onStartEditComment(reply.id, reply.body)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  title="Delete comment"
                                  onClick={() => onSetDeleteTarget(reply.id)}
                                >
                                  <Trash2 className="h-3 w-3 text-danger" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </Card>
                      ))}
                      {hasHiddenReplies && (
                        <Button variant="ghost" size="xs" onClick={() => toggleThreadExpand(c.id)}>
                          <ChevronDown className="h-3 w-3" /> Show {replies.length - 1} more{' '}
                          {replies.length - 1 === 1 ? 'reply' : 'replies'}
                        </Button>
                      )}
                      {isExpanded && replies.length > 3 && (
                        <Button variant="ghost" size="xs" onClick={() => toggleThreadExpand(c.id)}>
                          <ChevronUp className="h-3 w-3" /> Collapse replies
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Delete comment confirmation */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => onSetDeleteTarget(null)}
        title="Delete Comment"
        size="sm"
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete this comment? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => onSetDeleteTarget(null)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleteTarget) onDeleteComment(deleteTarget);
              onSetDeleteTarget(null);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
