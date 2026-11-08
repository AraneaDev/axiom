import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, PauseCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  githubImportApi,
  githubImportKey,
  type GithubImportRun,
  type GithubImportState,
} from '@/api/github.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Progress } from '@/components/ui/Progress';
import { Spinner } from '@/components/ui/Spinner';

const ACTIVE = ['QUEUED', 'RUNNING', 'PAUSED'];

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * How far a run is: done of total, clamped to 0..total (done can pass total and can drop at the
 * end), or just the count while the total is not known.
 * @param run - The run.
 */
function progressOf(run: GithubImportRun): { text: string; percent: number | null } {
  const failed = run.failed > 0 ? `, ${run.failed} failed` : '';
  if (run.total === null)
    return { text: `${Math.max(0, run.done)} imported${failed}`, percent: null };
  const done = Math.max(0, Math.min(run.done, run.total));
  return {
    text: `${done} of ${run.total} imported${failed}`,
    percent: run.total === 0 ? 100 : (done / run.total) * 100,
  };
}

function Note({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-2 text-xs text-text-secondary">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function RunView({ state }: { state: GithubImportState }) {
  const { run, liveCap } = state;
  const active = run && ACTIVE.includes(run.status);
  const progress = run ? progressOf(run) : null;
  return (
    <div className="flex flex-col gap-2">
      {run && progress && (
        <div className="flex flex-col gap-1.5">
          {progress.percent !== null && (
            <Progress
              value={progress.percent}
              variant={run.status === 'FAILED' ? 'danger' : 'primary'}
              aria-label="Import progress"
            />
          )}
          <p className="text-sm text-text">{progress.text}</p>
        </div>
      )}
      {run?.status === 'PAUSED' && (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <PauseCircle className="h-4 w-4 shrink-0" />
          {run.resumeAt ? `Paused, resumes at ${when(run.resumeAt)}` : 'Paused'}
        </p>
      )}
      {active && run?.linkCommentsWaitUntil && (
        <Note>{`Link comments wait until ${when(run.linkCommentsWaitUntil)}`}</Note>
      )}
      {state.enabled && liveCap?.paused && (
        <Note>
          {liveCap.resumesAt
            ? `Live import paused until ${when(liveCap.resumesAt)} (hourly limit)`
            : 'Live import paused (hourly limit)'}
        </Note>
      )}
    </div>
  );
}

/**
 * The GitHub Issues import of a project: the switch, the progress of the backfill, failures.
 * @param props - The section's inputs.
 * @param props.projectId - The project.
 */
export function GithubImportSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const status = useQuery({
    queryKey: githubImportKey(projectId),
    queryFn: () => githubImportApi.status(projectId),
  });
  const configure = useMutation({
    mutationFn: (enabled: boolean) => githubImportApi.configure(projectId, enabled),
    onSuccess: async (result, enabled) => {
      setNote(
        enabled && !result.queued
          ? 'Import was already on and the last import is done, so nothing new was queued.'
          : null,
      );
      await queryClient.invalidateQueries({ queryKey: githubImportKey(projectId) });
    },
    onSettled: () => setConfirming(false),
  });

  const state = status.data;
  const failed = state?.run?.status === 'FAILED';

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-sm font-semibold text-text">GitHub Issues import</h2>
        <p className="mt-1 text-xs text-text-tertiary">
          Open GitHub Issues of the linked repository become issues here, and new ones follow as
          they come.
        </p>
      </div>
      {status.isLoading && <Spinner size="sm" />}
      {status.error && <ErrorAlert error={status.error} fallback="Could not load the import" />}
      {state && (
        <>
          <Checkbox
            id="github-import-enabled"
            size="md"
            label="Import GitHub Issues"
            hint="Each imported issue gets one comment on GitHub with a link back to it."
            checked={state.enabled}
            disabled={configure.isPending}
            onChange={(e) => {
              if (e.target.checked) setConfirming(true);
              else configure.mutate(false);
            }}
          />
          <RunView state={state} />
          {failed && state.run && (
            <div className="flex flex-col items-start gap-3">
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {/* Plain text: the error can carry GitHub's words */}
                <p className="whitespace-pre-wrap break-words">
                  {state.run.error ?? 'The import failed'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                <RefreshCw className="h-4 w-4" />
                Switch import on again
              </Button>
            </div>
          )}
          {note && <Note>{note}</Note>}
        </>
      )}
      {configure.isError && (
        <ErrorAlert error={configure.error} fallback="Could not change the import" />
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => configure.mutate(true)}
        loading={configure.isPending}
        variant="warning"
        title="Import GitHub Issues?"
        description="Every open GitHub Issue of the repository is imported, and Axiom writes one comment on each of them on GitHub with a link to its issue. New GitHub Issues are imported as they come."
        confirmLabel="Switch on"
      />
    </Card>
  );
}
