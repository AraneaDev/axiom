import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Clock,
  ListChecks,
  Mail,
  Shield,
  User,
} from 'lucide-react';
import { useParams } from 'react-router';

import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { UserName } from '@/components/ui/UserName';
import { ViaLabel } from '@/components/ui/ViaLabel';
import { useTeamContext } from '@/hooks/useTeamContext';
import { formatDate, formatRelative } from '@/lib/utils';

const ROLE_BADGE: Record<string, 'primary' | 'default' | 'warning'> = {
  ADMIN: 'primary',
  MEMBER: 'default',
  VIEWER: 'warning',
};

/**
 *
 */
export default function MemberProfile() {
  const { org, teamSlug, currentTeam } = useTeamContext();
  const { username } = useParams();

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['member-profile', currentTeam?.id, username],
    queryFn: () => teamsApi.getMemberProfile(currentTeam!.id, username!),
    enabled: !!currentTeam?.id && !!username,
  });

  if (isLoading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load member profile</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="">
      <div className="mb-6">
        <ButtonLink to={`/${org}/${teamSlug}/members`} variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" /> Back to Members
        </ButtonLink>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Main content */}
        <div className="flex flex-col gap-6">
          {/* Profile header */}
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <Avatar name={profile.displayName} src={profile.avatarUrl ?? undefined} size="lg" />
              <div>
                <h1 className="h2">
                  <UserName user={profile} />
                </h1>
                <p className="text-sm text-text-secondary">@{profile.username}</p>
              </div>
              <div className="ml-auto">
                <Badge variant={ROLE_BADGE[profile.role] ?? 'default'}>{profile.role}</Badge>
              </div>
            </div>
          </Card>

          {/* Recent Activity */}
          <Card>
            <div className="px-4 py-3 border-b border-border-light">
              <h2 className="text-sm font-semibold">Recent Activity</h2>
            </div>
            {!profile.recentActivity?.length ? (
              <EmptyState
                title="No recent activity"
                description="This member has no recorded activity yet."
              />
            ) : (
              <div className="divide-y divide-border">
                {profile.recentActivity.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                    <Avatar
                      name={a.user.displayName}
                      src={a.user.avatarUrl ?? undefined}
                      size="sm"
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">
                          <UserName user={a.user} />
                        </span>{' '}
                        <ViaLabel via={a.via} />{' '}
                        <span className="text-text-secondary">{a.action}</span>{' '}
                        <span className="text-text-secondary">{a.resourceType?.toLowerCase()}</span>
                      </p>
                    </div>
                    <span className="text-xs text-text-tertiary shrink-0 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatRelative(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Stats */}
          <Card className="p-5 space-y-3">
            <p className="text-xs text-text-secondary uppercase font-semibold">Stats</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Assigned Issues
              </span>
              <span className="text-sm font-semibold">{profile.assignedIssuesCount}</span>
            </div>
          </Card>

          {/* Details */}
          <Card className="p-5 space-y-3">
            <p className="text-xs text-text-secondary uppercase font-semibold">Details</p>
            {/* Only team ADMINs, org OWNERs/ADMINs and platform admins receive the email */}
            {profile.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-text-tertiary" />
                <span className="text-text-secondary">{profile.email}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-text-tertiary" />
              <span className="text-text-secondary">@{profile.username}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-text-tertiary" />
              <Badge variant={ROLE_BADGE[profile.role] ?? 'default'} size="sm">
                {profile.role}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-text-tertiary" />
              <span className="text-text-secondary">Joined {formatDate(profile.joinedAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-text-tertiary" />
              <span className="text-text-secondary">
                Account created {formatDate(profile.createdAt)}
              </span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
