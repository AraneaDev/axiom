import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Trash2, Send, Pencil, Check, X } from 'lucide-react';
import { useState } from 'react';

import CreateReleaseModal from './CreateReleaseModal';

import { releasesApi, type Release } from '@/api/releases.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

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
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { user } = useAuthStore();

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

  const updateMutation = useMutation({
    mutationFn: ({ tagName, body }: { tagName: string; body: string }) =>
      releasesApi.update(repoId, tagName, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['releases', repoId] });
      setEditingTag(null);
    },
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
        {editingTag === release.tagName ? (
          <div className="space-y-2 mb-1">
            <MarkdownEditor value={editBody} onChange={setEditBody} compact />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ tagName: release.tagName, body: editBody })}
              >
                <Check className="h-4 w-4" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTag(null)}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        ) : release.body ? (
          <div className="text-xs text-text-secondary line-clamp-2 mb-1">
            <MarkdownRenderer content={release.body} />
          </div>
        ) : null}
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
        {user?.id === release.authorId && editingTag !== release.tagName && (
          <Button
            variant="ghost"
            size="sm"
            title="Edit release notes"
            onClick={() => {
              setEditBody(release.body ?? '');
              setEditingTag(release.tagName);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
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
          onClick={() => setDeleteTarget(release.tagName)}
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

      {/* Delete release confirmation */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Release"
        size="sm"
      >
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete release{' '}
          <code className="text-text font-mono">{deleteTarget}</code>? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget);
              setDeleteTarget(null);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
