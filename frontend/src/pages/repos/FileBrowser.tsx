import { useQuery } from '@tanstack/react-query';
import { FolderOpen, FileText, ChevronRight, GitBranch, ChevronDown } from 'lucide-react';
import { Link, useParams, useNavigate } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { PageLoader } from '@/components/ui/Spinner';
import { useRepoContext } from '@/hooks/useRepoContext';

/**
 *
 */
export default function FileBrowser() {
  const { ref, '*': filePath } = useParams();
  const path = filePath || '';
  const { currentRepo, basePath, repoSlug } = useRepoContext();
  const navigate = useNavigate();

  const { data: branches } = useQuery({
    queryKey: ['branches', currentRepo?.id],
    queryFn: () => reposApi.listBranches(currentRepo!.id),
    enabled: !!currentRepo?.id,
  });

  const { data: tree, isLoading } = useQuery({
    queryKey: ['tree', currentRepo?.id, ref, path],
    queryFn: () => reposApi.getTree(currentRepo!.id, ref!, path),
    enabled: !!currentRepo?.id && !!ref,
  });

  if (isLoading || !currentRepo) return <PageLoader />;

  // Breadcrumbs
  const parts = path ? path.split('/') : [];
  const crumbs = parts.map((p, i) => ({
    name: p,
    path: parts.slice(0, i + 1).join('/'),
  }));

  return (
    <div>
      {/* Branch switcher */}
      <div className="flex items-center gap-3 mb-4">
        <Dropdown
          trigger={
            <Button variant="secondary" size="sm">
              <GitBranch className="h-4 w-4" /> {ref} <ChevronDown className="h-3 w-3" />
            </Button>
          }
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {branches?.map((branch) => (
              <DropdownItem
                key={branch.name}
                onClick={() => navigate(`${basePath}/tree/${branch.name}/${path}`)}
                className={branch.name === ref ? 'bg-surface-tertiary font-medium' : ''}
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{branch.name}</span>
                {branch.name === currentRepo.defaultBranch && (
                  <Badge variant="primary" size="sm" className="ml-auto">
                    default
                  </Badge>
                )}
              </DropdownItem>
            ))}
          </div>
        </Dropdown>
      </div>

      <div className="flex items-center gap-1 mb-4 text-sm">
        <Link to={`${basePath}`} className="text-primary hover:underline">
          {repoSlug}
        </Link>
        {crumbs.map((c) => (
          <span key={c.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-text-secondary" />
            <Link to={`${basePath}/tree/${ref}/${c.path}`} className="text-primary hover:underline">
              {c.name}
            </Link>
          </span>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {path && (
          <Link
            to={`${basePath}/tree/${ref}/${parts.slice(0, -1).join('/')}`}
            className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary text-sm text-text-secondary"
          >
            ..
          </Link>
        )}
        {tree
          ?.sort((a, b) =>
            a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1,
          )
          .map((entry) => (
            <Link
              key={entry.sha + entry.name}
              to={
                entry.type === 'tree'
                  ? `${basePath}/tree/${ref}/${path ? path + '/' : ''}${entry.name}`
                  : `${basePath}/blob/${ref}/${path ? path + '/' : ''}${entry.name}`
              }
              className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary transition-colors"
            >
              {entry.type === 'tree' ? (
                <FolderOpen className="h-4 w-4 text-primary" />
              ) : (
                <FileText className="h-4 w-4 text-text-secondary" />
              )}
              <span className="text-sm">{entry.name}</span>
              {entry.size !== undefined && (
                <span className="ml-auto text-xs text-text-secondary">
                  {(entry.size / 1024).toFixed(1)} KB
                </span>
              )}
            </Link>
          ))}
      </div>
    </div>
  );
}
