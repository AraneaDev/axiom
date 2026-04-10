import { BucketColumn } from './BucketColumn';

import type { BucketsViewData, TimelineIssue } from '@/api/roadmap.api';

interface BucketBoardProps {
  data: BucketsViewData;
  projectPrefix: string;
  onMoveToBucket: (issueId: string, bucketId: string | null) => void;
  onIssueClick: (issue: TimelineIssue) => void;
}

/**
 * Horizontal flex layout of BucketColumns for the roadmap bucket view.
 * Renders each bucket as a column, plus an "Unassigned" pseudo-column
 * when there are issues without a bucket assignment.
 * @param root0
 * @param root0.data
 * @param root0.projectPrefix
 * @param root0.onMoveToBucket
 * @param root0.onIssueClick
 */
export function BucketBoard({
  data,
  projectPrefix,
  onMoveToBucket,
  onIssueClick,
}: BucketBoardProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 h-full">
      {data.buckets.map((bucket) => (
        <BucketColumn
          key={bucket.id}
          name={bucket.name}
          color={bucket.color}
          issues={bucket.issues}
          projectPrefix={projectPrefix}
          onDropIssue={(issueId) => onMoveToBucket(issueId, bucket.id)}
          onIssueClick={onIssueClick}
        />
      ))}

      {/* Unassigned pseudo-column (only shown if there are unassigned issues) */}
      {data.unassigned.length > 0 && (
        <BucketColumn
          name="Unassigned"
          issues={data.unassigned}
          projectPrefix={projectPrefix}
          onDropIssue={(issueId) => onMoveToBucket(issueId, null)}
          onIssueClick={onIssueClick}
        />
      )}
    </div>
  );
}
