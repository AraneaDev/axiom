import yaml from 'js-yaml';

import { AppError } from '../../middleware/errorHandler';

export interface ParsedStep {
  name: string;
  run: string;
  env?: Record<string, string>;
}

export interface ParsedJob {
  name?: string;
  needs?: string[];
  steps: ParsedStep[];
}

export interface ParsedTriggers {
  push?: { branches: string[] };
  pull_request?: { branches: string[] };
}

export interface ParsedPipeline {
  name: string;
  on: ParsedTriggers;
  jobs: Record<string, ParsedJob>;
}

/**
 *
 * @param content
 */
export function parsePipelineYaml(content: string): ParsedPipeline {
  const raw = yaml.load(content) as Record<string, unknown>;

  if (!raw || typeof raw !== 'object') {
    throw new AppError(400, 'Invalid YAML: expected an object');
  }

  const name = typeof raw.name === 'string' ? raw.name : 'Pipeline';

  // Parse 'on' triggers
  const onRaw = raw['on'] as Record<string, unknown> | undefined;
  const triggers: ParsedTriggers = {};
  if (onRaw?.push) {
    const pushRaw = onRaw.push as Record<string, unknown>;
    triggers.push = { branches: Array.isArray(pushRaw.branches) ? pushRaw.branches : ['*'] };
  }
  if (onRaw?.pull_request) {
    const prRaw = onRaw.pull_request as Record<string, unknown>;
    triggers.pull_request = { branches: Array.isArray(prRaw.branches) ? prRaw.branches : ['*'] };
  }

  // Parse jobs
  const jobsRaw = raw.jobs as Record<string, unknown> | undefined;
  if (!jobsRaw || typeof jobsRaw !== 'object') {
    throw new AppError(400, 'Invalid pipeline: missing "jobs"');
  }

  const jobs: Record<string, ParsedJob> = {};
  for (const [jobId, jobRaw] of Object.entries(jobsRaw)) {
    const job = jobRaw as Record<string, unknown>;
    const stepsRaw = Array.isArray(job.steps) ? job.steps : [];
    const steps: ParsedStep[] = stepsRaw.map((s: Record<string, unknown>, idx: number) => ({
      name: typeof s.name === 'string' ? s.name : `Step ${idx + 1}`,
      run: typeof s.run === 'string' ? s.run : '',
      env:
        typeof s.env === 'object' && s.env !== null
          ? Object.fromEntries(
              Object.entries(s.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
    }));
    jobs[jobId] = {
      name: typeof job.name === 'string' ? job.name : jobId,
      needs: Array.isArray(job.needs) ? job.needs : undefined,
      steps,
    };
  }

  return { name, on: triggers, jobs };
}

/**
 *
 * @param parsed
 */
export function validatePipeline(parsed: ParsedPipeline): string[] {
  const errors: string[] = [];
  const jobIds = Object.keys(parsed.jobs);

  if (jobIds.length === 0) {
    errors.push('Pipeline must have at least one job');
    return errors;
  }

  for (const [jobId, job] of Object.entries(parsed.jobs)) {
    if (!job.steps || job.steps.length === 0) {
      errors.push(`Job "${jobId}" must have at least one step`);
    }
    for (const [idx, step] of job.steps.entries()) {
      if (!step.run || step.run.trim() === '') {
        errors.push(`Job "${jobId}", step ${idx + 1} ("${step.name}"): "run" must not be empty`);
      }
    }
    if (job.needs) {
      for (const dep of job.needs) {
        if (!jobIds.includes(dep)) {
          errors.push(`Job "${jobId}" depends on unknown job "${dep}"`);
        }
      }
    }
  }

  // Check for circular dependencies via topological sort
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function hasCycle(jobId: string): boolean {
    if (visiting.has(jobId)) return true;
    if (visited.has(jobId)) return false;
    visiting.add(jobId);
    for (const dep of parsed.jobs[jobId]?.needs ?? []) {
      if (hasCycle(dep)) return true;
    }
    visiting.delete(jobId);
    visited.add(jobId);
    return false;
  }

  for (const jobId of jobIds) {
    if (hasCycle(jobId)) {
      errors.push(`Circular dependency detected involving job "${jobId}"`);
      break;
    }
  }

  return errors;
}

/**
 *
 * @param jobs
 */
export function getTopologicalOrder(jobs: Record<string, ParsedJob>): string[][] {
  // Returns jobs grouped by execution wave (parallel within each wave)
  const inDegree: Record<string, number> = {};
  const dependents: Record<string, string[]> = {};

  for (const jobId of Object.keys(jobs)) {
    inDegree[jobId] = 0;
    dependents[jobId] = [];
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    for (const dep of job.needs ?? []) {
      inDegree[jobId]++;
      dependents[dep].push(jobId);
    }
  }

  const waves: string[][] = [];
  let queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);

  while (queue.length > 0) {
    waves.push([...queue]);
    const next: string[] = [];
    for (const jobId of queue) {
      for (const dep of dependents[jobId]) {
        inDegree[dep]--;
        if (inDegree[dep] === 0) next.push(dep);
      }
    }
    queue = next;
  }

  return waves;
}
