import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Clock,
  Inbox,
  ShieldAlert,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';

import { intakeApi, type FormSubmission } from '@/api/intake.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Table, TableContainer, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';

const STATUS_TABS = [
  { key: 'PENDING', label: 'Pending', icon: <Clock className="h-4 w-4" /> },
  { key: 'APPROVED', label: 'Approved', icon: <Check className="h-4 w-4" /> },
  { key: 'REJECTED', label: 'Rejected', icon: <X className="h-4 w-4" /> },
  { key: 'SPAM', label: 'Spam', icon: <ShieldAlert className="h-4 w-4" /> },
];

const STATUS_BADGE_MAP: Record<
  string,
  { variant: 'default' | 'success' | 'danger' | 'warning'; label: string }
> = {
  PENDING: { variant: 'warning', label: 'Pending' },
  APPROVED: { variant: 'success', label: 'Approved' },
  REJECTED: { variant: 'danger', label: 'Rejected' },
  SPAM: { variant: 'default', label: 'Spam' },
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Intake Queue page -- shows form submissions for a project, filterable by status.
 * Supports approve (with issue creation), reject (with note), and spam actions.
 */
export default function IntakeQueue() {
  const { currentProject } = useProjectContext();
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Approve modal state
  const [approveTarget, setApproveTarget] = useState<FormSubmission | null>(null);
  const [approveTitle, setApproveTitle] = useState('');
  const [approveBody, setApproveBody] = useState('');
  const [approveType, setApproveType] = useState('TASK');
  const [approvePriority, setApprovePriority] = useState('MEDIUM');

  // Reject modal state
  const [rejectTarget, setRejectTarget] = useState<FormSubmission | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  // Spam confirm state
  const [spamTarget, setSpamTarget] = useState<FormSubmission | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['intake', currentProject?.id, statusFilter],
    queryFn: () => intakeApi.list(currentProject!.id, { status: statusFilter }),
    enabled: !!currentProject?.id,
  });

  const approveMutation = useMutationWithToast(
    (vars: { submissionId: string; title: string; body: string; type: string; priority: string }) =>
      intakeApi.approve(currentProject!.id, vars.submissionId, {
        title: vars.title,
        body: vars.body,
        type: vars.type,
        priority: vars.priority,
      }),
    {
      successMessage: 'Submission approved and issue created',
      invalidateKeys: [['intake', currentProject?.id, statusFilter]],
      onSuccess: () => setApproveTarget(null),
    },
  );

  const rejectMutation = useMutationWithToast(
    (vars: { submissionId: string; reviewNote?: string }) =>
      intakeApi.reject(currentProject!.id, vars.submissionId, vars.reviewNote),
    {
      successMessage: 'Submission rejected',
      invalidateKeys: [['intake', currentProject?.id, statusFilter]],
      onSuccess: () => {
        setRejectTarget(null);
        setRejectNote('');
      },
    },
  );

  const spamMutation = useMutationWithToast(
    (submissionId: string) => intakeApi.spam(currentProject!.id, submissionId),
    {
      successMessage: 'Submission marked as spam',
      invalidateKeys: [['intake', currentProject?.id, statusFilter]],
      onSuccess: () => setSpamTarget(null),
    },
  );

  function openApproveModal(sub: FormSubmission) {
    // Pre-fill from submission responses
    const responses = sub.responses as Record<string, string>;
    setApproveTitle(responses['title'] || sub.submitterName || '');
    setApproveBody(responses['body'] || responses['description'] || '');
    setApproveType(responses['type'] || 'TASK');
    setApprovePriority(responses['priority'] || 'MEDIUM');
    setApproveTarget(sub);
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-text-secondary">Failed to load intake queue</p>
        </div>
      </div>
    );
  }

  const submissions = data?.submissions ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Inbox className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-lg font-semibold text-text">Intake Queue</h1>
          <p className="text-[13px] text-text-secondary">
            Review and triage submissions from public intake forms
          </p>
        </div>
      </div>

      <Tabs
        tabs={STATUS_TABS}
        activeKey={statusFilter}
        onChange={(key) => setStatusFilter(key)}
        className="mb-4"
      />

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : submissions.length === 0 ? (
        <EmptyState
          card
          icon={<Inbox className="h-10 w-10" />}
          title={`No ${statusFilter.toLowerCase()} submissions`}
          description="Submissions from public forms will appear here for review."
        />
      ) : (
        <TableContainer>
          <Table>
            <Thead>
              <TrHead>
                <Th />
                <Th>Submitter</Th>
                <Th>Form</Th>
                <Th>Submitted</Th>
                <Th>Status</Th>
                {statusFilter === 'PENDING' && <Th className="text-right">Actions</Th>}
              </TrHead>
            </Thead>
            <Tbody>
              {submissions.map((sub) => {
                const isExpanded = expandedId === sub.id;
                const badge = STATUS_BADGE_MAP[sub.status] ?? STATUS_BADGE_MAP.PENDING;
                return (
                  <>
                    <tr
                      key={sub.id}
                      className="cursor-pointer hover:bg-surface-secondary transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                    >
                      <Td className="w-8">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-text-tertiary" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-text-tertiary" />
                        )}
                      </Td>
                      <Td>
                        <div className="font-medium text-text">
                          {sub.submitterName || 'Anonymous'}
                        </div>
                        {sub.submitterEmail && (
                          <div className="text-[12px] text-text-tertiary">{sub.submitterEmail}</div>
                        )}
                      </Td>
                      <Td className="text-text-secondary">{sub.form?.title ?? '--'}</Td>
                      <Td className="text-text-secondary">{formatDate(sub.createdAt)}</Td>
                      <Td>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </Td>
                      {statusFilter === 'PENDING' && (
                        <Td className="text-right">
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="primary"
                              size="xs"
                              onClick={() => openApproveModal(sub)}
                              title="Approve and create issue"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setRejectTarget(sub)}
                              title="Reject submission"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setSpamTarget(sub)}
                              title="Mark as spam"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" /> Spam
                            </Button>
                          </div>
                        </Td>
                      )}
                    </tr>
                    {isExpanded && (
                      <tr key={`${sub.id}-detail`}>
                        <Td colSpan={statusFilter === 'PENDING' ? 6 : 5}>
                          <div className="bg-surface-secondary rounded-md p-4 text-[13px]">
                            <h4 className="font-semibold text-text mb-2">Submission Data</h4>
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
                              {Object.entries(sub.responses as Record<string, unknown>).map(
                                ([key, value]) => (
                                  <div key={key}>
                                    <dt className="text-text-tertiary text-[11px] uppercase tracking-wider">
                                      {key}
                                    </dt>
                                    <dd className="text-text">{String(value)}</dd>
                                  </div>
                                ),
                              )}
                            </dl>
                            {sub.reviewNote && (
                              <div className="mt-3 pt-3 border-t border-border">
                                <span className="text-text-tertiary text-[11px] uppercase tracking-wider">
                                  Review Note
                                </span>
                                <p className="text-text">{sub.reviewNote}</p>
                              </div>
                            )}
                            {sub.issue && (
                              <div className="mt-3 pt-3 border-t border-border">
                                <span className="text-text-tertiary text-[11px] uppercase tracking-wider">
                                  Created Issue
                                </span>
                                <p className="text-text font-medium">
                                  #{sub.issue.number} {sub.issue.title}
                                </p>
                              </div>
                            )}
                          </div>
                        </Td>
                      </tr>
                    )}
                  </>
                );
              })}
            </Tbody>
          </Table>
        </TableContainer>
      )}

      {/* Approve Modal */}
      <Modal
        open={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        title="Approve Submission"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-text-secondary">
            Review and edit the issue details before creating it.
          </p>
          <Input
            label="Title"
            value={approveTitle}
            onChange={(e) => setApproveTitle(e.target.value)}
            placeholder="Issue title"
          />
          <Textarea
            label="Description"
            value={approveBody}
            onChange={(e) => setApproveBody(e.target.value)}
            rows={4}
            placeholder="Issue description"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Type"
              value={approveType}
              onChange={(e) => setApproveType(e.target.value)}
              placeholder="TASK, BUG, FEATURE..."
            />
            <Input
              label="Priority"
              value={approvePriority}
              onChange={(e) => setApprovePriority(e.target.value)}
              placeholder="LOW, MEDIUM, HIGH..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setApproveTarget(null)}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!approveTitle.trim() || approveMutation.isPending}
              onClick={() => {
                if (approveTarget) {
                  approveMutation.mutate({
                    submissionId: approveTarget.id,
                    title: approveTitle.trim(),
                    body: approveBody.trim(),
                    type: approveType,
                    priority: approvePriority,
                  });
                }
              }}
            >
              <Check className="h-4 w-4" /> Approve and Create Issue
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        open={!!rejectTarget}
        onClose={() => {
          setRejectTarget(null);
          setRejectNote('');
        }}
        title="Reject Submission"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-text-secondary">
            Optionally provide a reason for rejecting this submission.
          </p>
          <Textarea
            label="Review Note"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={3}
            placeholder="Reason for rejection (optional)"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRejectTarget(null);
                setRejectNote('');
              }}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={rejectMutation.isPending}
              onClick={() => {
                if (rejectTarget) {
                  rejectMutation.mutate({
                    submissionId: rejectTarget.id,
                    reviewNote: rejectNote.trim() || undefined,
                  });
                }
              }}
            >
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        </div>
      </Modal>

      {/* Spam Confirm */}
      <ConfirmDialog
        open={!!spamTarget}
        title="Mark as Spam"
        description="Are you sure you want to mark this submission as spam? This can be undone from the Spam tab."
        confirmLabel="Mark as Spam"
        variant="danger"
        onConfirm={() => {
          if (spamTarget) spamMutation.mutate(spamTarget.id);
        }}
        onClose={() => setSpamTarget(null)}
      />
    </div>
  );
}
