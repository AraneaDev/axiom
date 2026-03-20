import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { PageLoader } from '@/components/ui/Spinner';

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

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => teamsApi.removeMember(currentTeam!.id, memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', currentTeam?.id] }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      teamsApi.updateMemberRole(currentTeam!.id, memberId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', currentTeam?.id] }),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Team Members</h1>
      </div>

      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {teamDetail?.members?.map(
          (m: {
            id: string;
            role: string;
            user: { id: string; displayName: string; username: string };
          }) => (
            <div key={m.id} className="flex items-center gap-3 p-4">
              <Avatar name={m.user.displayName} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{m.user.displayName}</p>
                <p className="text-xs text-text-secondary">@{m.user.username}</p>
              </div>
              <Badge variant={ROLE_BADGE[m.role] ?? 'default'}>{m.role}</Badge>
              <div className="flex gap-1">
                <Select
                  value={m.role}
                  onChange={(v) => roleMutation.mutate({ memberId: m.user.id, role: v as string })}
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
    </div>
  );
}
