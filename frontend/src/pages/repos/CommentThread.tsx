import { Check, X, Pencil, Trash2, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { hasSuggestion } from '@/components/suggestion-utils';
import { SuggestionBlock } from '@/components/SuggestionBlock';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils';

export interface Comment {
  id: string;
  authorId: string;
  filePath?: string;
  line?: number;
  body: string;
  parentId?: string | null;
  createdAt: string;
}

export interface CommentThreadData {
  root: Comment;
  replies: Comment[];
}

interface CommentThreadProps {
  thread: CommentThreadData;
  userId: string | undefined;
  prStatus: string;
  // Comment editing
  editingCommentId: string | null;
  editCommentBody: string;
  onEditCommentBodyChange: (val: string) => void;
  onStartEditComment: (commentId: string, body: string) => void;
  onSaveEditComment: (commentId: string) => void;
  onCancelEditComment: () => void;
  isSavingComment: boolean;
  // Comment delete
  onSetDeleteTarget: (id: string | null) => void;
  // Suggestion handling
  selectedSuggestions: Set<string>;
  applyingComment: string | null;
  onApplySuggestion: (commentId: string) => void;
  onToggleSuggestion: (commentId: string) => void;
  // Reply
  onSubmitReply: (parentId: string, body: string) => void;
  isSubmittingReply: boolean;
}

/**
 *
 * @param root0
 * @param root0.thread
 * @param root0.userId
 * @param root0.prStatus
 * @param root0.editingCommentId
 * @param root0.editCommentBody
 * @param root0.onEditCommentBodyChange
 * @param root0.onStartEditComment
 * @param root0.onSaveEditComment
 * @param root0.onCancelEditComment
 * @param root0.isSavingComment
 * @param root0.onSetDeleteTarget
 * @param root0.selectedSuggestions
 * @param root0.applyingComment
 * @param root0.onApplySuggestion
 * @param root0.onToggleSuggestion
 * @param root0.onSubmitReply
 * @param root0.isSubmittingReply
 */
export function CommentThread({
  thread,
  userId,
  prStatus,
  editingCommentId,
  editCommentBody,
  onEditCommentBodyChange,
  onStartEditComment,
  onSaveEditComment,
  onCancelEditComment,
  isSavingComment,
  onSetDeleteTarget,
  selectedSuggestions,
  applyingComment,
  onApplySuggestion,
  onToggleSuggestion,
  onSubmitReply,
  isSubmittingReply,
}: CommentThreadProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const c = thread.root;
  const replies = thread.replies;
  const hasHiddenReplies = replies.length > 3 && !isExpanded;
  const visibleReplies = hasHiddenReplies ? [replies[0]] : replies;

  const handleSubmitReply = (parentId: string) => {
    if (!replyBody.trim()) return;
    onSubmitReply(parentId, replyBody);
    setReplyBody('');
    setReplyingTo(null);
  };

  return (
    <div>
      {/* Root comment */}
      <Card className="p-3 group">
        {c.filePath && (
          <p className="text-xs font-mono text-text-secondary mb-1">
            {c.filePath}:{c.line}
          </p>
        )}
        {editingCommentId === c.id ? (
          <div className="space-y-2">
            <MarkdownEditor value={editCommentBody} onChange={onEditCommentBodyChange} compact />
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
            {prStatus === 'OPEN' && hasSuggestion(c.body) && (
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
            {prStatus === 'OPEN' && (
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
                <p className="text-xs text-text-secondary">{formatRelative(reply.createdAt)}</p>
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
            <Button variant="ghost" size="xs" onClick={() => setIsExpanded(true)}>
              <ChevronDown className="h-3 w-3" /> Show {replies.length - 1} more{' '}
              {replies.length - 1 === 1 ? 'reply' : 'replies'}
            </Button>
          )}
          {isExpanded && replies.length > 3 && (
            <Button variant="ghost" size="xs" onClick={() => setIsExpanded(false)}>
              <ChevronUp className="h-3 w-3" /> Collapse replies
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
