import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Shield, GitBranch, X, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';

import { reposApi } from '@/api/repos.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

interface BranchProtectionRule {
  id: string;
  repoId: string;
  pattern: string;
  requiredReviews: number;
  requireCI: boolean;
  noForcePush: boolean;
  noDirectPush: boolean;
  requireLinear: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BranchProtectionSettingsProps {
  repoId: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 */
export default function BranchProtectionSettings({ repoId }: BranchProtectionSettingsProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BranchProtectionRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BranchProtectionRule | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['branch-protection', repoId],
    queryFn: () => reposApi.listProtectionRules(repoId) as Promise<BranchProtectionRule[]>,
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => reposApi.deleteProtectionRule(repoId, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-protection', repoId] });
      setDeleteTarget(null);
      toast.success('Protection rule deleted');
    },
  });

  const handleEdit = (rule: BranchProtectionRule) => {
    setEditing(rule);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" /> Branch Protection
        </h2>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> Add rule
        </Button>
      </div>

      <p className="text-sm text-text-secondary mb-4">
        Protect branches from force pushes, require reviews before merging, and enforce CI checks.
      </p>

      {isLoading && <ListSkeleton rows={3} />}

      {!isLoading && rules.length === 0 && (
        <EmptyState
          icon={<ShieldOff />}
          title="No branch protection rules"
          description="Add a rule to enforce review and merge policies on specific branches."
          action={
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Add rule
            </Button>
          }
        />
      )}

      {rules.length > 0 && (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {rules.map((rule) => (
            <div key={rule.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <GitBranch className="h-4 w-4 text-text-tertiary shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-mono font-medium">{rule.pattern}</span>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {rule.requiredReviews > 0 && (
                      <Badge variant="outline" size="sm">
                        {rule.requiredReviews} review{rule.requiredReviews !== 1 ? 's' : ''}{' '}
                        required
                      </Badge>
                    )}
                    {rule.requireCI && (
                      <Badge variant="outline" size="sm">
                        CI required
                      </Badge>
                    )}
                    {rule.noForcePush && (
                      <Badge variant="outline" size="sm">
                        No force push
                      </Badge>
                    )}
                    {rule.noDirectPush && (
                      <Badge variant="outline" size="sm">
                        No direct push
                      </Badge>
                    )}
                    {rule.requireLinear && (
                      <Badge variant="outline" size="sm">
                        Linear history
                      </Badge>
                    )}
                    {rule.requiredReviews === 0 &&
                      !rule.requireCI &&
                      !rule.noForcePush &&
                      !rule.noDirectPush &&
                      !rule.requireLinear && (
                        <span className="text-xs text-text-tertiary">No restrictions enabled</span>
                      )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleEdit(rule)}
                    title="Edit rule"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setDeleteTarget(rule)}
                    title="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <ProtectionRuleFormModal repoId={repoId} rule={editing} onClose={handleCloseForm} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete protection rule"
        description={`Are you sure you want to delete the protection rule for "${deleteTarget?.pattern}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

/* ─── Form Modal ──────────────────────────────────────────── */

function ProtectionRuleFormModal({
  repoId,
  rule,
  onClose,
}: {
  repoId: string;
  rule: BranchProtectionRule | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEdit = !!rule;

  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [requiredReviews, setRequiredReviews] = useState(rule?.requiredReviews ?? 1);
  const [requireCI, setRequireCI] = useState(rule?.requireCI ?? false);
  const [noForcePush, setNoForcePush] = useState(rule?.noForcePush ?? true);
  const [noDirectPush, setNoDirectPush] = useState(rule?.noDirectPush ?? false);
  const [requireLinear, setRequireLinear] = useState(rule?.requireLinear ?? false);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const data = {
        pattern,
        requiredReviews,
        requireCI,
        noForcePush,
        noDirectPush,
        requireLinear,
      };
      if (isEdit) {
        const { pattern: _p, ...updateData } = data;
        return reposApi.updateProtectionRule(repoId, rule.id, updateData);
      }
      return reposApi.createProtectionRule(repoId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-protection', repoId] });
      toast.success(isEdit ? 'Protection rule updated' : 'Protection rule created');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = () => {
    if (!pattern.trim()) {
      setError('Branch pattern is required');
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit protection rule' : 'Add protection rule'}
      size="md"
    >
      <div className="space-y-4">
        <Input
          label="Branch pattern"
          placeholder='e.g., "main", "release/*"'
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          disabled={isEdit}
          hint={
            isEdit
              ? 'Pattern cannot be changed. Delete and recreate to use a different pattern.'
              : 'Use exact names or trailing wildcards like "release/*".'
          }
        />

        <Input
          label="Required approving reviews"
          type="number"
          min={0}
          max={10}
          value={String(requiredReviews)}
          onChange={(e) => setRequiredReviews(Math.max(0, parseInt(e.target.value, 10) || 0))}
          hint="Number of approving reviews required before merging. Set to 0 to disable."
        />

        <div className="space-y-3">
          <label className="block text-sm font-medium text-text">Restrictions</label>

          <label className="flex items-center gap-3 px-3 py-2 rounded-md border border-border hover:bg-surface-secondary cursor-pointer transition-colors">
            <Checkbox checked={requireCI} onChange={(e) => setRequireCI(e.target.checked)} />
            <div>
              <span className="text-sm font-medium">Require status checks to pass</span>
              <p className="text-xs text-text-tertiary">
                CI pipelines must succeed before merging.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 px-3 py-2 rounded-md border border-border hover:bg-surface-secondary cursor-pointer transition-colors">
            <Checkbox checked={noForcePush} onChange={(e) => setNoForcePush(e.target.checked)} />
            <div>
              <span className="text-sm font-medium">Prevent force pushes</span>
              <p className="text-xs text-text-tertiary">
                Disallow rewriting history on matching branches.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 px-3 py-2 rounded-md border border-border hover:bg-surface-secondary cursor-pointer transition-colors">
            <Checkbox checked={noDirectPush} onChange={(e) => setNoDirectPush(e.target.checked)} />
            <div>
              <span className="text-sm font-medium">Prevent direct pushes</span>
              <p className="text-xs text-text-tertiary">
                Require all changes to go through pull requests.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 px-3 py-2 rounded-md border border-border hover:bg-surface-secondary cursor-pointer transition-colors">
            <Checkbox
              checked={requireLinear}
              onChange={(e) => setRequireLinear(e.target.checked)}
            />
            <div>
              <span className="text-sm font-medium">Require linear history</span>
              <p className="text-xs text-text-tertiary">
                Prevent merge commits; only squash or rebase merges allowed.
              </p>
            </div>
          </label>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={mutation.isPending}>
          <ShieldCheck className="h-4 w-4" />{' '}
          {mutation.isPending ? 'Saving...' : isEdit ? 'Update rule' : 'Create rule'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
