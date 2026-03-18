import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  X,
  Pencil,
  MessageSquare,
  Plus,
  User,
  Target,
  Hash,
  ChevronRight,
  Network,
  Search,
  Clock,
  Timer,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router';

import IssueDevelopmentCard from './IssueDevelopmentCard';
import IssueLinkModal from './IssueLinkModal';

import { activityApi } from '@/api/activity.api';
import {
  customFieldsApi,
  type CustomFieldDefinition,
  type CustomFieldValue,
} from '@/api/custom-fields.api';
import { issuesApi } from '@/api/issues.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { reposApi } from '@/api/repos.api';
import { sprintsApi } from '@/api/sprints.api';
import { teamsApi } from '@/api/teams.api';
import { ActivityFeed } from '@/components/ActivityFeed';
import { CustomFieldRenderer } from '@/components/CustomFieldRenderer';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { MentionInput } from '@/components/MentionInput';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Progress } from '@/components/ui/Progress';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { PRIORITY_COLORS, PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '@/lib/constants';
import { cn, formatRelative } from '@/lib/utils';

/**
 *
 */
export default function IssueDetail() {
  const { org, team: teamSlug, project: projectSlug, num } = useParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showLogWork, setShowLogWork] = useState(false);
  const [logWorkHours, setLogWorkHours] = useState('');
  const [logWorkMinutes, setLogWorkMinutes] = useState('');
  const [logWorkDesc, setLogWorkDesc] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', currentProject?.id, num],
    queryFn: () => issuesApi.get(currentProject!.id, parseInt(num!)),
    enabled: !!currentProject?.id && !!num,
  });

  const { data: repos = [] } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: teamDetail } = useQuery({
    queryKey: ['team-detail', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: links = [] } = useQuery({
    queryKey: ['issue-links', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.listLinks(currentProject!.id, issue!.number),
    enabled: !!currentProject?.id && !!issue?.number,
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', currentProject?.id],
    queryFn: () => sprintsApi.list(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  const { data: activityData } = useQuery({
    queryKey: ['activity', currentProject?.id, num],
    queryFn: () => activityApi.listIssueActivity(currentProject!.id, parseInt(num!), { limit: 50 }),
    enabled: !!currentProject?.id && !!num,
  });

  const { data: children = [] } = useQuery({
    queryKey: ['issue-children', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.getChildren(currentProject!.id, issue!.number),
    enabled: !!currentProject?.id && !!issue?.number,
  });

  const { data: progress } = useQuery({
    queryKey: ['issue-progress', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.getProgress(currentProject!.id, issue!.number),
    enabled: !!currentProject?.id && !!issue?.number && children.length > 0,
  });

  // Issues for parent picker
  const { data: allIssues } = useQuery({
    queryKey: ['issues', currentProject?.id],
    queryFn: () => issuesApi.list(currentProject!.id, { limit: '200' }),
    enabled: !!currentProject?.id && editingField === 'parent',
  });

  // Custom field definitions for the project
  const { data: customFieldDefs = [] } = useQuery({
    queryKey: ['custom-fields', currentProject?.id],
    queryFn: () => customFieldsApi.listDefinitions(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Custom field values for this issue
  const { data: customFieldValues = [] } = useQuery({
    queryKey: ['custom-field-values', issue?.id],
    queryFn: () => customFieldsApi.getFieldValues(issue!.id),
    enabled: !!issue?.id,
  });

  const setFieldValueMutation = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: string }) =>
      customFieldsApi.setFieldValue(issue!.id, fieldId, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-field-values', issue?.id] });
    },
  });

  const [parentSearch, setParentSearch] = useState('');

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      issuesApi.update(currentProject!.id, parseInt(num!), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['board', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['issues', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['activity', currentProject?.id, num] });
      setEditingTitle(false);
      setEditingField(null);
    },
  });

  const commentMutation = useMutation({
    mutationFn: () => issuesApi.addComment(currentProject!.id, parseInt(num!), commentBody),
    onSuccess: () => {
      setCommentBody('');
      queryClient.invalidateQueries({ queryKey: ['issue', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['activity', currentProject?.id, num] });
    },
  });

  const setParentMutation = useMutation({
    mutationFn: (parentIssueNumber: number | null) =>
      issuesApi.setParent(currentProject!.id, parseInt(num!), parentIssueNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['issues', currentProject?.id] });
      queryClient.invalidateQueries({ queryKey: ['issue-children'] });
      queryClient.invalidateQueries({ queryKey: ['issue-progress'] });
      queryClient.invalidateQueries({ queryKey: ['roadmap', currentProject?.id] });
      setEditingField(null);
      setParentSearch('');
    },
  });

  const logWorkMutation = useMutation({
    mutationFn: (data: { minutes: number; description?: string }) =>
      issuesApi.logWork(currentProject!.id, parseInt(num!), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['activity', currentProject?.id, num] });
      queryClient.invalidateQueries({ queryKey: ['worklogs', currentProject?.id, num] });
      setShowLogWork(false);
      setLogWorkHours('');
      setLogWorkMinutes('');
      setLogWorkDesc('');
    },
  });

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  if (isLoading) return <PageLoader />;
  if (!issue) return <div className="text-center py-16 text-text-secondary">Issue not found</div>;

  function formatMinutes(mins: number | null | undefined): string {
    if (mins == null || mins === 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

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

  function startEditTitle() {
    setTitleDraft(issue!.title);
    setEditingTitle(true);
  }

  function saveTitle() {
    if (titleDraft.trim() && titleDraft !== issue!.title) {
      updateMutation.mutate({ title: titleDraft });
    } else {
      setEditingTitle(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2">
          <div className="flex items-start gap-3 mb-4">
            <IssueTypeIcon type={issue.type} className="h-5 w-5 mt-1" />
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                    className="flex-1 text-xl font-bold bg-transparent border-b-2 border-primary outline-none py-0.5"
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={saveTitle}
                    className="text-success"
                    title="Save"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditingTitle(false)}
                    className="text-text-tertiary"
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <h1 className="text-xl font-bold group cursor-pointer" onClick={startEditTitle}>
                  {issue.title}
                  <Pencil className="h-3.5 w-3.5 ml-2 inline opacity-0 group-hover:opacity-50 transition-opacity" />
                </h1>
              )}
              <p className="text-sm text-text-secondary">
                {issue.key} &middot; opened {formatRelative(issue.createdAt)} by{' '}
                {issue.creator?.displayName}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="rounded-lg border border-border bg-surface p-4 mb-6">
            {issue.body ? (
              <MarkdownRenderer content={issue.body} />
            ) : (
              <p className="text-text-secondary italic">No description provided.</p>
            )}
          </div>

          {/* Activity timeline */}
          <h2 className="text-lg font-semibold mb-3">Activity ({issue.comments?.length ?? 0})</h2>
          <div className="relative mb-4">
            {/* Timeline line */}
            {(issue.comments?.length ?? 0) > 0 && (
              <div className="absolute left-4 top-6 bottom-6 w-px bg-border-light" />
            )}
            <div className="space-y-4">
              {issue.comments?.map((comment) => (
                <div key={comment.id} className="relative flex gap-3">
                  <div className="relative z-10">
                    <Avatar name={comment.author.displayName} size="sm" />
                  </div>
                  <div className="flex-1 rounded-lg border border-border bg-surface overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 bg-surface-tertiary/50 border-b border-border-light">
                      <span className="text-sm font-medium text-text">
                        {comment.author.displayName}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        {formatRelative(comment.createdAt)}
                      </span>
                    </div>
                    <div className="px-4 py-3">
                      <MarkdownRenderer content={comment.body} className="text-sm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add comment */}
          <div className="space-y-2">
            <MentionInput
              value={commentBody}
              onChange={setCommentBody}
              placeholder="Write a comment... Use @ to mention users, # to reference issues"
              rows={3}
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
          {activityData && activityData.activities.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">History</h2>
              <ActivityFeed activities={activityData.activities} />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Status</p>
              <Badge variant="primary">{issue.column?.name ?? 'Backlog'}</Badge>
            </div>

            {/* Type - click to edit */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Type</p>
              {editingField === 'type' ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(ISSUE_TYPE_LABELS).map(([key, label]) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="xs"
                      onClick={() => updateMutation.mutate({ type: key })}
                      className={cn(
                        issue.type === key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-text-secondary hover:border-primary',
                      )}
                    >
                      <IssueTypeIcon type={key} className="h-3 w-3" /> {label}
                    </Button>
                  ))}
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingField('type')}
                  className="text-sm hover:text-primary"
                >
                  <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5" />{' '}
                  {ISSUE_TYPE_LABELS[issue.type]}
                </Button>
              )}
            </div>

            {/* Priority - click to edit */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Priority</p>
              {editingField === 'priority' ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="xs"
                      onClick={() => updateMutation.mutate({ priority: key })}
                      className={cn(
                        issue.priority === key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-text-secondary hover:border-primary',
                      )}
                    >
                      <Check
                        className={cn(
                          'h-3 w-3',
                          issue.priority === key ? 'opacity-100' : 'opacity-0',
                        )}
                      />{' '}
                      {label}
                    </Button>
                  ))}
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingField('priority')}
                  className="hover:opacity-80"
                >
                  <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}
                  >
                    {PRIORITY_LABELS[issue.priority]}
                  </span>
                </Button>
              )}
            </div>

            {/* Assignee - click to edit */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Assignee</p>
              {editingField === 'assignee' ? (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => updateMutation.mutate({ assigneeId: null })}
                    className={cn(
                      'w-full justify-start',
                      !issue.assignee
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-primary',
                    )}
                  >
                    <User className="h-3 w-3" /> Unassigned
                  </Button>
                  {teamDetail?.members?.map((m: { user: { id: string; displayName: string } }) => (
                    <Button
                      key={m.user.id}
                      variant="outline"
                      size="xs"
                      onClick={() => updateMutation.mutate({ assigneeId: m.user.id })}
                      className={cn(
                        'w-full justify-start',
                        issue.assignee?.id === m.user.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-text-secondary hover:border-primary',
                      )}
                    >
                      <Avatar name={m.user.displayName} size="sm" />
                      {m.user.displayName}
                    </Button>
                  ))}
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingField('assignee')}
                  className="hover:opacity-80"
                >
                  {issue.assignee ? (
                    <>
                      <Avatar name={issue.assignee.displayName} size="sm" />
                      <span className="text-sm">{issue.assignee.displayName}</span>
                    </>
                  ) : (
                    <>
                      <User className="h-3.5 w-3.5" />
                      <span className="text-sm text-text-secondary hover:text-primary transition-colors">
                        Unassigned
                      </span>
                    </>
                  )}
                </Button>
              )}
            </div>
            {issue.labels?.length > 0 && (
              <div>
                <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Labels</p>
                <div className="flex flex-wrap gap-1">
                  {issue.labels.map((l) => (
                    <Badge key={l.id}>{l.name}</Badge>
                  ))}
                </div>
              </div>
            )}
            {/* Story Points */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">
                Story Points
              </p>
              {editingField === 'storyPoints' ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={issue.storyPoints ?? ''}
                    className="w-16 rounded border border-border bg-surface px-2 py-1 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        updateMutation.mutate({
                          storyPoints: val ? parseInt(val) : null,
                        });
                      }
                      if (e.key === 'Escape') setEditingField(null);
                    }}
                    onBlur={(e) => {
                      const val = e.target.value;
                      updateMutation.mutate({
                        storyPoints: val ? parseInt(val) : null,
                      });
                    }}
                  />
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingField('storyPoints')}
                  className="hover:opacity-80"
                >
                  <Hash className="h-3 w-3" />
                  <span className="text-sm">
                    {issue.storyPoints != null ? `${issue.storyPoints} points` : 'Set points'}
                  </span>
                </Button>
              )}
            </div>

            {/* Sprint */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Sprint</p>
              {editingField === 'sprint' ? (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => updateMutation.mutate({ sprintId: null })}
                    className={cn(
                      'w-full justify-start',
                      !issue.sprintId
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-secondary hover:border-primary',
                    )}
                  >
                    <Target className="h-3 w-3" /> Backlog
                  </Button>
                  {sprints
                    .filter((s) => s.status !== 'COMPLETED')
                    .map((s) => (
                      <Button
                        key={s.id}
                        variant="outline"
                        size="xs"
                        onClick={() => updateMutation.mutate({ sprintId: s.id })}
                        className={cn(
                          'w-full justify-start',
                          issue.sprintId === s.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-text-secondary hover:border-primary',
                        )}
                      >
                        <Target className="h-3 w-3" /> {s.name}
                      </Button>
                    ))}
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingField('sprint')}
                  className="hover:opacity-80"
                >
                  <Target className="h-3.5 w-3.5" />
                  <span className="text-sm text-text-secondary hover:text-primary transition-colors">
                    {issue.sprint?.name ?? 'Backlog'}
                  </span>
                </Button>
              )}
            </div>

            {issue.dueDate && (
              <div>
                <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Due date</p>
                <span className="text-sm">{new Date(issue.dueDate).toLocaleDateString()}</span>
              </div>
            )}

            {/* Time Tracking */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">
                Time Tracking
              </p>
              <div className="space-y-2">
                {/* Estimate */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Estimate</span>
                  {editingField === 'timeEstimate' ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        placeholder="hrs"
                        defaultValue={issue.timeEstimate ? Math.floor(issue.timeEstimate / 60) : ''}
                        className="w-12 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-right"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const hrs = parseInt((e.target as HTMLInputElement).value) || 0;
                            const minsEl = (e.target as HTMLInputElement).nextElementSibling
                              ?.nextElementSibling as HTMLInputElement;
                            const mins = parseInt(minsEl?.value) || 0;
                            updateMutation.mutate({ timeEstimate: hrs * 60 + mins || null });
                          }
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                      />
                      <span className="text-xs text-text-tertiary">h</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        placeholder="min"
                        defaultValue={issue.timeEstimate ? issue.timeEstimate % 60 : ''}
                        className="w-12 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-right"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const mins = parseInt((e.target as HTMLInputElement).value) || 0;
                            const hrsEl = (e.target as HTMLInputElement).previousElementSibling
                              ?.previousElementSibling as HTMLInputElement;
                            const hrs = parseInt(hrsEl?.value) || 0;
                            updateMutation.mutate({ timeEstimate: hrs * 60 + mins || null });
                          }
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                        onBlur={(e) => {
                          const mins = parseInt(e.target.value) || 0;
                          const hrsEl = e.target.previousElementSibling
                            ?.previousElementSibling as HTMLInputElement;
                          const hrs = parseInt(hrsEl?.value) || 0;
                          updateMutation.mutate({ timeEstimate: hrs * 60 + mins || null });
                        }}
                      />
                      <span className="text-xs text-text-tertiary">m</span>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setEditingField('timeEstimate')}
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

                {/* Log Work button / form */}
                {showLogWork ? (
                  <div className="space-y-2 border border-border rounded-lg p-2">
                    <div className="flex items-center gap-2">
                      <div>
                        <label className="text-[10px] text-text-tertiary">Hours</label>
                        <input
                          type="number"
                          min={0}
                          value={logWorkHours}
                          onChange={(e) => setLogWorkHours(e.target.value)}
                          className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-xs"
                          placeholder="0"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-text-tertiary">Minutes</label>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          value={logWorkMinutes}
                          onChange={(e) => setLogWorkMinutes(e.target.value)}
                          className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-xs"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <textarea
                      value={logWorkDesc}
                      onChange={(e) => setLogWorkDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-xs resize-none"
                      rows={2}
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
                        {logWorkMutation.isPending ? (
                          <Spinner className="h-3 w-3" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
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

            {/* Parent Issue */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">
                Parent Issue
              </p>
              {editingField === 'parent' ? (
                <div className="space-y-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-tertiary pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search issues..."
                      value={parentSearch}
                      onChange={(e) => setParentSearch(e.target.value)}
                      className="w-full rounded border border-border bg-surface pl-7 pr-2 py-1 text-xs"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setParentMutation.mutate(null)}
                      className={cn(
                        'w-full justify-start',
                        !issue.parentId
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-text-secondary hover:border-primary',
                      )}
                    >
                      <X className="h-3 w-3" /> No parent
                    </Button>
                    {allIssues?.issues
                      ?.filter(
                        (i) =>
                          i.number !== issue.number &&
                          (!parentSearch.trim() ||
                            i.title.toLowerCase().includes(parentSearch.toLowerCase()) ||
                            i.key.toLowerCase().includes(parentSearch.toLowerCase())),
                      )
                      .slice(0, 10)
                      .map((i) => (
                        <Button
                          key={i.id}
                          variant="outline"
                          size="xs"
                          onClick={() => setParentMutation.mutate(i.number)}
                          className={cn(
                            'w-full justify-start text-left',
                            issue.parentId === i.id
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-text-secondary hover:border-primary',
                          )}
                        >
                          <IssueTypeIcon type={i.type} className="h-3 w-3 shrink-0" />
                          <span className="font-mono text-[10px] shrink-0">{i.key}</span>
                          <span className="truncate">{i.title}</span>
                        </Button>
                      ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setEditingField(null);
                      setParentSearch('');
                    }}
                    className="text-text-tertiary"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingField('parent')}
                  className="hover:opacity-80"
                >
                  {issue.parent ? (
                    <>
                      <IssueTypeIcon type="EPIC" className="h-3.5 w-3.5" />
                      <span className="text-sm text-primary font-mono">{issue.parent.key}</span>
                      <span className="text-sm truncate">{issue.parent.title}</span>
                    </>
                  ) : (
                    <>
                      <Network className="h-3.5 w-3.5" />
                      <span className="text-sm text-text-secondary hover:text-primary transition-colors">
                        Set parent
                      </span>
                    </>
                  )}
                </Button>
              )}
            </div>
            {/* Custom Fields */}
            {customFieldDefs.length > 0 && (
              <div className="border-t border-border-light pt-3 mt-3">
                <p className="text-xs text-text-secondary uppercase font-semibold mb-2">
                  Custom Fields
                </p>
                <div className="space-y-2">
                  {customFieldDefs.map((def: CustomFieldDefinition) => {
                    const fieldValue = customFieldValues.find(
                      (v: CustomFieldValue) => v.fieldDefinitionId === def.id,
                    );
                    return (
                      <div key={def.id}>
                        <p className="text-xs text-text-tertiary mb-0.5">{def.name}</p>
                        <CustomFieldRenderer
                          definition={def}
                          value={fieldValue?.value}
                          onChange={(value) =>
                            setFieldValueMutation.mutate({ fieldId: def.id, value })
                          }
                          teamMembers={teamDetail?.members}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sub-issues */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Sub-issues</h3>
              <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
                <Button variant="ghost" size="sm" title="Add sub-issue">
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </Link>
            </div>
            {progress && progress.total > 0 && (
              <div className="mb-2">
                <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-1">
                  <span>
                    {progress.completed} of {progress.total} completed
                  </span>
                  <span>{progress.percentage}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-primary-light overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
              </div>
            )}
            {children.length > 0 ? (
              <div className="space-y-0.5">
                {children.map((child) => (
                  <Link
                    key={child.id}
                    to={`/${org}/${teamSlug}/${projectSlug}/issues/${child.number}`}
                    className="flex items-center gap-2 py-1 px-1 rounded hover:bg-surface-secondary transition-colors group"
                  >
                    <IssueTypeIcon type={child.type} className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono text-[10px] text-text-tertiary shrink-0">
                      {child.key}
                    </span>
                    <span
                      className={cn(
                        'text-xs truncate flex-1',
                        child.column?.isDone && 'line-through text-text-tertiary',
                      )}
                    >
                      {child.title}
                    </span>
                    {child.column && (
                      <Badge
                        variant={child.column.isDone ? 'default' : 'primary'}
                        className="text-[10px] px-1.5"
                      >
                        {child.column.name}
                      </Badge>
                    )}
                    <ChevronRight className="h-3 w-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">No sub-issues yet.</p>
            )}
          </div>

          {/* Development Card */}
          {currentProject && issue && (
            <IssueDevelopmentCard
              projectId={currentProject.id}
              issueNumber={issue.number}
              issueId={issue.id}
              org={org!}
              teamSlug={teamSlug!}
              repos={repos}
            />
          )}

          {/* Linked Issues */}
          {links.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Linked Issues</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowLinkModal(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <div className="space-y-1">
                {links.map((link) => (
                  <div key={link.id} className="flex items-center gap-2 text-xs">
                    <span className="text-text-tertiary capitalize">
                      {link.type.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span className="font-mono text-primary">
                      {link.fromId === issue?.id ? link.toKey : link.fromKey}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold">Linked Issues</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowLinkModal(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <p className="text-xs text-text-tertiary">No linked issues yet.</p>
            </div>
          )}

          {showLinkModal && currentProject && issue && (
            <IssueLinkModal
              projectId={currentProject.id}
              issueNumber={issue.number}
              onClose={() => setShowLinkModal(false)}
              onLinked={() => {
                queryClient.invalidateQueries({
                  queryKey: ['issue-links', currentProject.id, issue.number],
                });
                setShowLinkModal(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
