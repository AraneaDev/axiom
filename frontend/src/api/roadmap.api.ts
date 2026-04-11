import { get, post, patch, del, put } from './client';

export interface RoadmapBucket {
  id: string;
  projectId: string;
  name: string;
  position: number;
  color: string;
  _count: { issues: number };
}

export interface TimelineIssue {
  id: string;
  number: number;
  title: string;
  type: string;
  priority: string;
  startDate?: string | null;
  dueDate?: string | null;
  columnId?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
  roadmapBucketId?: string | null;
  assignee?: { id: string; displayName: string; avatarUrl?: string | null } | null;
  column?: { id: string; name: string; isDone?: boolean } | null;
  labels: { id: string; name: string; color: string }[];
  project: {
    prefix: string;
    slug: string;
    team: { slug: string; org: { slug: string } };
  };
  _count: { children: number };
  children?: TimelineIssue[];
}

export interface DependencyLink {
  id: string;
  fromId: string;
  toId: string;
  type: string;
}

export interface TimelineData {
  issues: TimelineIssue[];
  links: DependencyLink[];
}

export interface BucketsViewData {
  buckets: (RoadmapBucket & { issues: TimelineIssue[] })[];
  unassigned: TimelineIssue[];
}

export interface Filters {
  assigneeId?: string;
  priority?: string;
  type?: string;
  labelId?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
}

function buildQuery(filters?: Filters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const roadmapApi = {
  // Buckets
  listBuckets: (projectId: string) =>
    get<RoadmapBucket[]>(`/projects/${projectId}/roadmap/buckets`),

  createBucket: (projectId: string, data: { name: string; color?: string; position?: number }) =>
    post<RoadmapBucket>(`/projects/${projectId}/roadmap/buckets`, data),

  createDefaults: (projectId: string) =>
    post<RoadmapBucket[]>(`/projects/${projectId}/roadmap/buckets/defaults`, {}),

  updateBucket: (
    projectId: string,
    bucketId: string,
    data: { name?: string; color?: string; position?: number },
  ) => patch<RoadmapBucket>(`/projects/${projectId}/roadmap/buckets/${bucketId}`, data),

  deleteBucket: (projectId: string, bucketId: string) =>
    del(`/projects/${projectId}/roadmap/buckets/${bucketId}`),

  reorderBuckets: (projectId: string, orderedIds: string[]) =>
    put<RoadmapBucket[]>(`/projects/${projectId}/roadmap/buckets/reorder`, { orderedIds }),

  // Data
  getTimeline: (projectId: string, filters?: Filters) =>
    get<TimelineData>(`/projects/${projectId}/roadmap/timeline${buildQuery(filters)}`),

  getBucketsView: (projectId: string, filters?: Filters) =>
    get<BucketsViewData>(`/projects/${projectId}/roadmap/buckets-view${buildQuery(filters)}`),

  // Helper (exported for reuse)
  buildQuery,
};
