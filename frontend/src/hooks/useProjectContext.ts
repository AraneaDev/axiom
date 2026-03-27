import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { STABLE_STALE_TIME } from '@/lib/constants';

/**
 *
 */
export function useProjectContext() {
  const { org, team: teamSlug, project: projectSlug } = useParams();
  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);
  const basePath = `/${org}/${teamSlug}/${projectSlug}`;
  const isLoading = orgsLoading || teamsLoading || projectsLoading;
  return {
    org,
    teamSlug,
    projectSlug,
    currentOrg,
    currentTeam,
    currentProject,
    basePath,
    isLoading,
  };
}
