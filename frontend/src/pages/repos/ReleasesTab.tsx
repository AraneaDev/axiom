import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Trash2, Send } from 'lucide-react';
import { useState } from 'react';

import CreateReleaseModal from './CreateReleaseModal';

import { releasesApi, type Release } from '@/api/releases.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/utils';

interface Props {
  repoId: string;
  orgSlug: string;
  teamSlug: string;
  repoSlug: string;
  defaultBranch: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.defaultBranch
 */
export default function ReleasesTab({ repoId, defaultBranch }: Props) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: releases = [] } = useQuery({
    queryKey: ['releases', repoId],
    queryFn: () => releasesApi.list(repoId),
  });

  const publishMutation = useMutation({
    mutationFn: (tagName: string) => releasesApi.publish(repoId, tagName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['releases', repoId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (tagName: string) => releasesApi.delete(repoId, tagName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['releases', repoId] }),
  });

  const published = releases.filter((r) => !r.isDraft);
  const drafts = releases.filter((r) => r.isDraft);

  const ReleaseRow = ({ release }: { release: Release }) => (
    <div className="flex items-start gap-4 p-4 hover:bg-surface-secondary transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono bg-primary-light text-primary px-2 py-0.5 rounded border border-primary/20">
            {release.tagName}
          </span>
          {release.isDraft && (
            <Badge variant="outline" size="sm">
              Draft
            </Badge>
          )}
          {release.isPrerelease && (
            <Badge variant="outline" size="sm">
              Pre-release
            </Badge>
          )}
        </div>
        <h3 className="font-semibold text-sm mb-0.5">{release.title}</h3>
        {release.body && (
          <div className="text-xs text-text-secondary line-clamp-2 mb-1">
            <MarkdownRenderer content={release.body} />
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Avatar name={release.author.displayName} size="sm" />
          <span>{release.author.displayName}</span>
          <span>·</span>
          <span>{formatRelative(release.createdAt)}</span>
          <span>·</span>
          <span>{release.targetBranch}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {release.isDraft && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => publishMutation.mutate(release.tagName)}
            disabled={publishMutation.isPending}
          >
            <Send className="h-3.5 w-3.5" /> Publish
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          title={`Delete release ${release.tagName}`}
          onClick={() => {
            if (confirm(`Delete release ${release.tagName}?`)) {
              deleteMutation.mutate(release.tagName);
            }
          }}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">{releases.length} releases</p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Release
        </Button>
      </div>

      {!releases.length ? (
        <EmptyState
          icon={<Tag className="h-10 w-10" />}
          title="No releases yet"
          description="Create your first release to publish a version of this repository."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Create Release
            </Button>
          }
        />
      ) : (
        <>
          {drafts.length > 0 && (
            <div className="rounded-lg border border-border bg-surface mb-4 overflow-hidden">
              <div className="px-4 py-2 bg-surface-secondary border-b border-border">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  Drafts
                </span>
              </div>
              <div className="divide-y divide-border">
                {drafts.map((r) => (
                  <ReleaseRow key={r.id} release={r} />
                ))}
              </div>
            </div>
          )}
          {published.length > 0 && (
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <div className="px-4 py-2 bg-surface-secondary border-b border-border">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  Published
                </span>
              </div>
              <div className="divide-y divide-border">
                {published.map((r) => (
                  <ReleaseRow key={r.id} release={r} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateReleaseModal
          repoId={repoId}
          defaultBranch={defaultBranch}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['releases', repoId] });
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}
