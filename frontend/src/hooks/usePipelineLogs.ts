import { useEffect, useRef, useState } from 'react';
import type { PipelineJob } from '@/api/pipelines.api';

export function usePipelineLogs(repoId: string, runId: string | null, isTerminal: boolean) {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [done, setDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId || isTerminal) return;

    const es = new EventSource(`/api/repos/${repoId}/runs/${runId}/logs`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jobs) setJobs(data.jobs);
      } catch {}
    };

    es.addEventListener('done', () => {
      setDone(true);
      es.close();
    });

    es.onerror = () => {
      setDone(true);
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [repoId, runId, isTerminal]);

  return { jobs, done };
}
