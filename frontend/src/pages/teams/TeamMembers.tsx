import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserMinus, UserPlus, Mail, Copy, X, Clock } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import type { Invitation } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const ROLE_BADGE: Record<string, 'primary' | 'default' | 'warning'> = {
  ADMIN: 'primary',
  MEMBER: 'default',
  VIEWER: 'warning',
};

/**
 *
 */
export default function TeamMembers() {
  const { org, team: teamSlug } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: teamDetail, isLoading } = useQuery({
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

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => teamsApi.removeMember(currentTeam!.id, memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', currentTeam?.id] }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      teamsApi.updateMemberRole(currentTeam!.id, memberId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', currentTeam?.id] }),
  });

  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; role: string; teamId: string }) =>
      orgsApi.createInvitation(currentOrg!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', currentOrg?.id, currentTeam?.id] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      toast.success('Invitation sent');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to send invitation');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => orgsApi.revokeInvitation(currentOrg!.id, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', currentOrg?.id, currentTeam?.id] });
      toast.success('Invitation revoked');
    },
  });

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

  const members = teamDetail?.members ?? [];
  const roleBreakdown = members.reduce(
    (acc: Record<string, number>, m: { role: string }) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Team Members</h1>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4" /> Invite Member
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-surface divide-y divide-border">
            {members.map(
              (m: {
                id: string;
                role: string;
                user: { id: string; displayName: string; username: string };
              }) => (
                <div key={m.id} className="flex items-center gap-3 p-4">
                  <Avatar name={m.user.displayName} />
                  <Link
                    to={`/${org}/${teamSlug}/members/${m.user.username}`}
                    className="flex-1 min-w-0 hover:text-primary transition-colors"
                  >
                    <p className="font-medium text-sm truncate">{m.user.displayName}</p>
                    <p className="text-xs text-text-secondary">@{m.user.username}</p>
                  </Link>
                  <Badge variant={ROLE_BADGE[m.role] ?? 'default'}>{m.role}</Badge>
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
              ),
            )}
          </div>

          {/* Pending Invitations */}
          {pendingInvitations.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Pending Invitations</h2>
              <div className="rounded-lg border border-border bg-surface divide-y divide-border">
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
                      <span>Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
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
              </div>
            </div>
          )}
        </div>

        {/* Team summary sidebar */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-text-secondary uppercase font-semibold mb-3">Team Summary</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Total members</span>
                <span className="text-sm font-semibold text-text">{members.length}</span>
              </div>
              {Object.entries(roleBreakdown).map(([role, count]) => (
                <div key={role} className="flex items-center justify-between">
                  <Badge variant={ROLE_BADGE[role] ?? 'default'} size="sm">
                    {role}
                  </Badge>
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
          </div>
        </div>
      </div>

      {/* Invite Member Modal */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite Member">
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
            <Button variant="ghost" type="button" onClick={() => setInviteOpen(false)}>
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
