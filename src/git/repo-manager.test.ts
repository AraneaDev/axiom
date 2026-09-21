import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import {
  initBareRepo,
  forkRepo,
  deleteRepo,
  getRepoSize,
  repoExists,
  getRepoPath,
} from './repo-manager';

const execFileAsync = promisify(execFile);

// Mock hook-handler to avoid pulling in DB/Redis dependencies
vi.mock('./hook-handler', () => ({
  generatePostReceiveHook: (repoId: string) => `#!/bin/sh\necho "hook for ${repoId}"\n`,
  HOOK_SECRET: 'test-secret',
  default: {},
}));

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'axiom-repo-manager-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper: absolute path inside our temp dir
function tmpPath(...parts: string[]): string {
  return path.join(tmpDir, ...parts);
}

// Helper: create a bare repo with at least one commit so forkRepo works
async function createBareRepoWithCommit(repoPath: string): Promise<void> {
  await initBareRepo(repoPath, 'main');

  // Clone into a work tree, commit, push back
  const workDir = `${repoPath}-work`;
  await execFileAsync('git', ['clone', repoPath, workDir]);
  await fs.writeFile(path.join(workDir, 'README.md'), '# test');
  await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', workDir, 'config', 'user.name', 'Test']);
  await execFileAsync('git', ['-C', workDir, 'add', '.']);
  await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'initial commit']);
  await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'main']);
  await fs.rm(workDir, { recursive: true, force: true });
}

describe('getRepoPath', () => {
  it('returns expected path under REPOS_BASE', () => {
    const result = getRepoPath('myorg', 'myteam', 'myrepo');
    expect(result).toMatch(/myorg[/\\]myteam[/\\]myrepo\.git$/);
  });
});

describe('initBareRepo', () => {
  it('creates a valid bare repo with HEAD and objects/ directory', async () => {
    const repoPath = tmpPath('init-test.git');
    await initBareRepo(repoPath);

    const headPath = path.join(repoPath, 'HEAD');
    const objectsPath = path.join(repoPath, 'objects');

    const headStat = await fs.stat(headPath);
    expect(headStat.isFile()).toBe(true);

    const headContent = await fs.readFile(headPath, 'utf8');
    expect(headContent.trim()).toBe('ref: refs/heads/main');

    const objectsStat = await fs.stat(objectsPath);
    expect(objectsStat.isDirectory()).toBe(true);
  });

  it('respects a custom default branch', async () => {
    const repoPath = tmpPath('init-branch-test.git');
    await initBareRepo(repoPath, 'develop');

    const headContent = await fs.readFile(path.join(repoPath, 'HEAD'), 'utf8');
    expect(headContent.trim()).toBe('ref: refs/heads/develop');
  });

  it('installs post-receive hook when repoId is provided', async () => {
    const repoPath = tmpPath('init-with-hook.git');
    await initBareRepo(repoPath, 'main', 'repo-abc-123');

    const hookPath = path.join(repoPath, 'hooks', 'post-receive');
    const hookStat = await fs.stat(hookPath);
    expect(hookStat.isFile()).toBe(true);

    // Verify executable bit is set
    const mode = hookStat.mode & 0o777;
    expect(mode & 0o100).toBeTruthy(); // owner execute bit

    const hookContent = await fs.readFile(hookPath, 'utf8');
    expect(hookContent).toContain('repo-abc-123');
    expect(hookContent.startsWith('#!/bin/sh')).toBe(true);
  });

  it('does not create a post-receive hook when repoId is omitted', async () => {
    const repoPath = tmpPath('init-no-hook.git');
    await initBareRepo(repoPath);

    const hookPath = path.join(repoPath, 'hooks', 'post-receive');
    await expect(fs.access(hookPath)).rejects.toThrow();
  });

  it('is idempotent when called twice on the same path', async () => {
    const repoPath = tmpPath('init-idempotent.git');
    await initBareRepo(repoPath);
    await expect(initBareRepo(repoPath)).resolves.toBeUndefined();
  });
});

describe('repoExists', () => {
  it('returns true for an existing bare repo', async () => {
    const repoPath = tmpPath('exists-true.git');
    await initBareRepo(repoPath);
    expect(await repoExists(repoPath)).toBe(true);
  });

  it('returns false for a non-existent path', async () => {
    expect(await repoExists(tmpPath('does-not-exist.git'))).toBe(false);
  });

  it('returns false for a directory that is not a git repo', async () => {
    const notARepo = tmpPath('not-a-repo');
    await fs.mkdir(notARepo, { recursive: true });
    expect(await repoExists(notARepo)).toBe(false);
  });
});

describe('deleteRepo', () => {
  it('removes the repository directory', async () => {
    const repoPath = tmpPath('delete-me.git');
    await initBareRepo(repoPath);
    expect(await repoExists(repoPath)).toBe(true);

    await deleteRepo(repoPath);

    await expect(fs.access(repoPath)).rejects.toThrow();
  });

  it('throws AppError when the path is not a git repository', async () => {
    const notARepo = tmpPath('delete-not-git');
    await fs.mkdir(notARepo, { recursive: true });

    await expect(deleteRepo(notARepo)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('Not a git repository'),
    });
  });

  it('throws AppError when the path does not exist', async () => {
    await expect(deleteRepo(tmpPath('nonexistent.git'))).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('forkRepo', () => {
  it('creates a valid bare clone of the source repo', async () => {
    const sourcePath = tmpPath('fork-source.git');
    await createBareRepoWithCommit(sourcePath);

    const forkPath = tmpPath('fork-target.git');
    await forkRepo(sourcePath, forkPath);

    // Fork must be a valid bare repo
    const headStat = await fs.stat(path.join(forkPath, 'HEAD'));
    expect(headStat.isFile()).toBe(true);

    const objectsStat = await fs.stat(path.join(forkPath, 'objects'));
    expect(objectsStat.isDirectory()).toBe(true);
  });

  it('fork contains the same commits as the source', async () => {
    const sourcePath = tmpPath('fork-commits-source.git');
    await createBareRepoWithCommit(sourcePath);

    const forkPath = tmpPath('fork-commits-target.git');
    await forkRepo(sourcePath, forkPath);

    const { stdout: sourceLog } = await execFileAsync('git', [
      '-C',
      sourcePath,
      'log',
      '--oneline',
    ]);
    const { stdout: forkLog } = await execFileAsync('git', ['-C', forkPath, 'log', '--oneline']);

    expect(forkLog.trim()).toBe(sourceLog.trim());
  });

  it('creates intermediate directories for the target path', async () => {
    const sourcePath = tmpPath('fork-deep-source.git');
    await createBareRepoWithCommit(sourcePath);

    const forkPath = tmpPath('nested', 'dirs', 'fork-target.git');
    await forkRepo(sourcePath, forkPath);

    expect(await repoExists(forkPath)).toBe(true);
  });
});

describe('getRepoSize', () => {
  it('returns a positive number for a non-empty bare repo', async () => {
    const repoPath = tmpPath('size-test.git');
    await createBareRepoWithCommit(repoPath);

    const size = await getRepoSize(repoPath);
    expect(typeof size).toBe('number');
    expect(size).toBeGreaterThan(0);
  });

  it('returns a positive number even for a freshly-initialised empty repo', async () => {
    const repoPath = tmpPath('size-empty.git');
    await initBareRepo(repoPath);

    const size = await getRepoSize(repoPath);
    expect(typeof size).toBe('number');
    expect(size).toBeGreaterThan(0);
  });
});
