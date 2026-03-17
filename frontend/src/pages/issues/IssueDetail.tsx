import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Check, X, Pencil, MessageSquare, Plus } from 'lucide-react';
import { issuesApi } from '@/api/issues.api';
import { projectsApi } from '@/api/projects.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { reposApi } from '@/api/repos.api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { PRIORITY_COLORS, ISSUE_TYPE_ICONS, PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '@/lib/constants';
import { cn, formatRelative } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import IssueDevelopmentCard from './IssueDevelopmentCard';
import IssueLinkModal from './IssueLinkModal';

export default function IssueDetail() {
  const { org, team: teamSlug, project: projectSlug, num } = useParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
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

  const { data: links = [] } = useQuery({
    queryKey: ['issue-links', currentProject?.id, issue?.number],
    queryFn: () => issuesApi.listLinks(currentProject!.id, issue!.number),
    enabled: !!currentProject?.id && !!issue?.number,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => issuesApi.update(currentProject!.id, parseInt(num!), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', currentProject?.id, num] });
      setEditingTitle(false);
      setEditingField(null);
    },
  });

  const commentMutation = useMutation({
    mutationFn: () => issuesApi.addComment(currentProject!.id, parseInt(num!), commentBody),
    onSuccess: () => {
      setCommentBody('');
      queryClient.invalidateQueries({ queryKey: ['issue', currentProject?.id, num] });
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
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-3 gap-6">
        {/* Main content */}
        <div className="col-span-2">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-lg mt-1">{ISSUE_TYPE_ICONS[issue.type]}</span>
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                    className="flex-1 text-xl font-bold bg-transparent border-b-2 border-primary outline-none py-0.5"
                  />
                  <button onClick={saveTitle} className="p-1 rounded hover:bg-surface-tertiary text-success">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditingTitle(false)} className="p-1 rounded hover:bg-surface-tertiary text-text-tertiary">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <h1 className="text-xl font-bold group cursor-pointer" onClick={startEditTitle}>
                  {issue.title}
                  <Pencil className="h-3.5 w-3.5 ml-2 inline opacity-0 group-hover:opacity-50 transition-opacity" />
                </h1>
              )}
              <p className="text-sm text-text-secondary">{issue.key} &middot; opened {formatRelative(issue.createdAt)} by {issue.creator?.displayName}</p>
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
                      <span className="text-sm font-medium text-text">{comment.author.displayName}</span>
                      <span className="text-xs text-text-tertiary">{formatRelative(comment.createdAt)}</span>
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
            <MarkdownEditor
              value={commentBody}
              onChange={setCommentBody}
              placeholder="Write a comment..."
              compact
            />
            <Button
              size="sm"
              disabled={!commentBody.trim() || commentMutation.isPending}
              onClick={() => commentMutation.mutate()}
            >
              {commentMutation.isPending ? <Spinner className="h-4 w-4" /> : <><MessageSquare className="h-4 w-4" /> Comment</>}
            </Button>
          </div>
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
                    <button key={key} onClick={() => updateMutation.mutate({ type: key })}
                      className={cn('text-xs px-2 py-1 rounded-md border transition-colors', issue.type === key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-primary')}>
                      {ISSUE_TYPE_ICONS[key as keyof typeof ISSUE_TYPE_ICONS]} {label}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setEditingField('type')} className="text-sm hover:text-primary transition-colors">
                  {ISSUE_TYPE_ICONS[issue.type]} {ISSUE_TYPE_LABELS[issue.type]}
                </button>
              )}
            </div>

            {/* Priority - click to edit */}
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Priority</p>
              {editingField === 'priority' ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <button key={key} onClick={() => updateMutation.mutate({ priority: key })}
                      className={cn('text-xs px-2 py-1 rounded-md border transition-colors', issue.priority === key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-primary')}>
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setEditingField('priority')} className="hover:opacity-80 transition-opacity">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}>
                    {PRIORITY_LABELS[issue.priority]}
                  </span>
                </button>
              )}
            </div>

            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Assignee</p>
              {issue.assignee ? (
                <div className="flex items-center gap-2">
                  <Avatar name={issue.assignee.displayName} size="sm" />
                  <span className="text-sm">{issue.assignee.displayName}</span>
                </div>
              ) : (
                <span className="text-sm text-text-secondary">Unassigned</span>
              )}
            </div>
            {issue.labels?.length > 0 && (
              <div>
                <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Labels</p>
                <div className="flex flex-wrap gap-1">
                  {issue.labels.map((l) => <Badge key={l.id}>{l.name}</Badge>)}
                </div>
              </div>
            )}
            {issue.dueDate && (
              <div>
                <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Due date</p>
                <span className="text-sm">{new Date(issue.dueDate).toLocaleDateString()}</span>
              </div>
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
                queryClient.invalidateQueries({ queryKey: ['issue-links', currentProject.id, issue.number] });
                setShowLinkModal(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
