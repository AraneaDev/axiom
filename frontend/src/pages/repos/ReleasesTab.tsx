import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag,
  Plus,
  Trash2,
  Send,
  Pencil,
  Check,
  X,
  Rocket,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';

import CreateReleaseModal from './CreateReleaseModal';

import { deploymentsApi } from '@/api/deployments.api';
import type { DeploymentEnvironment } from '@/api/deployments.api';
import { releasesApi, type Release, type ReleaseDeployment } from '@/api/releases.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

interface Props {
  repoId: string;
  orgSlug: string;
  teamSlug: string;
  repoSlug: string;
  defaultBranch: string;
}

function deployStatusVariant(status: string): 'success' | 'danger' | 'warning' | 'default' {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
      return 'danger';
    case 'IN_PROGRESS':
      return 'warning';
    case 'PENDING':
    default:
      return 'default';
  }
}

/**
 *
 * @param root0
 * @param root0.repoId
 * @param root0.defaultBranch
 */
export default function ReleasesTab({ repoId, defaultBranch }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expandedDeployments, setExpandedDeployments] = useState<string | null>(null);
  const { user } = useAuthStore();

  const { data: releases = [] } = useQuery({
    queryKey: ['releases', repoId],
    queryFn: () => releasesApi.list(repoId),
  });

  const { data: environments = [] } = useQuery({
    queryKey: ['environments', repoId],
    queryFn: () => deploymentsApi.listEnvironments(repoId),
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

  const deployMutation = useMutation({
    mutationFn: ({ tagName, environmentId }: { tagName: string; environmentId: string }) =>
      releasesApi.deploy(repoId, tagName, environmentId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['releases', repoId] });
      qc.invalidateQueries({ queryKey: ['environments', repoId] });
      qc.invalidateQueries({
        queryKey: ['release-deployments', repoId, variables.tagName],
      });
      toast.success('Deployment initiated');
    },
    onError: () => toast.error('Failed to deploy release'),
  });

  const published = releases.filter((r) => !r.isDraft);
  const drafts = releases.filter((r) => r.isDraft);

  const DeploymentHistory = ({ tagName }: { tagName: string }) => {
    const { data: deployments = [] } = useQuery({
      queryKey: ['release-deployments', repoId, tagName],
      queryFn: () => releasesApi.listDeployments(repoId, tagName),
    });

    if (deployments.length === 0) {
      return <p className="text-xs text-text-tertiary px-4 py-2">No deployments yet.</p>;
    }

    return (
      <div className="border-t border-border bg-surface-secondary">
        <Table className="text-xs">
          <Thead>
            <TrHead>
              <Th className="py-1.5">Environment</Th>
              <Th className="py-1.5">Status</Th>
              <Th className="py-1.5">Deployed By</Th>
              <Th className="py-1.5">Time</Th>
            </TrHead>
          </Thead>
          <Tbody>
            {deployments.map((d: ReleaseDeployment) => (
              <tr key={d.id}>
                <Td className="py-1.5 text-text">{d.environment?.name}</Td>
                <Td className="py-1.5">
                  <Badge variant={deployStatusVariant(d.status)} size="sm">
                    {d.status.toLowerCase().replace('_', ' ')}
                  </Badge>
                </Td>
                <Td className="py-1.5 text-text-secondary">
                  {d.deployedBy?.displayName || d.deployedBy?.username}
                </Td>
                <Td className="py-1.5 text-text-tertiary flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelative(d.createdAt)}
                </Td>
              </tr>
            ))}
          </Tbody>
        </Table>
      </div>
    );
  };

  const ReleaseRow = ({ release }: { release: Release }) => {
    const isExpanded = expandedDeployments === release.tagName;

    return (
      <div>
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
                    onClick={() =>
                      updateMutation.mutate({
                        tagName: release.tagName,
                        body: editBody,
                      })
                    }
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
            {!release.isDraft && environments.length > 0 && (
              <Dropdown
                align="right"
                trigger={
                  <Button variant="ghost" size="sm" disabled={deployMutation.isPending}>
                    <Rocket className="h-3.5 w-3.5" /> Deploy
                  </Button>
                }
              >
                {environments.map((env: DeploymentEnvironment) => (
                  <DropdownItem
                    key={env.id}
                    onClick={() =>
                      deployMutation.mutate({
                        tagName: release.tagName,
                        environmentId: env.id,
                      })
                    }
                  >
                    <Rocket className="h-3.5 w-3.5" /> {env.name}
                  </DropdownItem>
                ))}
              </Dropdown>
            )}
            <Button
              variant="ghost"
              size="sm"
              title="Deployment history"
              onClick={() => setExpandedDeployments(isExpanded ? null : release.tagName)}
            >
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>
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
        {isExpanded && <DeploymentHistory tagName={release.tagName} />}
      </div>
    );
  };

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
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        title="Delete Release"
        description={`Are you sure you want to delete release ${deleteTarget}? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
