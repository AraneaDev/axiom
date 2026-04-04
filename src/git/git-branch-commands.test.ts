import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { listBranches, createBranch, deleteBranch, branchExists } from './git-branch-commands';
import { resolveRef } from './git-log-commands';
import { initBareRepo } from './repo-manager';

const execFileAsync = promisify(execFile);

const TEST_BASE = '/tmp/axiom-branch-test';
const BARE_REPO = path.join(TEST_BASE, 'branch-test.git');
const WORK_REPO = path.join(TEST_BASE, 'branch-work');

async function seedRepo() {
  await execFileAsync('git', ['clone', BARE_REPO, WORK_REPO]);
  await fs.writeFile(path.join(WORK_REPO, 'README.md'), '# Branch Test');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', [
    '-C',
    WORK_REPO,
    'commit',
    '-m',
    'Initial commit',
    '--author',
    'Test User <test@axiom.dev>',
  ]);
  await execFileAsync('git', ['-C', WORK_REPO, 'push', 'origin', 'main']);

  // Push a second branch
  await execFileAsync('git', ['-C', WORK_REPO, 'checkout', '-b', 'develop']);
  await fs.writeFile(path.join(WORK_REPO, 'dev.txt'), 'dev');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', [
    '-C',
    WORK_REPO,
    'commit',
    '-m',
    'Dev commit',
    '--author',
    'Test User <test@axiom.dev>',
  ]);
  await execFileAsync('git', ['-C', WORK_REPO, 'push', 'origin', 'develop']);
}

describe('git-branch-commands', () => {
  beforeAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
    await fs.mkdir(TEST_BASE, { recursive: true });
    await initBareRepo(BARE_REPO, 'main');
    await seedRepo();
  });

  afterAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
  });

  describe('listBranches()', () => {
    it('returns all branches', async () => {
      const branches = await listBranches(BARE_REPO, 'main');
      const names = branches.map((b) => b.name);
      expect(names).toContain('main');
      expect(names).toContain('develop');
    });

    it('each branch has a name and sha', async () => {
      const branches = await listBranches(BARE_REPO, 'main');
      for (const b of branches) {
        expect(b.name).toBeTruthy();
        expect(b.sha).toMatch(/^[a-f0-9]+$/);
      }
    });

    it('marks the default branch correctly', async () => {
      const branches = await listBranches(BARE_REPO, 'main');
      const main = branches.find((b) => b.name === 'main');
      const develop = branches.find((b) => b.name === 'develop');
      expect(main?.isDefault).toBe(true);
      expect(develop?.isDefault).toBe(false);
    });

    it('marks a different branch as default when specified', async () => {
      const branches = await listBranches(BARE_REPO, 'develop');
      const develop = branches.find((b) => b.name === 'develop');
      const main = branches.find((b) => b.name === 'main');
      expect(develop?.isDefault).toBe(true);
      expect(main?.isDefault).toBe(false);
    });

    it('returns empty array for repo with no branches', async () => {
      const emptyRepo = path.join(TEST_BASE, 'empty.git');
      await initBareRepo(emptyRepo, 'main');
      const branches = await listBranches(emptyRepo, 'main');
      expect(branches).toEqual([]);
    });
  });

  describe('branchExists()', () => {
    it('returns true for existing branch', async () => {
      expect(await branchExists(BARE_REPO, 'main')).toBe(true);
      expect(await branchExists(BARE_REPO, 'develop')).toBe(true);
    });

    it('returns false for non-existent branch', async () => {
      expect(await branchExists(BARE_REPO, 'nonexistent')).toBe(false);
      expect(await branchExists(BARE_REPO, 'feature/missing')).toBe(false);
    });
  });

  describe('createBranch()', () => {
    it('creates a branch from a SHA', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createBranch(BARE_REPO, 'from-sha', sha);
      expect(await branchExists(BARE_REPO, 'from-sha')).toBe(true);
      // cleanup
      await deleteBranch(BARE_REPO, 'from-sha');
    });

    it('creates a branch from a branch name', async () => {
      await createBranch(BARE_REPO, 'from-main', 'main');
      expect(await branchExists(BARE_REPO, 'from-main')).toBe(true);
      // cleanup
      await deleteBranch(BARE_REPO, 'from-main');
    });

    it('throws when start point does not exist', async () => {
      await expect(createBranch(BARE_REPO, 'bad-branch', 'deadbeef')).rejects.toThrow();
    });
  });

  describe('deleteBranch()', () => {
    it('removes an existing branch', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createBranch(BARE_REPO, 'to-delete', sha);
      expect(await branchExists(BARE_REPO, 'to-delete')).toBe(true);
      await deleteBranch(BARE_REPO, 'to-delete');
      expect(await branchExists(BARE_REPO, 'to-delete')).toBe(false);
    });

    it('throws when deleting a non-existent branch', async () => {
      await expect(deleteBranch(BARE_REPO, 'ghost-branch')).rejects.toThrow();
    });
  });
});
