import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router';

import { useWikiContext } from './WikiLayout';

import { wikiApi } from '@/api/wiki.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { PageLoader } from '@/components/ui/Spinner';
import { formatDate } from '@/lib/utils';

/**
 * Page version history view.
 * Sidebar is provided by WikiLayout.
 */
export default function PageHistory() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const { currentSpace } = useWikiContext();

  const { data: versions, isLoading } = useQuery({
    queryKey: ['pageHistory', currentSpace?.id, pageSlug],
    queryFn: () => wikiApi.getPageHistory(currentSpace!.id, pageSlug!),
    enabled: !!currentSpace?.id && !!pageSlug,
  });

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Page History</h1>
        <Link to={`/${org}/${team}/wiki/${spaceSlug}/${pageSlug}`}>
          <span className="text-sm text-primary hover:underline">Back to page</span>
        </Link>
      </div>
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {versions?.map((v) => (
          <div key={v.id} className="flex items-center gap-3 p-4">
            <Badge variant="primary">v{v.version}</Badge>
            <div className="flex-1">
              <p className="text-sm font-medium">{v.title}</p>
              <p className="text-xs text-text-secondary">{formatDate(v.createdAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Avatar name={v.author.displayName} size="sm" />
              <span className="text-sm text-text-secondary">{v.author.displayName}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
