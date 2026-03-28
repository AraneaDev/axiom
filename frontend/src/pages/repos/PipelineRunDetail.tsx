import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  X,
  Play,
  Terminal,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router';

import { pipelinesApi, type RunStatus, type PipelineJob } from '@/api/pipelines.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { usePipelineLogs } from '@/hooks/usePipelineLogs';
import { cn, formatRelative } from '@/lib/utils';

const STATUS_ICON: Record<RunStatus, React.ReactNode> = {
  SUCCESS: <CheckCircle2 className="h-4 w-4 text-success" />,
  FAILURE: <XCircle className="h-4 w-4 text-danger" />,
  RUNNING: <RefreshCw className="h-4 w-4 text-warning animate-spin" />,
  PENDING: <Clock className="h-4 w-4 text-text-tertiary" />,
  CANCELLED: <X className="h-4 w-4 text-text-tertiary" />,
  SKIPPED: <Clock className="h-4 w-4 text-text-tertiary" />,
};

const STATUS_BADGE: Record<RunStatus, string> = {
  SUCCESS: 'bg-success/10 text-success border-success/20',
  FAILURE: 'bg-danger/10 text-danger border-danger/20',
  RUNNING: 'bg-warning/10 text-warning border-warning/20',
  PENDING: 'bg-surface-tertiary text-text-secondary border-border',
  CANCELLED: 'bg-surface-tertiary text-text-secondary border-border',
  SKIPPED: 'bg-surface-tertiary text-text-secondary border-border',
};

function duration(start?: string, end?: string): string {
  if (!start) return '';
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

interface LogViewerProps {
  output: string;
  autoScroll?: boolean;
}

function LogViewer({ output, autoScroll = false }: LogViewerProps) {
  const containerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  if (!output) return null;

  return (
    <pre
      ref={containerRef}
      className="bg-surface-tertiary text-text text-xs p-4 overflow-x-auto max-h-96 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap border-t border-border"
    >
      {output}
    </pre>
  );
}

interface JobCardProps {
  job: PipelineJob;
  isLive: boolean;
}

function JobCard({ job, isLive }: JobCardProps) {
  const [expanded, setExpanded] = useState(job.status === 'FAILURE' || job.status === 'RUNNING');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <Card className="overflow-hidden">
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="w-full justify-start rounded-none p-3"
      >
        {STATUS_ICON[job.status]}
        <span className="font-medium text-sm flex-1 text-left">{job.name}</span>
        <span className="text-xs text-text-tertiary">
          {duration(job.startedAt, job.finishedAt)}
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
        )}
      </Button>
      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {job.steps.map((step) => (
            <div key={step.id}>
              <Button
                variant="ghost"
                onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                className="w-full justify-start rounded-none px-4 py-2"
              >
                {STATUS_ICON[step.status]}
                <span className="text-sm flex-1 text-left">{step.name}</span>
                <code className="text-xs text-text-tertiary mr-2">
                  {step.command.slice(0, 40)}
                  {step.command.length > 40 ? '...' : ''}
                </code>
                {step.exitCode != null && step.exitCode !== 0 && (
                  <Badge variant="danger" className="mr-2 text-[10px]">
                    exit {step.exitCode}
                  </Badge>
                )}
                <span className="text-xs text-text-tertiary">
                  {duration(step.startedAt, step.finishedAt)}
                </span>
                {step.output &&
                  (expandedStep === step.id ? (
                    <ChevronDown className="h-3 w-3 text-text-tertiary" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-text-tertiary" />
                  ))}
              </Button>
              {expandedStep === step.id && (
                <LogViewer output={step.output} autoScroll={isLive && step.status === 'RUNNING'} />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 *
 */
export default function PipelineRunDetail() {
  const {
    org,
    team: teamSlug,
    repo: repoSlug,
    runId,
  } = useParams<{ org: string; team: string; repo: string; runId: string }>();

  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  const { data: run, isLoading } = useQuery({
    queryKey: ['pipeline-run', runId],
    queryFn: () => pipelinesApi.getRun('', runId!),
    enabled: !!runId,
    staleTime: 10_000,
  });

  const isTerminal = ['SUCCESS', 'FAILURE', 'CANCELLED'].includes(run?.status ?? '');
  const { jobs: liveJobs } = usePipelineLogs(run?.repoId ?? '', runId ?? null, isTerminal);

  const displayJobs = liveJobs.length > 0 ? liveJobs : (run?.jobs ?? []);

  const rerunMutation = useMutation({
    mutationFn: () => {
      if (!run) throw new Error('No run data');
      return pipelinesApi.triggerRun(run.repoId, run.pipelineId, run.triggerRef);
    },
    onSuccess: (newRun) => {
      toastSuccess('Pipeline re-run triggered');
      queryClient.invalidateQueries({ queryKey: ['pipeline-run'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      // Navigate to the new run (update URL without full page reload)
      window.history.pushState({}, '', `/${org}/${teamSlug}/repos/${repoSlug}/runs/${newRun.id}`);
      window.location.reload();
    },
    onError: () => {
      toastError('Failed to trigger re-run');
    },
  });

  if (isLoading) return <PageLoader />;
  if (!run) return <div className="p-8 text-center text-text-secondary">Run not found</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/${org}/${teamSlug}/repos/${repoSlug}`}
          className="text-text-tertiary hover:text-text transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {STATUS_ICON[run.status]}
            <h1 className="text-xl font-bold">{run.pipeline?.name ?? 'Pipeline Run'}</h1>
            <span
              className={cn('text-xs px-2 py-0.5 rounded-full border', STATUS_BADGE[run.status])}
            >
              {run.status}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-tertiary mt-0.5">
            <span>{run.triggerType}</span>
            <span className="font-mono">{run.triggerRef}</span>
            {run.commitSha && <code>{run.commitSha.slice(0, 7)}</code>}
            <span>{formatRelative(run.createdAt)}</span>
            {run.startedAt && <span>Duration: {duration(run.startedAt, run.finishedAt)}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {isTerminal && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => rerunMutation.mutate()}
              disabled={rerunMutation.isPending}
            >
              <RefreshCw className={cn('h-4 w-4', rerunMutation.isPending && 'animate-spin')} />
              Re-run
            </Button>
          )}
          {!isTerminal && (
            <div className="flex items-center gap-1.5 text-xs text-warning">
              <Terminal className="h-4 w-4" />
              <span>Running</span>
            </div>
          )}
        </div>
      </div>

      {/* Job summary bar */}
      {displayJobs.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {displayJobs.map((job) => (
            <div
              key={job.id}
              className={cn(
                'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
                STATUS_BADGE[job.status],
              )}
            >
              {STATUS_ICON[job.status]}
              <span>{job.name}</span>
              {job.startedAt && (
                <span className="opacity-70">{duration(job.startedAt, job.finishedAt)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {displayJobs.map((job) => (
          <JobCard key={job.id} job={job} isLive={!isTerminal} />
        ))}
        {!displayJobs.length && (
          <div className="flex flex-col items-center justify-center py-12 text-text-tertiary text-sm gap-2">
            <Play className="h-8 w-8 opacity-30" />
            {run.status === 'PENDING' ? 'Waiting for runner...' : 'No jobs recorded.'}
          </div>
        )}
      </div>
    </div>
  );
}
