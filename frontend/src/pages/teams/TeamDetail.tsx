import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { FolderKanban, BookOpen, Users, Plus, GitBranch } from 'lucide-react';
import { teamsApi } from '@/api/teams.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { reposApi } from '@/api/repos.api';
import { wikiApi } from '@/api/wiki.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { Avatar } from '@/components/ui/Avatar';

export default function TeamDetail() {
  const { org, team: teamSlug } = useParams();

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: spaces } = useQuery({
    queryKey: ['wikiSpaces', currentTeam?.id],
    queryFn: () => wikiApi.listSpaces(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: teamDetail } = useQuery({
    queryKey: ['team', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  if (projectsLoading) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{currentTeam?.name}</h1>
          {currentTeam?.description && <p className="text-text-secondary text-sm mt-1">{currentTeam.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link to={`/${org}/${teamSlug}/members`}>
            <Button variant="secondary" size="sm"><Users className="h-4 w-4" /> Members</Button>
          </Link>
        </div>
      </div>

      {/* Projects */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Projects</h2>
          <Link to={`/${org}/${teamSlug}/projects/new`}>
            <Button variant="ghost" size="sm"><Plus className="h-4 w-4" /> New</Button>
          </Link>
        </div>
        {!projects?.length ? (
          <EmptyState icon={<FolderKanban className="h-10 w-10" />} title="No projects yet" description="Create a project to start tracking issues." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} to={`/${org}/${teamSlug}/${p.slug}/board`}
                className="rounded-lg border border-border bg-surface p-4 hover:border-primary/50 transition-all">
                <div className="flex items-center gap-2 mb-1">
                  <FolderKanban className="h-4 w-4 text-primary" />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-text-secondary ml-auto">{p.prefix}</span>
                </div>
                {p.description && <p className="text-sm text-text-secondary line-clamp-1">{p.description}</p>}
                <p className="text-xs text-text-secondary mt-2">{p._count?.issues ?? 0} issues</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Wiki Spaces */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Wiki</h2>
          <Link to={`/${org}/${teamSlug}/wiki/new`}>
            <Button variant="ghost" size="sm"><Plus className="h-4 w-4" /> New Space</Button>
          </Link>
        </div>
        {!spaces?.length ? (
          <EmptyState icon={<BookOpen className="h-10 w-10" />} title="No wiki spaces yet" description="Create a wiki space for team documentation." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {spaces.map((s) => (
              <Link key={s.id} to={`/${org}/${teamSlug}/wiki/${s.slug}`}
                className="rounded-lg border border-border bg-surface p-4 hover:border-primary/50 transition-all">
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <span className="font-medium">{s.name}</span>
                </div>
                {s.description && <p className="text-sm text-text-secondary line-clamp-1">{s.description}</p>}
                <p className="text-xs text-text-secondary mt-2">{s._count?.pages ?? 0} pages</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Repositories */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Repositories</h2>
          <Link to={`/${org}/${teamSlug}/repos/new`}>
            <Button variant="ghost" size="sm"><Plus className="h-4 w-4" /> New</Button>
          </Link>
        </div>
        {!repos?.length ? (
          <EmptyState icon={<GitBranch className="h-10 w-10" />} title="No repositories yet" description="Create a repository to start hosting code." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {repos.map((r) => (
              <Link key={r.id} to={`/${org}/${teamSlug}/repos/${r.slug}`}
                className="rounded-lg border border-border bg-surface p-4 hover:border-primary/50 transition-all">
                <div className="flex items-center gap-2 mb-1">
                  <GitBranch className="h-4 w-4 text-primary" />
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-text-tertiary ml-auto">{r.visibility.toLowerCase()}</span>
                </div>
                {r.description && <p className="text-sm text-text-secondary line-clamp-1">{r.description}</p>}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Members preview */}
      {teamDetail?.members && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Members ({teamDetail.members.length})</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {teamDetail.members.slice(0, 10).map((m: any) => (
              <div key={m.id} className="flex items-center gap-2 rounded-full border border-border bg-surface pl-1 pr-3 py-1">
                <Avatar name={m.user.displayName} size="sm" />
                <span className="text-sm">{m.user.displayName}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
