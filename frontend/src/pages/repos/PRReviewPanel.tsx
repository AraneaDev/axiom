import {
  GitMerge,
  XCircle,
  ChevronDown,
  GitCommitHorizontal,
  GitBranchPlus,
  ShieldCheck,
  ShieldX,
  Check,
  X,
  CircleDot,
  CheckCircle2,
  XCircle as XCircleIcon,
  AlertCircle,
  ExternalLink,
  Users,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router';

import type { StatusCheck, CodeOwnerStatus } from '@/api/status-checks.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Spinner } from '@/components/ui/Spinner';

const STRATEGY_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  merge: {
    label: 'Merge commit',
    icon: <GitMerge className="h-4 w-4" />,
  },
  squash: {
    label: 'Squash and merge',
    icon: <GitCommitHorizontal className="h-4 w-4" />,
  },
  rebase: {
    label: 'Rebase and merge',
    icon: <GitBranchPlus className="h-4 w-4" />,
  },
};

interface PRReviewPanelProps {
  pr: {
    status: string;
    mergeable?: boolean | null;
    mergeStrategy?: string | null;
    sourceBranch: string;
    targetBranch: string;
  };
  org: string;
  teamSlug: string;
  repoSlug: string;
  mergeStrategy: string;
  onSetMergeStrategy: (strategy: string) => void;
  mergeChecks:
    | {
        reviewsMet: boolean;
        approvedReviews: number;
        requiredReviews: number;
        requireCI: boolean;
        ciPassed: boolean;
        canMerge: boolean;
        defaultStrategy: string;
      }
    | undefined;
  prStatuses:
    | {
        combined: string;
        statuses: StatusCheck[];
      }
    | undefined;
  codeOwners:
    | {
        allApproved: boolean;
        owners: CodeOwnerStatus[];
      }
    | undefined;
  onMerge: () => void;
  isMerging: boolean;
  mergeError: Error | null;
  onClose: () => void;
}

/**
 *
 * @param root0
 * @param root0.pr
 * @param root0.org
 * @param root0.teamSlug
 * @param root0.repoSlug
 * @param root0.mergeStrategy
 * @param root0.onSetMergeStrategy
 * @param root0.mergeChecks
 * @param root0.prStatuses
 * @param root0.codeOwners
 * @param root0.onMerge
 * @param root0.isMerging
 * @param root0.mergeError
 * @param root0.onClose
 */
export function PRReviewPanel({
  pr,
  org,
  teamSlug,
  repoSlug,
  mergeStrategy,
  onSetMergeStrategy,
  mergeChecks,
  prStatuses,
  codeOwners,
  onMerge,
  isMerging,
  mergeError,
  onClose,
}: PRReviewPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div>
          <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Merge status</p>
          {pr.status === 'OPEN' ? (
            pr.mergeable === true ? (
              <Badge variant="success">No conflicts</Badge>
            ) : pr.mergeable === false ? (
              <Badge variant="danger">Has conflicts</Badge>
            ) : (
              <Badge>Unknown</Badge>
            )
          ) : (
            <Badge variant={pr.status === 'MERGED' ? 'success' : 'default'}>
              {pr.status}
              {pr.status === 'MERGED' && pr.mergeStrategy
                ? ` (${pr.mergeStrategy.toLowerCase()})`
                : ''}
            </Badge>
          )}
        </div>

        {/* Merge checks */}
        {pr.status === 'OPEN' && mergeChecks && (
          <div className="space-y-2">
            <p className="text-xs text-text-secondary uppercase font-semibold">Merge checks</p>
            <div className="flex items-center gap-2 text-sm">
              {mergeChecks.reviewsMet ? (
                <ShieldCheck className="h-4 w-4 text-success" />
              ) : (
                <ShieldX className="h-4 w-4 text-danger" />
              )}
              <span className={mergeChecks.reviewsMet ? 'text-success' : 'text-danger'}>
                {mergeChecks.approvedReviews} of {mergeChecks.requiredReviews} required review(s)
              </span>
            </div>
            {mergeChecks.requireCI && (
              <div className="flex items-center gap-2 text-sm">
                {mergeChecks.ciPassed ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <X className="h-4 w-4 text-danger" />
                )}
                <span className={mergeChecks.ciPassed ? 'text-success' : 'text-danger'}>
                  CI checks {mergeChecks.ciPassed ? 'passed' : 'required'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Status checks */}
        {pr.status === 'OPEN' && prStatuses && prStatuses.statuses.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-text-secondary uppercase font-semibold">Status checks</p>
              <Badge
                variant={
                  prStatuses.combined === 'success'
                    ? 'success'
                    : prStatuses.combined === 'failure'
                      ? 'danger'
                      : 'default'
                }
              >
                {prStatuses.combined}
              </Badge>
            </div>
            <div className="space-y-1">
              {prStatuses.statuses.map((status: StatusCheck) => (
                <div key={status.id} className="flex items-center gap-2 text-sm">
                  {status.state === 'SUCCESS' ? (
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  ) : status.state === 'FAILURE' ? (
                    <XCircleIcon className="h-4 w-4 text-danger shrink-0" />
                  ) : status.state === 'ERROR' ? (
                    <AlertCircle className="h-4 w-4 text-danger shrink-0" />
                  ) : (
                    <Loader2 className="h-4 w-4 text-warning animate-spin shrink-0" />
                  )}
                  <span className="flex-1 truncate">{status.context}</span>
                  {status.targetUrl && (
                    <a
                      href={status.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      title="View details"
                      aria-label="View details"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
              {prStatuses.statuses.some((s: StatusCheck) => s.description) && (
                <div className="mt-1 space-y-1">
                  {prStatuses.statuses
                    .filter((s: StatusCheck) => s.description)
                    .map((s: StatusCheck) => (
                      <p key={s.id} className="text-xs text-text-tertiary">
                        {s.context}: {s.description}
                      </p>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {pr.status === 'OPEN' && (
          <>
            {/* Merge strategy split button */}
            <div className="flex w-full">
              <Button
                className="flex-1 rounded-r-none"
                disabled={
                  !pr.mergeable || isMerging || (mergeChecks != null && !mergeChecks.canMerge)
                }
                onClick={onMerge}
              >
                {isMerging ? (
                  <Spinner size="sm" />
                ) : (
                  <>
                    {STRATEGY_LABELS[mergeStrategy || 'merge']?.icon}
                    {STRATEGY_LABELS[mergeStrategy || 'merge']?.label ?? 'Merge'}
                  </>
                )}
              </Button>
              <Dropdown
                align="right"
                trigger={
                  <Button
                    className="rounded-l-none border-l border-l-primary-hover px-2"
                    disabled={!pr.mergeable || (mergeChecks != null && !mergeChecks.canMerge)}
                    aria-label="Select merge strategy"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                }
              >
                <DropdownItem onClick={() => onSetMergeStrategy('merge')}>
                  <GitMerge className="h-4 w-4" /> Merge commit
                </DropdownItem>
                <DropdownItem onClick={() => onSetMergeStrategy('squash')}>
                  <GitCommitHorizontal className="h-4 w-4" /> Squash and merge
                </DropdownItem>
                <DropdownItem onClick={() => onSetMergeStrategy('rebase')}>
                  <GitBranchPlus className="h-4 w-4" /> Rebase and merge
                </DropdownItem>
              </Dropdown>
            </div>
            {mergeChecks && !mergeChecks.canMerge && (
              <p className="text-xs text-danger">
                Merge requirements not met. Check review and CI status above.
              </p>
            )}
            {mergeError && (
              <p className="text-xs text-danger">
                {mergeError instanceof Error ? mergeError.message : 'Merge failed'}
              </p>
            )}
            <Button variant="ghost" className="w-full" onClick={onClose}>
              <XCircle className="h-4 w-4" /> Close PR
            </Button>
          </>
        )}
      </div>

      {/* Code Owners */}
      {codeOwners && codeOwners.owners.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-text-secondary" />
            <p className="text-xs text-text-secondary uppercase font-semibold">Code Owners</p>
            <Badge variant={codeOwners.allApproved ? 'success' : 'default'}>
              {codeOwners.allApproved ? 'All approved' : 'Pending'}
            </Badge>
          </div>
          <div className="space-y-1">
            {codeOwners.owners.map((owner: CodeOwnerStatus) => (
              <div key={owner.owner} className="flex items-center gap-2 text-sm">
                {owner.approved ? (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                ) : owner.reviewStatus === 'CHANGES_REQUESTED' ? (
                  <XCircleIcon className="h-4 w-4 text-danger shrink-0" />
                ) : (
                  <CircleDot className="h-4 w-4 text-text-tertiary shrink-0" />
                )}
                <span className="flex-1">{owner.owner}</span>
                <span className="text-xs text-text-tertiary">
                  {owner.approved
                    ? 'Approved'
                    : owner.reviewStatus
                      ? owner.reviewStatus.toLowerCase().replace('_', ' ')
                      : 'Awaiting review'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Branches</p>
        <p className="text-sm">
          <Link
            to={`/${org}/${teamSlug}/repos/${repoSlug}/tree/${encodeURIComponent(pr.sourceBranch)}`}
            className="hover:text-primary transition-colors"
          >
            <code className="bg-surface-secondary px-1 rounded">{pr.sourceBranch}</code>
          </Link>
        </p>
        <p className="text-xs text-text-secondary my-1">into</p>
        <p className="text-sm">
          <Link
            to={`/${org}/${teamSlug}/repos/${repoSlug}/tree/${encodeURIComponent(pr.targetBranch)}`}
            className="hover:text-primary transition-colors"
          >
            <code className="bg-surface-secondary px-1 rounded">{pr.targetBranch}</code>
          </Link>
        </p>
      </div>
    </div>
  );
}
