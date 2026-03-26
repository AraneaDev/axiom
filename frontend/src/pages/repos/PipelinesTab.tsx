import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Workflow,
  Plus,
  Play,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { pipelinesApi, type RunStatus, type Pipeline } from '@/api/pipelines.api';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { formatRelative } from '@/lib/utils';

const STATUS_ICON: Record<RunStatus, React.ReactNode> = {
  SUCCESS: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
  FAILURE: <XCircle className="h-3.5 w-3.5 text-danger" />,
  RUNNING: <RefreshCw className="h-3.5 w-3.5 text-warning animate-spin" />,
  PENDING: <Clock className="h-3.5 w-3.5 text-text-tertiary" />,
  CANCELLED: <X className="h-3.5 w-3.5 text-text-tertiary" />,
  SKIPPED: <Clock className="h-3.5 w-3.5 text-text-tertiary" />,
};

const DEFAULT_YAML = `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    name: Build and Test
    steps:
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
`;

interface PipelineEditorModalProps {
  repoId: string;
  pipeline?: Pipeline;
  onClose: () => void;
  onSaved: () => void;
}

function PipelineEditorModal({ repoId, pipeline, onClose, onSaved }: PipelineEditorModalProps) {
  const [name, setName] = useState(pipeline?.name ?? '');
  const [yaml, setYaml] = useState(pipeline?.yamlContent ?? DEFAULT_YAML);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setErrors([]);
    setLoading(true);
    try {
      if (pipeline) {
        await pipelinesApi.update(repoId, pipeline.id, { name, yamlContent: yaml });
      } else {
        await pipelinesApi.create(repoId, { name, yamlContent: yaml });
      }
      onSaved();
    } catch (e: unknown) {
      const err = e as { errors?: string[]; message?: string };
      setErrors(err.errors ?? [err.message ?? 'Save failed']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={pipeline ? 'Edit Pipeline' : 'New Pipeline'}
      size="lg"
    >
      <div className="space-y-3">
        <div>
          <Input
            label="Pipeline Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="CI"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-text-secondary mb-1.5 block">
            YAML Configuration
          </label>
          <Textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            rows={20}
            className="font-mono resize-y text-xs"
            spellCheck={false}
          />
        </div>
        {errors.length > 0 && (
          <div className="bg-danger-light border border-danger/20 rounded-lg p-3">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-danger">
                {e}
              </p>
            ))}
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button onClick={handleSave} disabled={!name || loading}>
          <Workflow className="h-4 w-4" /> {loading ? 'Saving...' : 'Save Pipeline'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

interface Props {
  repoId: string;
}

/**
 *
 * @param root0
 * @param root0.repoId
 */
export default function PipelinesTab({ repoId }: Props) {
  const {
    org,
    team: teamSlug,
    repo: repoSlug,
  } = useParams<{ org: string; team: string; repo: string }>();
  const qc = useQueryClient();
  const [showEditor, setShowEditor] = useState(false);
  const [editPipeline, setEditPipeline] = useState<Pipeline | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);

  const { data: pipelines = [], isLoading: loadingPipelines } = useQuery({
    queryKey: ['pipelines', repoId],
    queryFn: () => pipelinesApi.list(repoId),
  });

  const { data: recentRuns = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['pipeline-runs', repoId],
    queryFn: () => pipelinesApi.listRuns(repoId, { limit: 10 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (pipelineId: string) => pipelinesApi.delete(repoId, pipelineId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipelines', repoId] }),
  });

  const triggerMutation = useMutation({
    mutationFn: ({ pipelineId }: { pipelineId: string }) =>
      pipelinesApi.triggerRun(repoId, pipelineId, 'HEAD'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline-runs', repoId] }),
  });

  if (loadingPipelines || loadingRuns) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">{pipelines.length} pipelines</p>
        <Button
          size="sm"
          onClick={() => {
            setEditPipeline(undefined);
            setShowEditor(true);
          }}
        >
          <Plus className="h-4 w-4" /> New Pipeline
        </Button>
      </div>

      {!pipelines.length ? (
        <EmptyState
          icon={<Workflow className="h-10 w-10" />}
          title="No pipelines yet"
          description="Create a pipeline to automate your CI/CD workflow."
          action={
            <Button onClick={() => setShowEditor(true)}>
              <Plus className="h-4 w-4" /> Create Pipeline
            </Button>
          }
        />
      ) : (
        <>
          <div className="rounded-lg border border-border bg-surface overflow-hidden mb-6">
            <div className="divide-y divide-border">
              {pipelines.map((p) => {
                const lastRun = p.runs?.[0];
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.name}</span>
                        {!p.isActive && (
                          <span className="text-xs text-text-tertiary">(inactive)</span>
                        )}
                      </div>
                      {lastRun && (
                        <div className="flex items-center gap-1.5 text-xs text-text-tertiary mt-0.5">
                          {STATUS_ICON[lastRun.status]}
                          <span>{lastRun.status}</span>
                          <span>·</span>
                          <span>{formatRelative(lastRun.createdAt)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Run pipeline"
                        onClick={() => triggerMutation.mutate({ pipelineId: p.id })}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit pipeline"
                        onClick={() => {
                          setEditPipeline(p);
                          setShowEditor(true);
                        }}
                      >
                        <Workflow className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        title="Delete pipeline"
                        onClick={() => setDeleteTarget(p)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {recentRuns.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Recent Runs</h3>
              <div className="rounded-lg border border-border bg-surface overflow-hidden">
                <div className="divide-y divide-border">
                  {recentRuns.map((run) => (
                    <Link
                      key={run.id}
                      to={`/${org}/${teamSlug}/repos/${repoSlug}/runs/${run.id}`}
                      className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
                    >
                      {STATUS_ICON[run.status]}
                      <span className="text-sm flex-1">{run.pipeline?.name}</span>
                      <span className="text-xs text-text-tertiary font-mono">{run.triggerRef}</span>
                      {run.commitSha && (
                        <Link
                          to={`/${org}/${teamSlug}/repos/${repoSlug}/commits/${run.commitSha}`}
                          className="hover:text-primary transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <code className="text-xs text-text-tertiary hover:text-primary">
                            {run.commitSha.slice(0, 7)}
                          </code>
                        </Link>
                      )}
                      <span className="text-xs text-text-tertiary">
                        {formatRelative(run.createdAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showEditor && (
        <PipelineEditorModal
          repoId={repoId}
          pipeline={editPipeline}
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['pipelines', repoId] });
            setShowEditor(false);
          }}
        />
      )}

      {/* Delete confirmation modal */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title="Delete Pipeline"
        description={`Are you sure you want to delete pipeline "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
