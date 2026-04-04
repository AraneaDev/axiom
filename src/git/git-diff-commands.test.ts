import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { diff, diffCommit, diffStat, mergeBase, canMerge, squashMerge } from './git-diff-commands';

const execFileAsync = promisify(execFile);

const TEST_BASE = '/tmp/axiom-diff-test';
const WORK_REPO = path.join(TEST_BASE, 'work-repo');

async function initWorkRepo() {
  await fs.mkdir(WORK_REPO, { recursive: true });
  await execFileAsync('git', ['-C', WORK_REPO, 'init', '-b', 'main']);
  await execFileAsync('git', ['-C', WORK_REPO, 'config', 'user.name', 'Test User']);
  await execFileAsync('git', ['-C', WORK_REPO, 'config', 'user.email', 'test@axiom.dev']);

  // Initial commit on main
  await fs.writeFile(path.join(WORK_REPO, 'README.md'), '# Test\nHello world\n');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', ['-C', WORK_REPO, 'commit', '-m', 'Initial commit']);

  // Second commit on main
  await fs.writeFile(path.join(WORK_REPO, 'main-file.ts'), 'export const x = 1;\n');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', ['-C', WORK_REPO, 'commit', '-m', 'Add main-file']);

  // Feature branch with extra file
  await execFileAsync('git', ['-C', WORK_REPO, 'checkout', '-b', 'feature/add-utils']);
  await fs.writeFile(
    path.join(WORK_REPO, 'utils.ts'),
    'export const add = (a: number, b: number) => a + b;\n',
  );
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', ['-C', WORK_REPO, 'commit', '-m', 'Add utils']);

  // Switch back to main
  await execFileAsync('git', ['-C', WORK_REPO, 'checkout', 'main']);
}

describe('git-diff-commands', () => {
  beforeAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
    await initWorkRepo();
  });

  afterAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
  });

  // ─── diff ──────────────────────────────────────────────────

  describe('diff', () => {
    it('shows changes between main and feature branch', async () => {
      const output = await diff(WORK_REPO, 'main', 'feature/add-utils');
      expect(output).toContain('utils.ts');
      expect(output).toContain('+export const add');
    });

    it('returns empty string when branches are identical', async () => {
      const output = await diff(WORK_REPO, 'main', 'main');
      expect(output.trim()).toBe('');
    });

    it('rejects invalid base ref', async () => {
      await expect(diff(WORK_REPO, 'bad ref!', 'main')).rejects.toThrow('Invalid ref');
    });

    it('rejects invalid head ref', async () => {
      await expect(diff(WORK_REPO, 'main', 'bad ref!')).rejects.toThrow('Invalid ref');
    });

    it('rejects empty ref', async () => {
      await expect(diff(WORK_REPO, '', 'main')).rejects.toThrow('Invalid ref');
    });
  });

  // ─── diffCommit ────────────────────────────────────────────

  describe('diffCommit', () => {
    it('shows files changed in a specific commit', async () => {
      // Get the SHA of the "Add utils" commit on the feature branch
      const { stdout } = await execFileAsync('git', [
        '-C',
        WORK_REPO,
        'rev-parse',
        'feature/add-utils',
      ]);
      const sha = stdout.trim();
      const output = await diffCommit(WORK_REPO, sha);
      expect(output).toContain('utils.ts');
      expect(output).toContain('+export const add');
    });

    it('shows initial commit contents', async () => {
      const { stdout } = await execFileAsync('git', [
        '-C',
        WORK_REPO,
        'rev-list',
        '--max-parents=0',
        'main',
      ]);
      const sha = stdout.trim();
      const output = await diffCommit(WORK_REPO, sha);
      expect(output).toContain('README.md');
      expect(output).toContain('+# Test');
    });

    it('rejects invalid SHA characters', async () => {
      await expect(diffCommit(WORK_REPO, 'not-a-sha!!!')).rejects.toThrow('Invalid ref');
    });

    it('rejects empty SHA', async () => {
      await expect(diffCommit(WORK_REPO, '')).rejects.toThrow('Invalid ref');
    });
  });

  // ─── diffStat ──────────────────────────────────────────────

  describe('diffStat', () => {
    it('returns array of file stats between branches', async () => {
      const stats = await diffStat(WORK_REPO, 'main', 'feature/add-utils');
      expect(Array.isArray(stats)).toBe(true);
      expect(stats.length).toBeGreaterThanOrEqual(1);
      const utilsStat = stats.find((s) => s.file.includes('utils.ts'));
      expect(utilsStat).toBeDefined();
      expect(utilsStat!.additions).toBeGreaterThan(0);
      expect(utilsStat!.deletions).toBe(0);
    });

    it('returns empty array when no changes', async () => {
      const stats = await diffStat(WORK_REPO, 'main', 'main');
      expect(stats).toEqual([]);
    });

    it('stat entries have required shape', async () => {
      const stats = await diffStat(WORK_REPO, 'main', 'feature/add-utils');
      for (const entry of stats) {
        expect(typeof entry.file).toBe('string');
        expect(typeof entry.additions).toBe('number');
        expect(typeof entry.deletions).toBe('number');
      }
    });

    it('rejects invalid base ref', async () => {
      await expect(diffStat(WORK_REPO, 'bad ref!', 'main')).rejects.toThrow('Invalid ref');
    });

    it('rejects invalid head ref', async () => {
      await expect(diffStat(WORK_REPO, 'main', 'bad ref!')).rejects.toThrow('Invalid ref');
    });
  });

  // ─── mergeBase ─────────────────────────────────────────────

  describe('mergeBase', () => {
    it('returns the common ancestor SHA', async () => {
      const base = await mergeBase(WORK_REPO, 'main', 'feature/add-utils');
      expect(base).toMatch(/^[a-f0-9]{40}$/);
    });

    it('merge base of a branch with itself is its own tip', async () => {
      const tip = await execFileAsync('git', ['-C', WORK_REPO, 'rev-parse', 'main']);
      const base = await mergeBase(WORK_REPO, 'main', 'main');
      expect(base).toBe(tip.stdout.trim());
    });

    it('rejects invalid ref', async () => {
      await expect(mergeBase(WORK_REPO, 'bad ref!', 'main')).rejects.toThrow('Invalid ref');
    });
  });

  // ─── canMerge ──────────────────────────────────────────────

  describe('canMerge', () => {
    it('returns true for clean merge', async () => {
      const result = await canMerge(WORK_REPO, 'feature/add-utils', 'main');
      expect(result).toBe(true);
    });

    it('returns false for invalid refs (swallows error)', async () => {
      const result = await canMerge(WORK_REPO, '..bad', 'main');
      expect(result).toBe(false);
    });
  });

  // ─── squashMerge ───────────────────────────────────────────

  describe('squashMerge', () => {
    it('squash-merges feature branch into a worktree clone', async () => {
      // Create a fresh clone directory to act as the worktree
      const squashDir = path.join(TEST_BASE, 'squash-work');
      await execFileAsync('git', ['clone', WORK_REPO, squashDir]);
      await execFileAsync('git', ['-C', squashDir, 'config', 'user.name', 'Test User']);
      await execFileAsync('git', ['-C', squashDir, 'config', 'user.email', 'test@axiom.dev']);

      // Get the tip of the feature branch
      const { stdout } = await execFileAsync('git', [
        '-C',
        squashDir,
        'rev-parse',
        'origin/feature/add-utils',
      ]);
      const sourceSha = stdout.trim();

      // Perform squash merge on main
      await squashMerge(squashDir, sourceSha, 'Squash: add utils');

      // Verify the squashed commit landed
      const { stdout: logOut } = await execFileAsync('git', [
        '-C',
        squashDir,
        'log',
        '--oneline',
        '-1',
      ]);
      expect(logOut).toContain('Squash: add utils');

      // Verify the file is present
      const content = await fs.readFile(path.join(squashDir, 'utils.ts'), 'utf8');
      expect(content).toContain('export const add');

      await fs.rm(squashDir, { recursive: true, force: true });
    });
  });
});
