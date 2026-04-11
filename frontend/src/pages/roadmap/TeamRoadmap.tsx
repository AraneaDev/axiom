import { useQuery } from '@tanstack/react-query';
import { Filter, Map, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { projectsApi } from '@/api/projects.api';
import { roadmapApi, type TeamTimelineFilters, type TimelineIssue } from '@/api/roadmap.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GanttChart } from '@/components/ui/GanttChart';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { TimelineZoom, type ZoomLevel } from '@/components/ui/TimelineZoom';
import { useTeamContext } from '@/hooks/useTeamContext';

/**
 *
 */
export default function TeamRoadmap() {
  const { currentTeam } = useTeamContext();
  const navigate = useNavigate();

  const [zoom, setZoom] = useState<ZoomLevel>('months');
  const [filters, setFilters] = useState<TeamTimelineFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  const teamId = currentTeam?.id ?? '';

  // Get projects for filter dropdown
  const { data: projects } = useQuery({
    queryKey: ['projects', 'team', teamId],
    queryFn: () => projectsApi.listByTeam(teamId),
    enabled: !!teamId,
  });

  // Timeline data
  const { data: timelineData, isLoading } = useQuery({
    queryKey: ['team-roadmap-timeline', teamId, filters],
    queryFn: () => roadmapApi.getTeamTimeline(teamId, filters),
    enabled: !!teamId,
  });

  function handleIssueClick(issue: TimelineIssue) {
    const p = issue.project;
    if (p) {
      navigate(`/${p.team.org.slug}/${p.team.slug}/${p.slug}/issues/${issue.number}`);
    }
  }

  if (isLoading && teamId) {
    return (
      <div className="p-6">
        <Skeleton className="h-7 w-64 mb-4" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  const hasIssues = timelineData && timelineData.issues.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6">
        <PageHeader title="Team Roadmap">
          <div className="flex items-center gap-3">
            <Button
              variant={showFilters ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4" /> Filters
            </Button>
            <TimelineZoom value={zoom} onChange={setZoom} />
          </div>
        </PageHeader>

        {showFilters && (
          <div className="flex items-center gap-3 pb-4 flex-wrap">
            {projects && projects.length > 0 && (
              <select
                value={filters.projectId ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    projectId: e.target.value || undefined,
                  }))
                }
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text"
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.prefix})
                  </option>
                ))}
              </select>
            )}
            <select
              value={filters.type ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || undefined }))}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text"
            >
              <option value="">All types</option>
              <option value="EPIC">Epic</option>
              <option value="STORY">Story</option>
              <option value="TASK">Task</option>
              <option value="BUG">Bug</option>
            </select>
            {(filters.projectId || filters.type || filters.assigneeId) && (
              <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {hasIssues ? (
          <GanttChart
            issues={timelineData.issues}
            links={timelineData.links}
            zoom={zoom}
            projectPrefix=""
            projectId=""
            onIssueClick={handleIssueClick}
            multiProject
          />
        ) : (
          <EmptyState
            icon={<Map />}
            title="No issues on the timeline"
            description="Add start and due dates to issues across this team's projects to see them here."
          />
        )}
      </div>
    </div>
  );
}
