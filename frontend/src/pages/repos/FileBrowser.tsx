import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { FolderOpen, FileText, ChevronRight } from 'lucide-react';
import { reposApi } from '@/api/repos.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { PageLoader } from '@/components/ui/Spinner';

export default function FileBrowser() {
  const { org, team: teamSlug, repo: repoSlug, ref, '*': filePath } = useParams();
  const path = filePath || '';
  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id], queryFn: () => teamsApi.listByOrg(currentOrg!.id), enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id], queryFn: () => reposApi.listByTeam(currentTeam!.id), enabled: !!currentTeam?.id,
  });
  const currentRepo = repos?.find((r) => r.slug === repoSlug);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['tree', currentRepo?.id, ref, path],
    queryFn: () => reposApi.getTree(currentRepo!.id, ref!, path),
    enabled: !!currentRepo?.id && !!ref,
  });

  if (isLoading) return <PageLoader />;
  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;

  // Breadcrumbs
  const parts = path ? path.split('/') : [];
  const crumbs = parts.map((p, i) => ({
    name: p,
    path: parts.slice(0, i + 1).join('/'),
  }));

  return (
    <div>
      <div className="flex items-center gap-1 mb-4 text-sm">
        <Link to={`${basePath}`} className="text-primary hover:underline">{repoSlug}</Link>
        {crumbs.map((c) => (
          <span key={c.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-text-secondary" />
            <Link to={`${basePath}/tree/${ref}/${c.path}`} className="text-primary hover:underline">{c.name}</Link>
          </span>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {path && (
          <Link to={`${basePath}/tree/${ref}/${parts.slice(0, -1).join('/')}`}
            className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary text-sm text-text-secondary">..</Link>
        )}
        {tree?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1)).map((entry) => (
          <Link key={entry.sha + entry.name}
            to={entry.type === 'tree'
              ? `${basePath}/tree/${ref}/${path ? path + '/' : ''}${entry.name}`
              : `${basePath}/blob/${ref}/${path ? path + '/' : ''}${entry.name}`}
            className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary transition-colors">
            {entry.type === 'tree'
              ? <FolderOpen className="h-4 w-4 text-primary" />
              : <FileText className="h-4 w-4 text-text-secondary" />}
            <span className="text-sm">{entry.name}</span>
            {entry.size !== undefined && <span className="ml-auto text-xs text-text-secondary">{(entry.size / 1024).toFixed(1)} KB</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
