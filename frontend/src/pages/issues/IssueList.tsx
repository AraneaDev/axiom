import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { Plus, Filter, ArrowUpDown, LayoutList, LayoutGrid, LayoutDashboard, ChevronDown, X } from 'lucide-react';
import { issuesApi } from '@/api/issues.api';
import { projectsApi } from '@/api/projects.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { PRIORITY_COLORS, PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '@/lib/constants';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { cn, formatRelative } from '@/lib/utils';

type SortField = 'createdAt' | 'updatedAt' | 'priority';
type SortDir = 'asc' | 'desc';
type ViewMode = 'list' | 'grid';

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };

export default function IssueList() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const [searchParams] = useSearchParams();

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

  const filters: Record<string, string> = {};
  for (const [k, v] of searchParams.entries()) filters[k] = v;

  const { data, isLoading } = useQuery({
    queryKey: ['issues', currentProject?.id, filters],
    queryFn: () => issuesApi.list(currentProject!.id, filters),
    enabled: !!currentProject?.id,
  });

  // Filter state
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showSort, setShowSort] = useState(false);

  // View mode with localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('issueListView') as ViewMode) || 'list'; } catch { return 'list'; }
  });
  useEffect(() => { localStorage.setItem('issueListView', viewMode); }, [viewMode]);

  const toggleFilter = (arr: string[], val: string, setter: (v: string[]) => void) => {
    setter(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);
  };

  // Extract unique assignees and labels for filter options
  const allAssignees = useMemo(() => {
    const map = new Map<string, { id: string; displayName: string }>();
    for (const issue of data?.issues ?? []) {
      if (issue.assignee) map.set(issue.assignee.id, issue.assignee);
    }
    return Array.from(map.values());
  }, [data?.issues]);

  const allLabels = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const issue of data?.issues ?? []) {
      for (const label of issue.labels ?? []) map.set(label.id, label);
    }
    return Array.from(map.values());
  }, [data?.issues]);

  // Filtered and sorted issues
  const filteredIssues = useMemo(() => {
    let issues = data?.issues ?? [];
    if (typeFilter.length) issues = issues.filter((i) => typeFilter.includes(i.type));
    if (priorityFilter.length) issues = issues.filter((i) => priorityFilter.includes(i.priority));
    if (assigneeFilter.length) issues = issues.filter((i) => i.assignee && assigneeFilter.includes(i.assignee.id));
    if (labelFilter.length) issues = issues.filter((i) => i.labels?.some((l) => labelFilter.includes(l.id)));
    issues = [...issues].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'priority') {
        cmp = (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
      } else {
        cmp = new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return issues;
  }, [data?.issues, typeFilter, priorityFilter, assigneeFilter, labelFilter, sortField, sortDir]);

  const activeFilterCount = typeFilter.length + priorityFilter.length + assigneeFilter.length + labelFilter.length;

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{currentProject?.name} Issues</h1>
          <p className="text-sm text-text-secondary">{data?.total ?? 0} issues</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/${org}/${teamSlug}/${projectSlug}/board`}>
            <Button variant="secondary" size="sm"><LayoutDashboard className="h-4 w-4" /> Board</Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
            <Button size="sm"><Plus className="h-4 w-4" /> New Issue</Button>
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-3.5 w-3.5" /> Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 bg-primary text-white text-[10px] rounded-full px-1.5 py-0.5">{activeFilterCount}</span>
          )}
        </Button>

        {/* Sort dropdown */}
        <div className="relative">
          <Button variant="secondary" size="sm" onClick={() => setShowSort(!showSort)}>
            <ArrowUpDown className="h-3.5 w-3.5" /> Sort
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showSort && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSort(false)} />
              <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface-elevated shadow-lg py-1 z-20">
                {([['createdAt', 'Created'], ['updatedAt', 'Updated'], ['priority', 'Priority']] as const).map(([field, label]) => (
                  <button key={field} onClick={() => {
                    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                    else { setSortField(field); setSortDir('desc'); }
                    setShowSort(false);
                  }} className={cn('w-full text-left px-3 py-1.5 text-sm hover:bg-surface-tertiary transition-colors flex items-center justify-between', sortField === field && 'text-primary font-medium')}>
                    {label}
                    {sortField === field && <span className="text-xs">{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button onClick={() => setViewMode('list')} className={cn('p-1 rounded', viewMode === 'list' ? 'bg-surface-tertiary text-text' : 'text-text-tertiary hover:text-text')}>
            <LayoutList className="h-4 w-4" />
          </button>
          <button onClick={() => setViewMode('grid')} className={cn('p-1 rounded', viewMode === 'grid' ? 'bg-surface-tertiary text-text' : 'text-text-tertiary hover:text-text')}>
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="rounded-lg border border-border bg-surface p-3 mb-4 flex flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-1.5">Type</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(ISSUE_TYPE_LABELS).map(([key, label]) => (
                <button key={key} onClick={() => toggleFilter(typeFilter, key, setTypeFilter)}
                  className={cn('text-xs px-2 py-1 rounded-md border transition-colors', typeFilter.includes(key) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-border-focus')}>
                  <IssueTypeIcon type={key} className="h-3 w-3" /> {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-1.5">Priority</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <button key={key} onClick={() => toggleFilter(priorityFilter, key, setPriorityFilter)}
                  className={cn('text-xs px-2 py-1 rounded-md border transition-colors', priorityFilter.includes(key) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-border-focus')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {allAssignees.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Assignee</p>
              <div className="flex flex-wrap gap-1">
                {allAssignees.map((a) => (
                  <button key={a.id} onClick={() => toggleFilter(assigneeFilter, a.id, setAssigneeFilter)}
                    className={cn('text-xs px-2 py-1 rounded-md border transition-colors', assigneeFilter.includes(a.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-border-focus')}>
                    {a.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}
          {allLabels.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Label</p>
              <div className="flex flex-wrap gap-1">
                {allLabels.map((l) => (
                  <button key={l.id} onClick={() => toggleFilter(labelFilter, l.id, setLabelFilter)}
                    className={cn('text-xs px-2 py-1 rounded-md border transition-colors', labelFilter.includes(l.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:border-border-focus')}>
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeFilterCount > 0 && (
            <button onClick={() => { setTypeFilter([]); setPriorityFilter([]); setAssigneeFilter([]); setLabelFilter([]); }} className="text-xs text-text-tertiary hover:text-danger flex items-center gap-1 self-end">
              <X className="h-3 w-3" /> Clear all
            </button>
          )}
        </div>
      )}

      {!filteredIssues.length ? (
        <EmptyState title="No issues found" description={activeFilterCount > 0 ? 'Try adjusting your filters.' : 'Create your first issue to get started.'} />
      ) : viewMode === 'list' ? (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {filteredIssues.map((issue) => (
            <Link
              key={issue.id}
              to={`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`}
              className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
            >
              <IssueTypeIcon type={issue.type} className="h-4 w-4" />
              <span className="text-xs text-text-secondary font-mono w-16">{issue.key}</span>
              <span className="flex-1 text-sm font-medium truncate">{issue.title}</span>
              {issue.labels?.map((l) => (
                <Badge key={l.id} className="text-xs">{l.name}</Badge>
              ))}
              <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}>
                {issue.priority}
              </span>
              {issue.column && <span className="text-xs text-text-secondary">{issue.column.name}</span>}
              {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
              <span className="text-xs text-text-secondary w-16 text-right">{formatRelative(issue.updatedAt)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filteredIssues.map((issue) => (
            <Link
              key={issue.id}
              to={`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`}
              className="block rounded-lg border border-border bg-surface p-4 hover:shadow-sm hover:border-primary/30 transition-all"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <IssueTypeIcon type={issue.type} className="h-4 w-4" />
                <span className="text-xs text-text-secondary font-mono">{issue.key}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`}>
                  {issue.priority}
                </span>
              </div>
              <p className="text-sm font-medium line-clamp-2 mb-3">{issue.title}</p>
              <div className="flex items-center justify-between">
                <div className="flex gap-1 flex-wrap">
                  {issue.labels?.slice(0, 2).map((l) => (
                    <Badge key={l.id} className="text-xs">{l.name}</Badge>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {issue.column && <span className="text-xs text-text-tertiary">{issue.column.name}</span>}
                  {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
