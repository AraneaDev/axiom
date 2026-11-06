import { Archive, ArchiveRestore, BookOpen, Eye, EyeOff, Plus, Shield } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { wikiApi } from '@/api/wiki.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { CardGridSkeleton } from '@/components/ui/Skeleton';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { cn } from '@/lib/utils';

import { SpacePermissions } from './SpacePermissions';
import { useWikiContext } from './WikiLayout';

/**
 * Wiki home page -- shows list of spaces as cards.
 * Layout chrome (sidebar) is handled by WikiLayout.
 */
export default function WikiHome() {
  const { org, team: teamSlug } = useParams();
  const { spaces, currentTeam } = useWikiContext();
  const [showArchived, setShowArchived] = useState(false);
  const [permissionsOf, setPermissionsOf] = useState<{
    id: string;
    name: string;
    teamId: string;
  } | null>(null);

  const archiveMutation = useMutationWithToast(
    ({ spaceId, isArchived }: { spaceId: string; isArchived: boolean }) =>
      wikiApi.updateSpace(spaceId, { isArchived }),
    { successMessage: null, invalidateKeys: [['wikiSpaces', currentTeam?.id]] },
  );

  if (!spaces)
    return (
      <div>
        <CardGridSkeleton />
      </div>
    );

  const activeSpaces = spaces.filter((s) => !s.isArchived);
  const archivedSpaces = spaces.filter((s) => s.isArchived);
  const displaySpaces = showArchived ? spaces : activeSpaces;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="h2">Wiki</h1>
        <div className="flex items-center gap-2">
          {archivedSpaces.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowArchived(!showArchived)}
              title={showArchived ? 'Hide archived spaces' : 'Show archived spaces'}
            >
              {showArchived ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showArchived ? 'Hide Archived' : `Show Archived (${archivedSpaces.length})`}
            </Button>
          )}
          <ButtonLink to={`/${org}/${teamSlug}/wiki/new`} size="sm">
            <Plus className="h-4 w-4" /> New Space
          </ButtonLink>
        </div>
      </div>

      {!displaySpaces.length ? (
        <EmptyState
          icon={<BookOpen className="h-12 w-12" />}
          title="No wiki spaces"
          description="Create a space to start documenting."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {displaySpaces.map((s) => (
            <Card
              key={s.id}
              className={cn(
                'p-5 transition-all',
                s.isArchived ? 'opacity-60' : 'hover:border-primary/50 hover:shadow-sm',
              )}
            >
              <Link to={`/${org}/${teamSlug}/wiki/${s.slug}`}>
                <div className="flex items-center gap-3 mb-2">
                  <BookOpen
                    className={cn('h-5 w-5', s.isArchived ? 'text-text-tertiary' : 'text-primary')}
                  />
                  <h3 className="font-semibold">{s.name}</h3>
                  {s.isArchived && <Badge variant="warning">Archived</Badge>}
                </div>
                {s.description && <p className="text-sm text-text-secondary">{s.description}</p>}
                <p className="text-xs text-text-secondary mt-2">{s._count?.pages ?? 0} pages</p>
              </Link>
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                {s.canManage && (
                  <Button
                    variant="ghost"
                    size="xs"
                    title={`Permissions of ${s.name}`}
                    onClick={() =>
                      setPermissionsOf({ id: s.id, name: s.name, teamId: currentTeam?.id ?? '' })
                    }
                  >
                    <Shield className="h-3.5 w-3.5" /> Permissions
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    archiveMutation.mutate({ spaceId: s.id, isArchived: !s.isArchived })
                  }
                  disabled={archiveMutation.isPending}
                >
                  {s.isArchived ? (
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                  {s.isArchived ? 'Unarchive' : 'Archive'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={permissionsOf !== null}
        onClose={() => setPermissionsOf(null)}
        title={permissionsOf ? `${permissionsOf.name}: permissions` : undefined}
        size="lg"
      >
        {permissionsOf && (
          <SpacePermissions spaceId={permissionsOf.id} teamId={permissionsOf.teamId} />
        )}
      </Modal>
    </div>
  );
}
