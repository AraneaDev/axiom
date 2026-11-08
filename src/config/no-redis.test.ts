import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '../..');
// tsx as a loader of this one process, so the timeout's kill ends it whole
const LOADERS = ['--import', 'tsx', '--import', './src/config/no-redis.ts'];

/**
 * Starts an entry point the way a one-shot script would leave the process: with no-redis.ts
 * loaded first. The switch is not passed in: only the module sets it.
 * @param entry The entry point, relative to the repository root
 */
function startWithNoRedis(entry: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '3998' };
  delete env.AXIOM_NO_REDIS;
  return spawnSync(process.execPath, [...LOADERS, entry], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    // A process that does start keeps running: the timeout ends it, and the test fails
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });
}

describe('no-redis.ts', { timeout: 60_000 }, () => {
  it('sets the switch for the process that loads it', () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.AXIOM_NO_REDIS;
    const run = spawnSync(
      process.execPath,
      [...LOADERS, '-e', 'console.log(process.env.AXIOM_NO_REDIS)'],
      { cwd: ROOT, env, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' },
    );
    expect(run.stdout.trim()).toBe('1');
  });

  it('makes the API refuse to start', () => {
    const run = startWithNoRedis('src/index.ts');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('AXIOM_NO_REDIS=1 is for one-shot scripts such as migrate');
  });

  it('makes the worker refuse to start', () => {
    const run = startWithNoRedis('src/worker.ts');
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain(
      'AXIOM_NO_REDIS=1 is for one-shot scripts such as migrate',
    );
  });
});
