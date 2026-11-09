import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Clock, Timer, User, X } from 'lucide-react';
import { useState } from 'react';

import { issuesApi } from '@/api/issues.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Progress } from '@/components/ui/Progress';
import { Spinner } from '@/components/ui/Spinner';
import { UserName } from '@/components/ui/UserName';
import { useIssueInvalidation } from '@/hooks/useIssueInvalidation';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import type { Issue } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

interface IssueDetailWorklogProps {
  issue: Issue;
  projectId: string;
  num: string;
  editingField: string | null;
  onEditField: (field: string | null) => void;
  onUpdate: (data: Record<string, unknown>) => void;
}

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null || mins === 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.projectId
 * @param root0.num
 * @param root0.editingField
 * @param root0.onEditField
 * @param root0.onUpdate
 */
export function IssueDetailWorklog({
  issue,
  projectId,
  num,
  editingField,
  onEditField,
  onUpdate,
}: IssueDetailWorklogProps) {
  const { invalidateIssue, invalidateWorklogs } = useIssueInvalidation(projectId, num);
  const [showLogWork, setShowLogWork] = useState(false);
  const [showEntries, setShowEntries] = useState(false);
  const [logWorkHours, setLogWorkHours] = useState('');
  const [logWorkMinutes, setLogWorkMinutes] = useState('');
  const [logWorkDesc, setLogWorkDesc] = useState('');

  const { data: worklogs = [], error: worklogsError } = useQuery({
    queryKey: ['worklogs', projectId, num],
    queryFn: () => issuesApi.getWorklogs(projectId, parseInt(num)),
    enabled: !!projectId && !!num,
  });

  const logWorkMutation = useMutationWithToast(
    (data: { minutes: number; description?: string }) =>
      issuesApi.logWork(projectId, parseInt(num), data),
    {
      successMessage: null,
      onSuccess: () => {
        invalidateIssue();
        invalidateWorklogs();
        setShowLogWork(false);
        setLogWorkHours('');
        setLogWorkMinutes('');
        setLogWorkDesc('');
      },
    },
  );

  function handleLogWork() {
    const h = parseInt(logWorkHours) || 0;
    const m = parseInt(logWorkMinutes) || 0;
    const totalMinutes = h * 60 + m;
    if (totalMinutes <= 0) return;
    logWorkMutation.mutate({
      minutes: totalMinutes,
      description: logWorkDesc || undefined,
    });
  }

  if (worklogsError)
    return <div className="p-4 text-center text-danger">Failed to load worklogs</div>;

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-text-tertiary font-medium mb-1.5">
        Time Tracking
      </p>
      <div className="space-y-2">
        {/* Estimate */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Estimate</span>
          {editingField === 'timeEstimate' ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                placeholder="hrs"
                defaultValue={issue.timeEstimate ? Math.floor(issue.timeEstimate / 60) : ''}
                className="w-12 px-1.5 py-0.5 text-xs text-right"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const hrs = parseInt((e.target as HTMLInputElement).value) || 0;
                    const minsEl = (e.target as HTMLInputElement)
                      .closest('.flex')
                      ?.querySelector('input:last-of-type') as HTMLInputElement;
                    const mins = parseInt(minsEl?.value) || 0;
                    onUpdate({ timeEstimate: hrs * 60 + mins || null });
                  }
                  if (e.key === 'Escape') onEditField(null);
                }}
              />
              <span className="text-xs text-text-tertiary">h</span>
              <Input
                type="number"
                min={0}
                max={59}
                placeholder="min"
                defaultValue={issue.timeEstimate ? issue.timeEstimate % 60 : ''}
                className="w-12 px-1.5 py-0.5 text-xs text-right"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const mins = parseInt((e.target as HTMLInputElement).value) || 0;
                    const hrsEl = (e.target as HTMLInputElement)
                      .closest('.flex')
                      ?.querySelector('input:first-of-type') as HTMLInputElement;
                    const hrs = parseInt(hrsEl?.value) || 0;
                    onUpdate({ timeEstimate: hrs * 60 + mins || null });
                  }
                  if (e.key === 'Escape') onEditField(null);
                }}
                onBlur={(e) => {
                  const mins = parseInt(e.target.value) || 0;
                  const hrsEl = (e.target as HTMLInputElement)
                    .closest('.flex')
                    ?.querySelector('input:first-of-type') as HTMLInputElement;
                  const hrs = parseInt(hrsEl?.value) || 0;
                  onUpdate({ timeEstimate: hrs * 60 + mins || null });
                }}
              />
              <span className="text-xs text-text-tertiary">m</span>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEditField('timeEstimate')}
              className="text-xs hover:text-primary"
            >
              <Timer className="h-3 w-3" />
              {issue.timeEstimate ? formatMinutes(issue.timeEstimate) : 'Set estimate'}
            </Button>
          )}
        </div>

        {/* Time Spent */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Logged</span>
          <span className="text-xs font-medium">{formatMinutes(issue.timeSpent)}</span>
        </div>

        {/* Progress bar */}
        {issue.timeEstimate && issue.timeEstimate > 0 && (
          <div>
            <Progress
              value={Math.min(100, ((issue.timeSpent ?? 0) / issue.timeEstimate) * 100)}
              size="sm"
              variant={(issue.timeSpent ?? 0) > issue.timeEstimate ? 'danger' : 'primary'}
            />
            <p className="text-[10px] text-text-tertiary mt-0.5 text-right">
              {formatMinutes(issue.timeSpent)} / {formatMinutes(issue.timeEstimate)}
            </p>
          </div>
        )}

        {/* Worklog entries */}
        {worklogs.length > 0 && (
          <div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowEntries(!showEntries)}
              className="text-[11px] text-text-tertiary hover:text-text w-full justify-start px-0"
              title={showEntries ? 'Hide log entries' : 'Show log entries'}
            >
              {showEntries ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              <User className="h-3 w-3" />
              {worklogs.length} log entr{worklogs.length === 1 ? 'y' : 'ies'}
            </Button>
            {showEntries && (
              <div className="mt-1.5 space-y-1.5 max-h-40 overflow-y-auto">
                {worklogs.map((w) => (
                  <div key={w.id} className="flex items-start gap-1.5 text-[11px]">
                    <Avatar name={w.user.displayName} size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">
                          <UserName user={w.user} />
                        </span>
                        <span className="text-text-tertiary shrink-0 ml-1">
                          {formatMinutes(w.minutes)}
                        </span>
                      </div>
                      {w.description && (
                        <p className="text-text-tertiary truncate">{w.description}</p>
                      )}
                      <p className="text-text-tertiary/60">{formatRelative(w.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Log Work button / form */}
        {showLogWork ? (
          <div className="space-y-2 border border-border rounded-lg p-2">
            <div className="flex items-center gap-2">
              <div>
                <Input
                  label="Hours"
                  type="number"
                  min={0}
                  value={logWorkHours}
                  onChange={(e) => setLogWorkHours(e.target.value)}
                  className="w-14 px-1.5 py-1 text-xs"
                  placeholder="0"
                  autoFocus
                />
              </div>
              <div>
                <Input
                  label="Minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={logWorkMinutes}
                  onChange={(e) => setLogWorkMinutes(e.target.value)}
                  className="w-14 px-1.5 py-1 text-xs"
                  placeholder="0"
                />
              </div>
            </div>
            <MarkdownEditor
              compact
              value={logWorkDesc}
              onChange={setLogWorkDesc}
              placeholder="Description (optional)"
              projectId={projectId}
            />
            <div className="flex gap-1">
              <Button
                size="xs"
                onClick={handleLogWork}
                disabled={
                  logWorkMutation.isPending ||
                  (!(parseInt(logWorkHours) || 0) && !(parseInt(logWorkMinutes) || 0))
                }
              >
                {logWorkMutation.isPending ? <Spinner size="xs" /> : <Check className="h-3 w-3" />}
                Log
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setShowLogWork(false);
                  setLogWorkHours('');
                  setLogWorkMinutes('');
                  setLogWorkDesc('');
                }}
              >
                <X className="h-3 w-3" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="xs"
            onClick={() => setShowLogWork(true)}
            className="w-full"
          >
            <Clock className="h-3 w-3" /> Log Work
          </Button>
        )}
      </div>
    </div>
  );
}
