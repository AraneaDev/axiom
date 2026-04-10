import { useQuery } from '@tanstack/react-query';
import { UserMinus, UserPlus, Mail, Copy, X, Clock, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import type { Invitation } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useModalState } from '@/hooks/useModalState';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useTeamContext } from '@/hooks/useTeamContext';
import type { TeamMember } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const ROLE_BADGE: Record<string, 'primary' | 'default' | 'warning'> = {
  ADMIN: 'primary',
  MEMBER: 'default',
  VIEWER: 'warning',
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

/**
 *
 */
export default function TeamMembers() {
  const { org, teamSlug, currentOrg, currentTeam } = useTeamContext();
  const toast = useToast();
  const inviteModal = useModalState();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');

  const {
    data: teamDetail,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['team', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: invitations } = useQuery({
    queryKey: ['invitations', currentOrg?.id, currentTeam?.id],
    queryFn: () => orgsApi.listInvitations(currentOrg!.id, currentTeam?.id),
    enabled: !!currentOrg?.id && !!currentTeam?.id,
  });

  const pendingInvitations = (invitations ?? []).filter(
    (inv: Invitation) => inv.status === 'PENDING' && new Date(inv.expiresAt) > new Date(),
  );

  const removeMutation = useMutationWithToast(
    (memberId: string) => teamsApi.removeMember(currentTeam!.id, memberId),
    { successMessage: null, invalidateKeys: [['team', currentTeam?.id]] },
  );

  const roleMutation = useMutationWithToast(
    ({ memberId, role }: { memberId: string; role: string }) =>
      teamsApi.updateMemberRole(currentTeam!.id, memberId, role),
    { successMessage: null, invalidateKeys: [['team', currentTeam?.id]] },
  );

  const inviteMutation = useMutationWithToast(
    (data: { email: string; role: string; teamId: string }) =>
      orgsApi.createInvitation(currentOrg!.id, data),
    {
      successMessage: 'Invitation sent',
      errorMessage: 'Failed to send invitation',
      invalidateKeys: [['invitations', currentOrg?.id, currentTeam?.id]],
      onSuccess: () => {
        inviteModal.close();
        setInviteEmail('');
        setInviteRole('MEMBER');
      },
    },
  );

  const revokeMutation = useMutationWithToast(
    (invitationId: string) => orgsApi.revokeInvitation(currentOrg!.id, invitationId),
    {
      successMessage: 'Invitation revoked',
      invalidateKeys: [['invitations', currentOrg?.id, currentTeam?.id]],
    },
  );

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !currentTeam?.id) return;
    inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole, teamId: currentTeam.id });
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/invitations/${token}/accept`;
    navigator.clipboard.writeText(link);
    toast.info('Invite link copied to clipboard');
  }

  if (isLoading)
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-7 w-40" />
        </div>
        <ListSkeleton rows={5} />
      </div>
    );

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load team members</p>
        </div>
      </div>
    );
  }

  const members = teamDetail?.members ?? [];
  const roleBreakdown = members.reduce(
    (acc: Record<string, number>, m: TeamMember) => {
      const label = ROLE_LABELS[m.role] ?? m.role;
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="">
      <PageHeader title="Team Members">
        <Button onClick={() => inviteModal.open()}>
          <UserPlus className="h-4 w-4" /> Invite Member
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div className="flex flex-col gap-6">
          <Card className="divide-y divide-border">
            {members.map((m: TeamMember) => (
              <div key={m.id} className="flex items-center gap-3 p-4">
                <Avatar name={m.user.displayName} />
                <Link
                  to={`/${org}/${teamSlug}/members/${m.user.username}`}
                  className="flex-1 min-w-0 hover:text-primary transition-colors"
                >
                  <p className="font-medium text-sm truncate">{m.user.displayName}</p>
                  <p className="text-xs text-text-secondary">@{m.user.username}</p>
                </Link>
                <Badge variant={ROLE_BADGE[m.role] ?? 'default'}>
                  {ROLE_LABELS[m.role] ?? m.role}
                </Badge>
                <div className="flex gap-1">
                  <Select
                    value={m.role}
                    onChange={(v) =>
                      roleMutation.mutate({ memberId: m.user.id, role: v as string })
                    }
                    options={[
                      { value: 'ADMIN', label: 'Admin' },
                      { value: 'MEMBER', label: 'Member' },
                      { value: 'VIEWER', label: 'Viewer' },
                    ]}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMutation.mutate(m.user.id)}
                    title="Remove member"
                  >
                    <UserMinus className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
              </div>
            ))}
          </Card>

          {/* Pending Invitations */}
          {pendingInvitations.length > 0 && (
            <div>
              <h2 className="h3 mb-3">Pending Invitations</h2>
              <Card className="divide-y divide-border">
                {pendingInvitations.map((inv: Invitation) => (
                  <div key={inv.id} className="flex items-center gap-3 p-4">
                    <div className="h-8 w-8 rounded-full bg-surface-secondary flex items-center justify-center">
                      <Mail className="h-4 w-4 text-text-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{inv.email}</p>
                      <p className="text-xs text-text-secondary">
                        Invited by {inv.inviter.displayName}
                      </p>
                    </div>
                    <Badge variant={ROLE_BADGE[inv.role] ?? 'default'}>{inv.role}</Badge>
                    <div className="flex items-center gap-1 text-xs text-text-tertiary">
                      <Clock className="h-3 w-3" />
                      <span>Expires {formatDate(inv.expiresAt)}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyInviteLink(inv.token)}
                        title="Copy invite link"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeMutation.mutate(inv.id)}
                        title="Revoke invitation"
                      >
                        <X className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>

        {/* Team summary sidebar */}
        <div className="space-y-4">
          <Card className="p-5">
            <p className="text-xs text-text-secondary uppercase font-semibold mb-3">Team Summary</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Total members</span>
                <span className="text-sm font-semibold text-text">{members.length}</span>
              </div>
              {Object.entries(roleBreakdown).map(([label, count]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">{label}</span>
                  <span className="text-sm text-text">{count as number}</span>
                </div>
              ))}
              {pendingInvitations.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-sm text-text-secondary">Pending invites</span>
                  <span className="text-sm font-semibold text-text">
                    {pendingInvitations.length}
                  </span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Invite Member Modal */}
      <Modal open={inviteModal.isOpen} onClose={inviteModal.close} title="Invite Member">
        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@example.com"
            required
          />
          <div>
            <label className="block text-sm font-medium text-text mb-1">Role</label>
            <Select
              value={inviteRole}
              onChange={(v) => setInviteRole(v as string)}
              options={[
                { value: 'ADMIN', label: 'Admin' },
                { value: 'MEMBER', label: 'Member' },
                { value: 'VIEWER', label: 'Viewer' },
              ]}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => inviteModal.close()}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="submit" disabled={inviteMutation.isPending}>
              <Mail className="h-4 w-4" /> Send Invitation
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
