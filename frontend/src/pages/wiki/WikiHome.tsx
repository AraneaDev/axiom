import { BookOpen, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { useWikiContext } from './WikiLayout';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardGridSkeleton } from '@/components/ui/Skeleton';

/**
 * Wiki home page -- shows list of spaces as cards.
 * Layout chrome (sidebar) is handled by WikiLayout.
 */
export default function WikiHome() {
  const { org, team: teamSlug } = useParams();
  const { spaces } = useWikiContext();

  if (!spaces)
    return (
      <div>
        <CardGridSkeleton />
      </div>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Wiki</h1>
        <Link to={`/${org}/${teamSlug}/wiki/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4" /> New Space
          </Button>
        </Link>
      </div>

      {!spaces.length ? (
        <EmptyState
          icon={<BookOpen className="h-12 w-12" />}
          title="No wiki spaces"
          description="Create a space to start documenting."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {spaces.map((s) => (
            <Link
              key={s.id}
              to={`/${org}/${teamSlug}/wiki/${s.slug}`}
              className="rounded-lg border border-border bg-surface p-5 hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3 mb-2">
                <BookOpen className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">{s.name}</h3>
              </div>
              {s.description && <p className="text-sm text-text-secondary">{s.description}</p>}
              <p className="text-xs text-text-secondary mt-2">{s._count?.pages ?? 0} pages</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
