import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Shield, ShieldCheck, Trash2, Plus, X, Users } from 'lucide-react';
import { useState } from 'react';

import { teamsApi } from '@/api/teams.api';
import { wikiApi } from '@/api/wiki.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useModalState } from '@/hooks/useModalState';
import type { PageRestriction } from '@/lib/types';

interface PageRestrictionsProps {
  pageId: string;
  teamId: string;
  restrictions: PageRestriction[];
}

/**
 * Page restriction indicator and management dialog.
 * Shows a lock icon when restrictions exist, opens a dialog to manage them.
 * @param root0
 * @param root0.pageId
 * @param root0.teamId
 * @param root0.restrictions
 */
export function PageRestrictions({ pageId, teamId, restrictions }: PageRestrictionsProps) {
  const modal = useModalState();
  const queryClient = useQueryClient();
  const toast = useToast();

  const hasRestrictions = restrictions.length > 0;
  const viewRestrictions = restrictions.filter((r) => r.type === 'VIEW');
  const editRestrictions = restrictions.filter((r) => r.type === 'EDIT');

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={modal.open}
        title={hasRestrictions ? 'Page has restrictions' : 'Manage page restrictions'}
      >
        {hasRestrictions ? (
          <Lock className="h-4 w-4 text-warning" />
        ) : (
          <Shield className="h-4 w-4" />
        )}
        {hasRestrictions && <Badge size="sm">Restricted</Badge>}
      </Button>

      <Modal open={modal.isOpen} onClose={modal.close} title="Page Restrictions" size="lg">
        <RestrictionsDialogContent
          pageId={pageId}
          teamId={teamId}
          viewRestrictions={viewRestrictions}
          editRestrictions={editRestrictions}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ['pageRestrictions', pageId] });
            // Also invalidate the page query to refresh restriction data
            queryClient.invalidateQueries({ queryKey: ['page'] });
          }}
          toast={toast}
        />
        <ModalFooter>
          <Button variant="secondary" onClick={modal.close}>
            <X className="h-4 w-4" /> Close
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

interface RestrictionsDialogContentProps {
  pageId: string;
  teamId: string;
  viewRestrictions: PageRestriction[];
  editRestrictions: PageRestriction[];
  onUpdate: () => void;
  toast: ReturnType<typeof useToast>;
}

function RestrictionsDialogContent({
  pageId,
  teamId,
  viewRestrictions,
  editRestrictions,
  onUpdate,
  toast,
}: RestrictionsDialogContentProps) {
  const [activeTab, setActiveTab] = useState<'VIEW' | 'EDIT'>('EDIT');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: team } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId),
    enabled: !!teamId,
  });

  const currentRestrictions = activeTab === 'VIEW' ? viewRestrictions : editRestrictions;
  const currentUserIds = new Set(currentRestrictions.map((r) => r.userId).filter(Boolean));

  const members = team?.members ?? [];
  const filteredMembers = members.filter((m) => {
    if (currentUserIds.has(m.user.id)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.user.displayName.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q)
    );
  });

  const setRestrictionsMutation = useMutation({
    mutationFn: (userIds: string[]) => wikiApi.setRestrictions(pageId, activeTab, userIds),
    onSuccess: () => {
      onUpdate();
      toast.success('Restrictions updated');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to update restrictions'),
  });

  const removeRestrictionMutation = useMutation({
    mutationFn: (restrictionId: string) => wikiApi.removeRestriction(restrictionId),
    onSuccess: () => {
      onUpdate();
      toast.success('Restriction removed');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to remove restriction'),
  });

  function handleAddUser(userId: string) {
    const newUserIds = [...Array.from(currentUserIds).filter((id): id is string => !!id), userId];
    setRestrictionsMutation.mutate(newUserIds);
    setSearchQuery('');
  }

  function handleRemoveRestriction(restrictionId: string) {
    removeRestrictionMutation.mutate(restrictionId);
  }

  function handleClearAll() {
    setRestrictionsMutation.mutate([]);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Restrict who can view or edit this page. When restrictions are set, only listed users and
        org owners/admins can access the page.
      </p>

      {/* Tab selector */}
      <div className="flex gap-2 border-b border-border pb-2">
        <Button
          variant={activeTab === 'VIEW' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('VIEW')}
        >
          <Shield className="h-4 w-4" /> View Restrictions
          {viewRestrictions.length > 0 && <Badge size="sm">{viewRestrictions.length}</Badge>}
        </Button>
        <Button
          variant={activeTab === 'EDIT' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('EDIT')}
        >
          <ShieldCheck className="h-4 w-4" /> Edit Restrictions
          {editRestrictions.length > 0 && <Badge size="sm">{editRestrictions.length}</Badge>}
        </Button>
      </div>

      {/* Current restrictions */}
      {currentRestrictions.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-text">
              {activeTab === 'VIEW' ? 'Can view' : 'Can edit'} ({currentRestrictions.length})
            </h4>
            <Button variant="ghost" size="xs" onClick={handleClearAll}>
              <Trash2 className="h-3 w-3" /> Clear all
            </Button>
          </div>
          <div className="space-y-1">
            {currentRestrictions.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-surface-secondary"
              >
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="text-sm text-text">
                    {r.user?.displayName ?? r.user?.username ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-text-tertiary">@{r.user?.username}</span>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleRemoveRestriction(r.id)}
                  title="Remove restriction"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-text-tertiary py-3 text-center border border-dashed border-border rounded">
          No {activeTab.toLowerCase()} restrictions. All team members can{' '}
          {activeTab === 'VIEW' ? 'view' : 'edit'} this page.
        </div>
      )}

      {/* Add user */}
      <div>
        <h4 className="text-sm font-medium text-text mb-2">
          <Plus className="h-3.5 w-3.5 inline-block mr-1" />
          Add user
        </h4>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search team members..."
          className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-tertiary focus:border-border-focus focus:ring-1 focus:ring-primary/15 focus:outline-none"
        />
        {searchQuery && filteredMembers.length > 0 && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border bg-surface">
            {filteredMembers.slice(0, 10).map((m) => (
              <button
                key={m.user.id}
                type="button"
                onClick={() => handleAddUser(m.user.id)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text hover:bg-surface-secondary transition-colors text-left"
              >
                <Users className="h-3.5 w-3.5 text-text-tertiary" />
                <span>{m.user.displayName}</span>
                <span className="text-text-tertiary">@{m.user.username}</span>
              </button>
            ))}
          </div>
        )}
        {searchQuery && filteredMembers.length === 0 && (
          <p className="mt-1 text-xs text-text-tertiary">No matching team members found.</p>
        )}
      </div>
    </div>
  );
}
