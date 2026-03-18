import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { Plus, Building2, ArrowRight, Users, GitBranch, FolderKanban, Layers } from 'lucide-react';
import { Link } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import type { Team } from '@/lib/types';
import { useAuthStore } from '@/stores/auth.store';

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-4">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-text">{value}</p>
        <p className="text-xs text-text-tertiary">{label}</p>
      </div>
    </div>
  );
}

function TeamCard({
  team,
  orgSlug,
}: {
  team: Team & { _count?: { members: number; repos: number; projects: number } };
  orgSlug: string;
}) {
  return (
    <Link
      to={`/${orgSlug}/${team.slug}`}
      className="group rounded-xl border border-border bg-surface p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text text-sm truncate">{team.name}</h3>
          <p className="text-xs text-text-tertiary">/{team.slug}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
      </div>
      {team.description && (
        <p className="text-sm text-text-secondary line-clamp-2 mb-3">{team.description}</p>
      )}
      <div className="flex gap-4 text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <FolderKanban className="h-3 w-3" /> {team._count?.projects ?? 0} projects
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" /> {team._count?.repos ?? 0} repos
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" /> {team._count?.members ?? 0} members
        </span>
      </div>
    </Link>
  );
}

/**
 *
 */
export default function Dashboard() {
  const { user } = useAuthStore();
  const { data: orgs, isLoading } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });

  // Fetch teams for all orgs to aggregate stats
  const firstOrg = orgs?.[0];
  const { data: teams } = useQuery({
    queryKey: ['teams', firstOrg?.id],
    queryFn: () => teamsApi.listByOrg(firstOrg!.id),
    enabled: !!firstOrg?.id,
  });

  if (isLoading) return <PageLoader />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // Aggregate stats from teams
  const totalTeams = teams?.length ?? 0;
  const totalProjects = teams?.reduce((sum, t) => sum + (t._count?.projects ?? 0), 0) ?? 0;
  const totalRepos = teams?.reduce((sum, t) => sum + (t._count?.repos ?? 0), 0) ?? 0;
  const totalMembers = teams?.reduce((sum, t) => sum + (t._count?.members ?? 0), 0) ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text">
            {greeting}, {user?.displayName?.split(' ')[0]}
          </h1>
          <p className="text-text-secondary text-sm mt-0.5">Here's an overview of your workspace</p>
        </div>
        <Link to="/orgs/new">
          <Button variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5" /> New Organization
          </Button>
        </Link>
      </div>

      {!orgs?.length ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title="No organizations yet"
          description="Create your first organization to start managing projects and documentation."
          action={
            <Link to="/orgs/new">
              <Button>
                <Plus className="h-4 w-4" /> Create Organization
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
            <StatCard
              icon={Layers}
              label="Teams"
              value={totalTeams}
              color="bg-gradient-to-br from-indigo-500 to-purple-600"
            />
            <StatCard
              icon={FolderKanban}
              label="Projects"
              value={totalProjects}
              color="bg-gradient-to-br from-emerald-400 to-teal-500"
            />
            <StatCard
              icon={GitBranch}
              label="Repositories"
              value={totalRepos}
              color="bg-gradient-to-br from-sky-400 to-blue-500"
            />
            <StatCard
              icon={Users}
              label="Team Members"
              value={totalMembers}
              color="bg-gradient-to-br from-amber-400 to-orange-500"
            />
          </div>

          {/* Org cards */}
          <h2 className="text-lg font-semibold text-text mb-3">Organizations</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
            {orgs.map((org) => (
              <Link
                key={org.id}
                to={`/${org.slug}`}
                className="group rounded-xl border border-border bg-surface overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200"
              >
                <div className="h-16 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 flex items-end px-5 pb-3">
                  <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-sm -mb-5 ring-2 ring-surface">
                    <span className="text-white text-sm font-bold">{org.name[0]}</span>
                  </div>
                </div>
                <div className="p-5 pt-7">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-text text-sm truncate">{org.name}</h3>
                    <Badge variant="outline" size="sm">
                      {org.role?.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-tertiary mb-2">/{org.slug}</p>
                  {org.description && (
                    <p className="text-sm text-text-secondary line-clamp-2 mb-3">
                      {org.description}
                    </p>
                  )}
                  <div className="flex items-center text-xs text-text-tertiary group-hover:text-primary transition-colors">
                    <span>Open workspace</span>
                    <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Teams overview */}
          {teams && teams.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-text mb-3">Teams</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {teams.map((team) => (
                  <TeamCard key={team.id} team={team} orgSlug={firstOrg!.slug} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
