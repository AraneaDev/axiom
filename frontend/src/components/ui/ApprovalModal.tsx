import { ArrowRight, Check, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { approvalsApi } from '@/api/approvals.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { cn } from '@/lib/utils';

interface ProjectMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  issueId: string;
  issueTitle: string;
  fromColumnName: string;
  toColumnId: string;
  toColumnName: string;
  minApprovals: number;
  allowSelfApproval: boolean;
  currentUserId: string;
  projectMembers: ProjectMember[];
  onSuccess?: () => void;
}

/**
 * Modal for requesting approval to transition an issue to a gated column.
 * Displays transition info and an approver picker with search.
 * @param props - Modal props.
 * @param props.open
 * @param props.onClose
 * @param props.issueId
 * @param props.issueTitle
 * @param props.fromColumnName
 * @param props.toColumnId
 * @param props.toColumnName
 * @param props.minApprovals
 * @param props.allowSelfApproval
 * @param props.currentUserId
 * @param props.projectMembers
 * @param props.onSuccess
 */
export function ApprovalModal({
  open,
  onClose,
  issueId,
  issueTitle,
  fromColumnName,
  toColumnId,
  toColumnName,
  minApprovals,
  allowSelfApproval,
  currentUserId,
  projectMembers,
  onSuccess,
}: ApprovalModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const eligibleMembers = projectMembers.filter((m) => allowSelfApproval || m.id !== currentUserId);

  const filtered = eligibleMembers.filter(
    (m) =>
      m.displayName.toLowerCase().includes(search.toLowerCase()) ||
      m.username.toLowerCase().includes(search.toLowerCase()),
  );

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const mutation = useMutationWithToast(
    (approverIds: string[]) =>
      approvalsApi.createRequest(issueId, { targetColumnId: toColumnId, approverIds }),
    {
      successMessage: 'Approval request submitted',
      errorMessage: 'Failed to submit approval request',
      invalidateKeys: [['approval-requests', issueId]],
      onSuccess: () => {
        setSearch('');
        setSelectedIds(new Set());
        onSuccess?.();
        onClose();
      },
    },
  );

  const handleConfirm = () => {
    mutation.mutate(Array.from(selectedIds));
  };

  const canConfirm = selectedIds.size >= minApprovals && !mutation.isPending;

  return (
    <Modal open={open} onClose={onClose} title="Request Approval" size="md">
      <div className="space-y-4">
        {/* Header info */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-secondary border border-border-light">
          <ShieldCheck className="h-5 w-5 text-warning mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">This transition requires approval</p>
            <p className="text-xs text-text-secondary mt-0.5 truncate" title={issueTitle}>
              {issueTitle}
            </p>
          </div>
        </div>

        {/* Transition */}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span className="px-2 py-0.5 rounded bg-surface-tertiary text-text text-xs font-medium">
            {fromColumnName}
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
          <span className="px-2 py-0.5 rounded bg-surface-tertiary text-text text-xs font-medium">
            {toColumnName}
          </span>
        </div>

        <p className="text-xs text-text-secondary">
          At least <span className="font-medium text-text">{minApprovals}</span>{' '}
          {minApprovals === 1 ? 'approver' : 'approvers'} required.
          {!allowSelfApproval && ' Self-approval is not allowed.'}
        </p>

        {/* Approver picker */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Select approvers
          </label>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              placeholder="Search members..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface border border-border rounded-md text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-border-focus"
            />
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-border p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-text-tertiary py-3 text-center">No members found</p>
            ) : (
              filtered.map((member) => {
                const selected = selectedIds.has(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left transition-colors duration-100',
                      selected
                        ? 'bg-primary-light text-primary'
                        : 'hover:bg-surface-tertiary text-text',
                    )}
                  >
                    <Avatar
                      name={member.displayName}
                      src={member.avatarUrl ?? undefined}
                      size="xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{member.displayName}</p>
                      <p className="text-[10px] text-text-tertiary truncate">@{member.username}</p>
                    </div>
                    {selected && (
                      <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Check className="h-2.5 w-2.5 text-text-inverse" />
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {selectedIds.size > 0 && (
            <p className="text-xs text-text-secondary mt-1.5">
              {selectedIds.size} approver{selectedIds.size !== 1 ? 's' : ''} selected
            </p>
          )}
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
          <ArrowRight className="h-3.5 w-3.5 rotate-180" />
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleConfirm} disabled={!canConfirm}>
          <UserPlus className="h-3.5 w-3.5" />
          {mutation.isPending ? 'Submitting...' : 'Request Approval'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
