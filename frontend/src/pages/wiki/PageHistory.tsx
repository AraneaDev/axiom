import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, GitCompare, History, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';

import { useWikiContext } from './WikiLayout';

import { wikiApi } from '@/api/wiki.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageLoader } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { formatDate } from '@/lib/utils';

/**
 * Page version history view with compare and restore functionality.
 * Sidebar is provided by WikiLayout.
 */
export default function PageHistory() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const { currentSpace } = useWikiContext();
  const navigate = useNavigate();

  const [selectedVersions, setSelectedVersions] = useState<number[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null);

  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['pageHistory', currentSpace?.id, pageSlug],
    queryFn: () => wikiApi.getPageHistory(currentSpace!.id, pageSlug!),
    enabled: !!currentSpace?.id && !!pageSlug,
  });

  const restoreMutation = useMutationWithToast(
    (version: number) => wikiApi.restoreVersion(currentSpace!.id, pageSlug!, version),
    {
      successMessage: null,
      invalidateKeys: [['pageHistory'], ['page']],
      onSuccess: () => setRestoreTarget(null),
    },
  );

  function handleVersionToggle(version: number) {
    setSelectedVersions((prev) => {
      if (prev.includes(version)) {
        return prev.filter((v) => v !== version);
      }
      if (prev.length >= 2) {
        return [prev[1], version];
      }
      return [...prev, version];
    });
  }

  function handleCompare() {
    if (selectedVersions.length !== 2) return;
    const [a, b] = selectedVersions.sort((x, y) => x - y);
    navigate(`/${org}/${team}/wiki/${spaceSlug}/${pageSlug}/diff?from=${a}&to=${b}`);
  }

  if (isLoading) return <PageLoader />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load page history</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <History className="h-5 w-5 text-text-secondary" />
          <h1 className="text-2xl font-bold">Page History</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={selectedVersions.length !== 2}
            onClick={handleCompare}
          >
            <GitCompare className="h-4 w-4" /> Compare selected
          </Button>
          <Link to={`/${org}/${team}/wiki/${spaceSlug}/${pageSlug}`}>
            <Button variant="secondary" size="sm">
              <History className="h-4 w-4" /> Back to page
            </Button>
          </Link>
        </div>
      </div>
      <Card className="divide-y divide-border">
        {versions?.map((v) => (
          <div key={v.id} className="flex items-center gap-3 p-4">
            <Checkbox
              checked={selectedVersions.includes(v.version)}
              onChange={() => handleVersionToggle(v.version)}
              aria-label={`Select version ${v.version} for comparison`}
            />
            <Badge variant="primary">v{v.version}</Badge>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{v.title}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-text-secondary">{formatDate(v.createdAt)}</p>
                {v.changeDescription && (
                  <p className="text-xs text-text-tertiary italic truncate">
                    {v.changeDescription}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Avatar name={v.author.displayName} size="sm" />
              <span className="text-sm text-text-secondary">{v.author.displayName}</span>
            </div>
            {v.version !== versions[0]?.version && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRestoreTarget(v.version)}
                title={`Restore to version ${v.version}`}
              >
                <RotateCcw className="h-4 w-4" /> Restore
              </Button>
            )}
          </div>
        ))}
      </Card>

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => {
          if (restoreTarget !== null) restoreMutation.mutate(restoreTarget);
        }}
        title="Restore version?"
        description={`This will create a new version with the content from version ${restoreTarget}. The current content will remain in the history.`}
        confirmLabel="Restore"
        variant="warning"
        loading={restoreMutation.isPending}
      />
    </div>
  );
}
