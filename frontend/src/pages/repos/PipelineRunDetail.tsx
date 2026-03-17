import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router';
import { CheckCircle2, XCircle, RefreshCw, Clock, ChevronDown, ChevronRight, ArrowLeft, X } from 'lucide-react';
import { pipelinesApi, type RunStatus, type PipelineJob } from '@/api/pipelines.api';
import { usePipelineLogs } from '@/hooks/usePipelineLogs';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
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

interface JobCardProps {
  job: PipelineJob;
}

function JobCard({ job }: JobCardProps) {
  const [expanded, setExpanded] = useState(job.status === 'FAILURE' || job.status === 'RUNNING');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors text-left"
      >
        {STATUS_ICON[job.status]}
        <span className="font-medium text-sm flex-1">{job.name}</span>
        <span className="text-xs text-text-tertiary">{duration(job.startedAt, job.finishedAt)}</span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" /> : <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />}
      </button>
      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {job.steps.map(step => (
            <div key={step.id}>
              <button
                onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary transition-colors text-left"
              >
                {STATUS_ICON[step.status]}
                <span className="text-sm flex-1">{step.name}</span>
                <code className="text-xs text-text-tertiary mr-2">{step.command.slice(0, 40)}{step.command.length > 40 ? '...' : ''}</code>
                <span className="text-xs text-text-tertiary">{duration(step.startedAt, step.finishedAt)}</span>
                {step.output && (expandedStep === step.id ? <ChevronDown className="h-3 w-3 text-text-tertiary" /> : <ChevronRight className="h-3 w-3 text-text-tertiary" />)}
              </button>
              {expandedStep === step.id && step.output && (
                <pre className="bg-[#0d1117] text-[#e6edf3] text-xs p-4 overflow-x-auto max-h-80 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">
                  {step.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PipelineRunDetail() {
  const { org, team: teamSlug, repo: repoSlug, runId } = useParams<{ org: string; team: string; repo: string; runId: string }>();

  const { data: run, isLoading } = useQuery({
    queryKey: ['pipeline-run', runId],
    queryFn: () => pipelinesApi.getRun('', runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 3000;
      const terminal = ['SUCCESS', 'FAILURE', 'CANCELLED'];
      return terminal.includes(data.status) ? false : 2000;
    },
  });

  const isTerminal = ['SUCCESS', 'FAILURE', 'CANCELLED'].includes(run?.status ?? '');
  const { jobs: liveJobs } = usePipelineLogs(run?.repoId ?? '', runId ?? null, isTerminal);

  const displayJobs = liveJobs.length > 0 ? liveJobs : (run?.jobs ?? []);

  if (isLoading) return <PageLoader />;
  if (!run) return <div className="p-8 text-center text-text-secondary">Run not found</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/${org}/${teamSlug}/repos/${repoSlug}`} className="text-text-tertiary hover:text-text transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {STATUS_ICON[run.status]}
            <h1 className="text-xl font-bold">{run.pipeline?.name ?? 'Pipeline Run'}</h1>
            <span className={cn('text-xs px-2 py-0.5 rounded-full border', STATUS_BADGE[run.status])}>{run.status}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-tertiary mt-0.5">
            <span>{run.triggerType}</span>
            <span className="font-mono">{run.triggerRef}</span>
            {run.commitSha && <code>{run.commitSha.slice(0, 7)}</code>}
            <span>{formatRelative(run.createdAt)}</span>
            {run.startedAt && <span>Duration: {duration(run.startedAt, run.finishedAt)}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {displayJobs.map(job => <JobCard key={job.id} job={job} />)}
        {!displayJobs.length && (
          <div className="text-center py-8 text-text-tertiary text-sm">
            {run.status === 'PENDING' ? 'Waiting for runner...' : 'No jobs recorded.'}
          </div>
        )}
      </div>
    </div>
  );
}
