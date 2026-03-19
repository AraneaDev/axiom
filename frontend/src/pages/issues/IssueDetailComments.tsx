import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';

import { type ActivityEvent } from '@/api/activity.api';
import { issuesApi } from '@/api/issues.api';
import { ActivityFeed } from '@/components/ActivityFeed';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import type { Issue } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

interface IssueDetailCommentsProps {
  issue: Issue;
  projectId: string;
  num: string;
  activities: ActivityEvent[];
  commentBody: string;
  onCommentBodyChange: (value: string) => void;
  basePath?: string;
}

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.projectId
 * @param root0.num
 * @param root0.activities
 * @param root0.commentBody
 * @param root0.onCommentBodyChange
 * @param root0.basePath
 */
export function IssueDetailComments({
  issue,
  projectId,
  num,
  activities,
  commentBody,
  onCommentBodyChange,
  basePath,
}: IssueDetailCommentsProps) {
  const queryClient = useQueryClient();

  const commentMutation = useMutation({
    mutationFn: () => issuesApi.addComment(projectId, parseInt(num), commentBody),
    onSuccess: () => {
      onCommentBodyChange('');
      queryClient.invalidateQueries({ queryKey: ['issue', projectId, num] });
      queryClient.invalidateQueries({ queryKey: ['activity', projectId, num] });
    },
  });

  return (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary mb-4">
        Activity
        {(issue.comments?.length ?? 0) > 0 && (
          <span className="ml-2 inline-flex items-center rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary normal-case tracking-normal">
            {issue.comments?.length}
          </span>
        )}
      </h2>
      <div className="relative mb-6">
        {(issue.comments?.length ?? 0) > 0 && (
          <div className="absolute left-4 top-6 bottom-6 w-px bg-border-light" />
        )}
        <div className="space-y-4">
          {issue.comments?.map((comment) => (
            <div key={comment.id} className="relative flex gap-3">
              <div className="relative z-10 shrink-0">
                <Avatar name={comment.author.displayName} size="sm" />
              </div>
              <div className="flex-1 rounded-lg border border-border bg-surface overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary/40 border-b border-border-light">
                  <span className="text-sm font-medium text-text">
                    {comment.author.displayName}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {formatRelative(comment.createdAt)}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <MarkdownRenderer
                    content={comment.body}
                    className="text-sm"
                    basePath={basePath}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add comment */}
      <div className="space-y-2">
        <MarkdownEditor
          value={commentBody}
          onChange={onCommentBodyChange}
          placeholder="Write a comment... Use @ to mention users, # to reference issues"
          compact
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

      {/* Activity stream */}
      {activities.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">History</h2>
          <ActivityFeed activities={activities} />
        </div>
      )}
    </>
  );
}
