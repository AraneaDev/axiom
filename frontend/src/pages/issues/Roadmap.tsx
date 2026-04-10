import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Columns3, Plus, Map, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { patch } from '@/api/client';
import { issuesApi } from '@/api/issues.api';
import { roadmapApi, type TimelineIssue } from '@/api/roadmap.api';
import { BucketBoard } from '@/components/ui/BucketBoard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GanttChart } from '@/components/ui/GanttChart';
import { IssuePickerModal } from '@/components/ui/IssuePickerModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { TimelineZoom, type ZoomLevel } from '@/components/ui/TimelineZoom';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';

type Mode = 'timeline' | 'buckets';

const MODE_TABS = [
  { key: 'timeline', label: 'Timeline', icon: <CalendarRange className="h-4 w-4" /> },
  { key: 'buckets', label: 'Buckets', icon: <Columns3 className="h-4 w-4" /> },
];

/**
 * Visual Roadmap page with dual-mode view: Gantt timeline and bucket board.
 * Supports drag-and-drop bucket assignment, issue picker, and quick-start defaults.
 */
export default function Roadmap() {
  const { currentProject, basePath } = useProjectContext();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('timeline');
  const [zoom, setZoom] = useState<ZoomLevel>('months');
  const [pickerOpen, setPickerOpen] = useState(false);

  const projectId = currentProject?.id ?? '';
  const projectPrefix = currentProject?.prefix ?? '';

  // -- Timeline data
  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['roadmap-timeline', projectId],
    queryFn: () => roadmapApi.getTimeline(projectId),
    enabled: !!projectId && mode === 'timeline',
  });

  // -- Buckets view data
  const { data: bucketsViewData, isLoading: bucketsViewLoading } = useQuery({
    queryKey: ['roadmap-buckets-view', projectId],
    queryFn: () => roadmapApi.getBucketsView(projectId),
    enabled: !!projectId && mode === 'buckets',
  });

  // -- Buckets list (for checking if any exist)
  const { data: bucketsList, isLoading: bucketsListLoading } = useQuery({
    queryKey: ['roadmap-buckets', projectId],
    queryFn: () => roadmapApi.listBuckets(projectId),
    enabled: !!projectId && mode === 'buckets',
  });

  // -- Create default buckets
  const createDefaultsMutation = useMutationWithToast(() => roadmapApi.createDefaults(projectId), {
    successMessage: 'Default buckets created',
    invalidateKeys: [
      ['roadmap-buckets', projectId],
      ['roadmap-buckets-view', projectId],
    ],
  });

  // -- Move issue to bucket
  const moveToBucketMutation = useMutationWithToast(
    ({ issueId, bucketId }: { issueId: string; bucketId: string | null }) =>
      patch(`/projects/${projectId}/roadmap/issues/${issueId}/bucket`, { bucketId }),
    {
      successMessage: 'Issue moved',
      invalidateKeys: [
        ['roadmap-buckets-view', projectId],
        ['roadmap-buckets', projectId],
      ],
    },
  );

  // -- Add issue to roadmap (set start/due dates via issue update)
  const addToRoadmapMutation = useMutationWithToast(
    (issueId: string) => {
      const today = new Date().toISOString().slice(0, 10);
      const twoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
      return patch(`/projects/${projectId}/roadmap/issues/${issueId}/dates`, {
        startDate: today,
        dueDate: twoWeeks,
      });
    },
    {
      successMessage: 'Issue added to roadmap',
      invalidateKeys: [
        ['roadmap-timeline', projectId],
        ['roadmap-buckets-view', projectId],
      ],
      onSuccess: () => setPickerOpen(false),
    },
  );

  function handleIssueClick(issue: TimelineIssue) {
    navigate(`${basePath}/issues/${issue.number}`);
  }

  function handleMoveToBucket(issueId: string, bucketId: string | null) {
    moveToBucketMutation.mutate({ issueId, bucketId });
  }

  const isLoading =
    mode === 'timeline' ? timelineLoading : bucketsViewLoading || bucketsListLoading;

  if (isLoading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 px-4">
          <Skeleton className="h-7 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-40 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
        <div className="px-4">
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // Buckets mode: no buckets exist yet -- show setup prompt
  const hasBuckets = (bucketsList?.length ?? 0) > 0;
  const showBucketSetup = mode === 'buckets' && !hasBuckets;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4">
        <PageHeader title="Roadmap">
          <div className="flex items-center gap-3">
            <Tabs
              tabs={MODE_TABS}
              activeKey={mode}
              onChange={(key) => setMode(key as Mode)}
              className="border-b-0"
            />
            {mode === 'timeline' && <TimelineZoom value={zoom} onChange={setZoom} />}
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4" /> Add to Roadmap
            </Button>
          </div>
        </PageHeader>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {mode === 'timeline' && (
          <>
            {timelineData && timelineData.issues.length > 0 ? (
              <GanttChart
                issues={timelineData.issues}
                links={timelineData.links}
                zoom={zoom}
                projectPrefix={projectPrefix}
                projectId={projectId}
                onIssueClick={handleIssueClick}
              />
            ) : (
              <EmptyState
                icon={<Map />}
                title="No issues on the timeline"
                description="Add issues with start and due dates to see them on the timeline."
                action={
                  <Button size="sm" onClick={() => setPickerOpen(true)}>
                    <Plus className="h-4 w-4" /> Add Issue
                  </Button>
                }
              />
            )}
          </>
        )}

        {mode === 'buckets' && (
          <>
            {showBucketSetup ? (
              <EmptyState
                icon={<Columns3 />}
                title="No buckets configured"
                description="Create buckets to organize your roadmap. Start with the default Now / Next / Later setup."
                action={
                  <Button
                    size="sm"
                    onClick={() => createDefaultsMutation.mutate()}
                    disabled={createDefaultsMutation.isPending}
                  >
                    <Sparkles className="h-4 w-4" /> Now / Next / Later
                  </Button>
                }
              />
            ) : bucketsViewData ? (
              <BucketBoard
                data={bucketsViewData}
                projectPrefix={projectPrefix}
                onMoveToBucket={handleMoveToBucket}
                onIssueClick={handleIssueClick}
              />
            ) : null}
          </>
        )}
      </div>

      {/* Issue picker modal */}
      {currentProject && (
        <IssuePickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          projectId={projectId}
          onSelect={(issueId) => addToRoadmapMutation.mutate(issueId)}
          fetchIssues={async (pid, search) => {
            const result = await issuesApi.list(pid, { q: search, limit: '20' });
            return result.issues.map((i) => ({
              id: i.id,
              number: i.number,
              title: i.title,
              type: i.type,
              priority: i.priority,
            }));
          }}
        />
      )}
    </div>
  );
}
