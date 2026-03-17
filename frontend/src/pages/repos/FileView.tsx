import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ChevronRight, Copy } from 'lucide-react';
import { reposApi } from '@/api/repos.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';

export default function FileView() {
  const { org, team: teamSlug, repo: repoSlug, ref, '*': filePath } = useParams();
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

  const { data: blob, isLoading } = useQuery({
    queryKey: ['blob', currentRepo?.id, ref, filePath],
    queryFn: () => reposApi.getBlob(currentRepo!.id, ref!, filePath!),
    enabled: !!currentRepo?.id && !!ref && !!filePath,
  });

  if (isLoading) return <PageLoader />;
  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;
  const parts = filePath?.split('/') ?? [];
  const fileName = parts[parts.length - 1] ?? '';
  const lines = blob?.content?.split('\n') ?? [];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <Link to={basePath} className="text-primary hover:underline">{repoSlug}</Link>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-text-secondary" />
            {i < parts.length - 1 ? (
              <Link to={`${basePath}/tree/${ref}/${parts.slice(0, i + 1).join('/')}`} className="text-primary hover:underline">{p}</Link>
            ) : (
              <span className="font-medium">{p}</span>
            )}
          </span>
        ))}
      </div>

      {/* File header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-secondary">{blob?.size ? `${(blob.size / 1024).toFixed(1)} KB` : ''} &middot; {lines.length} lines</span>
        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(blob?.content ?? '')}>
          <Copy className="h-4 w-4" /> Copy
        </Button>
      </div>

      {/* File content with line numbers */}
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <pre className="text-sm font-mono p-4">
          <table className="w-full">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-surface-secondary">
                  <td className="text-right pr-4 text-text-secondary select-none w-12 align-top">{i + 1}</td>
                  <td className="whitespace-pre">{line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </pre>
      </div>
    </div>
  );
}
