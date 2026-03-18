import { useQuery } from '@tanstack/react-query';
import { Search, FileText } from 'lucide-react';
import { useSearchParams, Link } from 'react-router';

import { searchApi } from '@/api/search.api';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { PageLoader } from '@/components/ui/Spinner';
import { PRIORITY_COLORS } from '@/lib/constants';

/**
 *
 */
export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchApi.search(query),
    enabled: query.length > 0,
  });

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Search className="h-5 w-5 text-text-secondary" />
          <input
            type="text"
            defaultValue={query}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearchParams({ q: (e.target as HTMLInputElement).value });
            }}
            placeholder="Search issues, wiki pages..."
            className="flex-1 text-lg border-none outline-none bg-transparent placeholder:text-text-secondary"
            autoFocus
          />
        </div>
        {query && <p className="text-sm text-text-secondary">Results for "{query}"</p>}
      </div>

      {isLoading && <PageLoader />}

      {results?.map((group) => (
        <div key={group.type} className="mb-8">
          <h2 className="text-lg font-semibold mb-3 capitalize">{group.type}</h2>
          {!group.items.length ? (
            <p className="text-sm text-text-secondary">No {group.type} found.</p>
          ) : (
            <div className="rounded-lg border border-border bg-surface divide-y divide-border">
              {group.items.map((item) => (
                <Link
                  key={item.id}
                  to={item.url ?? '#'}
                  className="block p-3 hover:bg-surface-secondary transition-colors"
                >
                  {group.type === 'issues' ? (
                    <div className="flex items-center gap-3">
                      <IssueTypeIcon type={item.type as string} className="h-3.5 w-3.5" />
                      <span className="text-xs font-mono text-text-secondary">{item.key}</span>
                      <span className="text-sm font-medium flex-1">{item.title}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[item.priority as keyof typeof PRIORITY_COLORS] ?? ''}`}
                      >
                        {item.priority}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-text-secondary" />
                      <span className="text-sm font-medium flex-1">{item.title}</span>
                      <Badge>{item.space?.name ?? item.slug}</Badge>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}

      {query && !isLoading && (!results || results.every((r) => !r.items.length)) && (
        <EmptyState
          icon={<Search className="h-10 w-10" />}
          title="No results"
          description={`Nothing found for "${query}"`}
        />
      )}
    </div>
  );
}
