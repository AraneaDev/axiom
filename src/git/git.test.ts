import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  initBareRepo, deleteRepo, forkRepo, repoExists, getRepoSize,
} from './repo-manager';
import * as gitCmd from './git-commands';

const execFileAsync = promisify(execFile);

const TEST_BASE = '/tmp/axiom-git-test';
const BARE_REPO = path.join(TEST_BASE, 'test-repo.git');
const WORK_REPO = path.join(TEST_BASE, 'test-work');

// Helper: create a working clone, add a file, commit, push
async function seedRepo() {
  await execFileAsync('git', ['clone', BARE_REPO, WORK_REPO]);
  // Create initial commit
  await fs.writeFile(path.join(WORK_REPO, 'README.md'), '# Test Repo\nHello world');
  await fs.mkdir(path.join(WORK_REPO, 'src'), { recursive: true });
  await fs.writeFile(path.join(WORK_REPO, 'src', 'index.ts'), 'console.log("hello");');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', ['-C', WORK_REPO, 'commit', '-m', 'Initial commit', '--author', 'Test User <test@axiom.dev>']);
  await execFileAsync('git', ['-C', WORK_REPO, 'push', 'origin', 'main']);

  // Second commit
  await fs.writeFile(path.join(WORK_REPO, 'src', 'utils.ts'), 'export const add = (a: number, b: number) => a + b;');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', ['-C', WORK_REPO, 'commit', '-m', 'Add utils', '--author', 'Test User <test@axiom.dev>']);
  await execFileAsync('git', ['-C', WORK_REPO, 'push', 'origin', 'main']);

  // Create a feature branch
  await execFileAsync('git', ['-C', WORK_REPO, 'checkout', '-b', 'feature/auth']);
  await fs.writeFile(path.join(WORK_REPO, 'src', 'auth.ts'), 'export function login() {}');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', ['-C', WORK_REPO, 'commit', '-m', 'Add auth module', '--author', 'Test User <test@axiom.dev>']);
  await execFileAsync('git', ['-C', WORK_REPO, 'push', 'origin', 'feature/auth']);
}

describe('Git Core Layer', () => {
  beforeAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
    await fs.mkdir(TEST_BASE, { recursive: true });
    await initBareRepo(BARE_REPO, 'main');
    await seedRepo();
  });

  afterAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
  });

  // ─── Repo Manager ──────────────────────────────────────────

  describe('repo-manager', () => {
    it('should create bare repo', async () => {
      expect(await repoExists(BARE_REPO)).toBe(true);
    });

    it('should report repo size', async () => {
      const size = await getRepoSize(BARE_REPO);
      expect(size).toBeGreaterThan(0);
    });

    it('should fork a repo', async () => {
      const forkPath = path.join(TEST_BASE, 'fork.git');
      await forkRepo(BARE_REPO, forkPath);
      expect(await repoExists(forkPath)).toBe(true);
      // Fork should have same branches
      const branches = await gitCmd.listBranches(forkPath, 'main');
      expect(branches.some((b) => b.name === 'main')).toBe(true);
      await deleteRepo(forkPath);
    });

    it('should delete a repo', async () => {
      const tempPath = path.join(TEST_BASE, 'to-delete.git');
      await initBareRepo(tempPath);
      expect(await repoExists(tempPath)).toBe(true);
      await deleteRepo(tempPath);
      expect(await repoExists(tempPath)).toBe(false);
    });

    it('should refuse to delete non-git directory', async () => {
      const fakePath = path.join(TEST_BASE, 'not-a-repo');
      await fs.mkdir(fakePath, { recursive: true });
      await expect(deleteRepo(fakePath)).rejects.toThrow('Not a git repository');
      await fs.rm(fakePath, { recursive: true });
    });
  });

  // ─── Branches ─────────────────────────────────────────────

  describe('branches', () => {
    it('should list branches', async () => {
      const branches = await gitCmd.listBranches(BARE_REPO, 'main');
      expect(branches.length).toBeGreaterThanOrEqual(2);
      expect(branches.find((b) => b.name === 'main')).toBeDefined();
      expect(branches.find((b) => b.name === 'feature/auth')).toBeDefined();
    });

    it('should mark default branch', async () => {
      const branches = await gitCmd.listBranches(BARE_REPO, 'main');
      const main = branches.find((b) => b.name === 'main');
      expect(main?.isDefault).toBe(true);
      const feature = branches.find((b) => b.name === 'feature/auth');
      expect(feature?.isDefault).toBe(false);
    });

    it('should check branch existence', async () => {
      expect(await gitCmd.branchExists(BARE_REPO, 'main')).toBe(true);
      expect(await gitCmd.branchExists(BARE_REPO, 'nonexistent')).toBe(false);
    });

    it('should create and delete branch', async () => {
      const mainSha = await gitCmd.resolveRef(BARE_REPO, 'refs/heads/main');
      await gitCmd.createBranch(BARE_REPO, 'test-branch', mainSha);
      expect(await gitCmd.branchExists(BARE_REPO, 'test-branch')).toBe(true);
      await gitCmd.deleteBranch(BARE_REPO, 'test-branch');
      expect(await gitCmd.branchExists(BARE_REPO, 'test-branch')).toBe(false);
    });
  });

  // ─── Commits ──────────────────────────────────────────────

  describe('commits', () => {
    it('should list commits on main', async () => {
      const commits = await gitCmd.log(BARE_REPO, 'main');
      expect(commits.length).toBe(2);
      expect(commits[0].message).toBe('Add utils');
      expect(commits[1].message).toBe('Initial commit');
    });

    it('should respect limit and skip', async () => {
      const commits = await gitCmd.log(BARE_REPO, 'main', 1, 1);
      expect(commits.length).toBe(1);
      expect(commits[0].message).toBe('Initial commit');
    });

    it('should get single commit', async () => {
      const commits = await gitCmd.log(BARE_REPO, 'main', 1);
      const commit = await gitCmd.getCommit(BARE_REPO, commits[0].sha);
      expect(commit).not.toBeNull();
      expect(commit!.author).toBe('Test User');
      expect(commit!.authorEmail).toBe('test@axiom.dev');
    });

    it('should count commits', async () => {
      const count = await gitCmd.commitCount(BARE_REPO, 'main');
      expect(count).toBe(2);
      const featureCount = await gitCmd.commitCount(BARE_REPO, 'feature/auth');
      expect(featureCount).toBe(3); // 2 from main + 1 on feature
    });

    it('should return null for invalid commit', async () => {
      const commit = await gitCmd.getCommit(BARE_REPO, 'deadbeefdeadbeef');
      expect(commit).toBeNull();
    });
  });

  // ─── Tree / File Browser ──────────────────────────────────

  describe('tree', () => {
    it('should list root tree', async () => {
      const entries = await gitCmd.lsTree(BARE_REPO, 'main');
      const names = entries.map((e) => e.name);
      expect(names).toContain('README.md');
      expect(names).toContain('src');
    });

    it('should list subdirectory', async () => {
      const entries = await gitCmd.lsTree(BARE_REPO, 'main', 'src');
      // ls-tree with path shows contents if it's a directory
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it('should distinguish blobs and trees', async () => {
      const entries = await gitCmd.lsTree(BARE_REPO, 'main');
      const readme = entries.find((e) => e.name === 'README.md');
      const src = entries.find((e) => e.name === 'src');
      expect(readme?.type).toBe('blob');
      expect(src?.type).toBe('tree');
    });

    it('should show blob content', async () => {
      const content = await gitCmd.showBlob(BARE_REPO, 'main', 'README.md');
      expect(content).toContain('# Test Repo');
      expect(content).toContain('Hello world');
    });

    it('should get blob size', async () => {
      const size = await gitCmd.blobSize(BARE_REPO, 'main', 'README.md');
      expect(size).toBeGreaterThan(0);
    });
  });

  // ─── Diffs ────────────────────────────────────────────────

  describe('diffs', () => {
    it('should diff between branches', async () => {
      const output = await gitCmd.diff(BARE_REPO, 'main', 'feature/auth');
      expect(output).toContain('auth.ts');
    });

    it('should get diff stats', async () => {
      const stats = await gitCmd.diffStat(BARE_REPO, 'main', 'feature/auth');
      expect(stats.length).toBeGreaterThanOrEqual(1);
      const authFile = stats.find((s) => s.file.includes('auth.ts'));
      expect(authFile).toBeDefined();
      expect(authFile!.additions).toBeGreaterThan(0);
    });
  });

  // ─── Blame ────────────────────────────────────────────────

  describe('blame', () => {
    it('should blame a file', async () => {
      const lines = await gitCmd.blame(BARE_REPO, 'main', 'README.md');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0].author).toBe('Test User');
      expect(lines[0].content).toContain('# Test Repo');
    });
  });

  // ─── Tags ─────────────────────────────────────────────────

  describe('tags', () => {
    it('should list tags (empty initially)', async () => {
      const tags = await gitCmd.listTags(BARE_REPO);
      expect(tags).toEqual([]);
    });
  });

  // ─── Merge checks ────────────────────────────────────────

  describe('merge', () => {
    it('should find merge base', async () => {
      const base = await gitCmd.mergeBase(BARE_REPO, 'main', 'feature/auth');
      expect(base).toBeTruthy();
      expect(base.length).toBe(40);
    });

    it('should detect clean merge', async () => {
      const mergeable = await gitCmd.canMerge(BARE_REPO, 'feature/auth', 'main');
      expect(mergeable).toBe(true);
    });
  });

  // ─── Refs ─────────────────────────────────────────────────

  describe('refs', () => {
    it('should resolve ref to sha', async () => {
      const sha = await gitCmd.resolveRef(BARE_REPO, 'refs/heads/main');
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
    });
  });
});
