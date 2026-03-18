/**
 * Pipeline YAML parser and validator.
 *
 * Parses pipeline configuration YAML into a structured format
 * for the execution engine.
 */

import yaml from 'js-yaml';

export interface Step {
  name: string;
  run: string;
  env?: Record<string, string>;
}

export interface Job {
  name: string;
  image: string;
  steps: Step[];
  dependsOn?: string[];
  env?: Record<string, string>;
}

export interface PipelineConfig {
  name: string;
  trigger?: { branches?: string[]; events?: string[] };
  jobs: Job[];
}

/**
 * Parse a pipeline YAML string into a structured PipelineConfig.
 * @param content - Raw YAML content
 */
export function parsePipelineConfig(content: string): PipelineConfig {
  const raw = yaml.load(content) as Record<string, unknown>;

  if (!raw || typeof raw !== 'object') {
    throw new PipelineParseError('Invalid YAML: expected an object');
  }

  const name = typeof raw.name === 'string' ? raw.name : 'Pipeline';

  // Parse triggers
  const trigger = parseTrigger(raw);

  // Parse jobs
  const jobsRaw = raw.jobs as Record<string, unknown> | unknown[] | undefined;
  if (!jobsRaw) {
    throw new PipelineParseError('Pipeline must define "jobs"');
  }

  const jobs = parseJobs(jobsRaw);

  const config: PipelineConfig = { name, jobs };
  if (trigger) {
    config.trigger = trigger;
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new PipelineParseError(`Invalid pipeline configuration: ${errors.join('; ')}`);
  }

  return config;
}

/**
 * Parse trigger configuration from raw YAML object.
 * @param raw
 */
function parseTrigger(
  raw: Record<string, unknown>,
): { branches?: string[]; events?: string[] } | undefined {
  const onRaw = raw['on'] ?? raw['trigger'];
  if (!onRaw) return undefined;

  if (typeof onRaw === 'string') {
    return { events: [onRaw] };
  }

  if (Array.isArray(onRaw)) {
    return { events: onRaw.filter((e) => typeof e === 'string') };
  }

  if (typeof onRaw === 'object' && onRaw !== null) {
    const trigger: { branches?: string[]; events?: string[] } = {};
    const obj = onRaw as Record<string, unknown>;

    // Collect event types
    const events: string[] = [];
    if (obj.push) {
      events.push('push');
      const pushObj = typeof obj.push === 'object' ? (obj.push as Record<string, unknown>) : {};
      if (Array.isArray(pushObj.branches)) {
        trigger.branches = pushObj.branches.map(String);
      }
    }
    if (obj.pull_request) {
      events.push('pull_request');
      if (!trigger.branches) {
        const prObj =
          typeof obj.pull_request === 'object' ? (obj.pull_request as Record<string, unknown>) : {};
        if (Array.isArray(prObj.branches)) {
          trigger.branches = prObj.branches.map(String);
        }
      }
    }
    if (obj.branches && Array.isArray(obj.branches)) {
      trigger.branches = obj.branches.map(String);
    }
    if (obj.events && Array.isArray(obj.events)) {
      events.push(...obj.events.filter((e: unknown) => typeof e === 'string'));
    }

    if (events.length > 0) {
      trigger.events = events;
    }

    return Object.keys(trigger).length > 0 ? trigger : undefined;
  }

  return undefined;
}

/**
 * Parse jobs from raw YAML data (supports both object and array format).
 * @param jobsRaw
 */
function parseJobs(jobsRaw: Record<string, unknown> | unknown[]): Job[] {
  const entries: Array<[string, Record<string, unknown>]> = [];

  if (Array.isArray(jobsRaw)) {
    for (const [idx, item] of jobsRaw.entries()) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : `job-${idx + 1}`;
        entries.push([id, obj]);
      }
    }
  } else if (typeof jobsRaw === 'object') {
    for (const [id, val] of Object.entries(jobsRaw)) {
      if (typeof val === 'object' && val !== null) {
        entries.push([id, val as Record<string, unknown>]);
      }
    }
  }

  if (entries.length === 0) {
    throw new PipelineParseError('Pipeline must have at least one job');
  }

  return entries.map(([id, raw]) => parseJob(id, raw));
}

/**
 * Parse a single job definition.
 * @param id
 * @param raw
 */
function parseJob(id: string, raw: Record<string, unknown>): Job {
  const name = typeof raw.name === 'string' ? raw.name : id;
  const image = typeof raw.image === 'string' ? raw.image : 'node:20-alpine';

  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: Step[] = stepsRaw.map((s: Record<string, unknown>, idx: number) => ({
    name: typeof s.name === 'string' ? s.name : `Step ${idx + 1}`,
    run: typeof s.run === 'string' ? s.run : '',
    env:
      typeof s.env === 'object' && s.env !== null
        ? Object.fromEntries(
            Object.entries(s.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        : undefined,
  }));

  const dependsOn = Array.isArray(raw.needs)
    ? raw.needs.filter((d: unknown) => typeof d === 'string')
    : Array.isArray(raw.dependsOn)
      ? raw.dependsOn.filter((d: unknown) => typeof d === 'string')
      : undefined;

  const env =
    typeof raw.env === 'object' && raw.env !== null
      ? Object.fromEntries(
          Object.entries(raw.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : undefined;

  const job: Job = { name, image, steps };
  if (dependsOn && dependsOn.length > 0) job.dependsOn = dependsOn;
  if (env) job.env = env;

  return job;
}

/**
 * Validate a parsed PipelineConfig for structural correctness.
 * @param config
 */
export function validateConfig(config: PipelineConfig): string[] {
  const errors: string[] = [];

  if (!config.name || config.name.trim() === '') {
    errors.push('Pipeline name must not be empty');
  }

  if (!config.jobs || config.jobs.length === 0) {
    errors.push('Pipeline must have at least one job');
    return errors;
  }

  const jobNames = new Set<string>();
  for (const job of config.jobs) {
    if (jobNames.has(job.name)) {
      errors.push(`Duplicate job name: "${job.name}"`);
    }
    jobNames.add(job.name);

    if (!job.steps || job.steps.length === 0) {
      errors.push(`Job "${job.name}" must have at least one step`);
    }

    for (const [idx, step] of job.steps.entries()) {
      if (!step.run || step.run.trim() === '') {
        errors.push(`Job "${job.name}", step ${idx + 1} ("${step.name}"): "run" must not be empty`);
      }
    }

    if (job.dependsOn) {
      for (const dep of job.dependsOn) {
        if (!config.jobs.some((j) => j.name === dep)) {
          errors.push(`Job "${job.name}" depends on unknown job "${dep}"`);
        }
      }
    }
  }

  // Check for circular dependencies
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const depsMap = new Map<string, string[]>();
  for (const job of config.jobs) {
    depsMap.set(job.name, job.dependsOn ?? []);
  }

  function hasCycle(name: string): boolean {
    if (visiting.has(name)) return true;
    if (visited.has(name)) return false;
    visiting.add(name);
    for (const dep of depsMap.get(name) ?? []) {
      if (hasCycle(dep)) return true;
    }
    visiting.delete(name);
    visited.add(name);
    return false;
  }

  for (const job of config.jobs) {
    if (hasCycle(job.name)) {
      errors.push(`Circular dependency detected involving job "${job.name}"`);
      break;
    }
  }

  return errors;
}

/**
 * Check whether a pipeline trigger matches a given push event.
 * @param trigger - Pipeline trigger config
 * @param branch - Branch name being pushed to
 * @param event - Event type (e.g. "push", "pull_request")
 */
export function matchesTrigger(
  trigger: PipelineConfig['trigger'],
  branch: string,
  event: string = 'push',
): boolean {
  // No trigger defined means match everything
  if (!trigger) return true;

  // Check event match
  if (trigger.events && trigger.events.length > 0) {
    if (!trigger.events.includes(event) && !trigger.events.includes('*')) {
      return false;
    }
  }

  // Check branch match
  if (trigger.branches && trigger.branches.length > 0) {
    const matches = trigger.branches.some((pattern) => {
      if (pattern === '*') return true;
      if (pattern.endsWith('*')) {
        return branch.startsWith(pattern.slice(0, -1));
      }
      return branch === pattern;
    });
    if (!matches) return false;
  }

  return true;
}

/**
 * Custom error class for pipeline parsing failures.
 */
export class PipelineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineParseError';
  }
}
