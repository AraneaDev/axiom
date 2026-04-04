import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { resolveRef } from './git-log-commands';
import { listTags, createTag, deleteTag } from './git-tag-commands';
import { initBareRepo } from './repo-manager';

const execFileAsync = promisify(execFile);

const TEST_BASE = '/tmp/axiom-tag-test';
const BARE_REPO = path.join(TEST_BASE, 'tag-test.git');
const WORK_REPO = path.join(TEST_BASE, 'tag-work');

async function seedRepo() {
  await execFileAsync('git', ['clone', BARE_REPO, WORK_REPO]);
  await fs.writeFile(path.join(WORK_REPO, 'README.md'), '# Tag Test');
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

  // Second commit to have two SHAs to work with
  await fs.writeFile(path.join(WORK_REPO, 'v2.txt'), 'v2 content');
  await execFileAsync('git', ['-C', WORK_REPO, 'add', '.']);
  await execFileAsync('git', [
    '-C',
    WORK_REPO,
    'commit',
    '-m',
    'Second commit',
    '--author',
    'Test User <test@axiom.dev>',
  ]);
  await execFileAsync('git', ['-C', WORK_REPO, 'push', 'origin', 'main']);
}

describe('git-tag-commands', () => {
  beforeAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
    await fs.mkdir(TEST_BASE, { recursive: true });
    await initBareRepo(BARE_REPO, 'main');
    await seedRepo();
  });

  afterAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
  });

  describe('listTags()', () => {
    it('returns empty array when no tags exist', async () => {
      const tags = await listTags(BARE_REPO);
      expect(tags).toEqual([]);
    });

    it('returns tags after creating them', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createTag(BARE_REPO, 'v1.0.0', sha);
      const tags = await listTags(BARE_REPO);
      expect(tags.map((t) => t.name)).toContain('v1.0.0');
      // cleanup
      await deleteTag(BARE_REPO, 'v1.0.0');
    });

    it('each tag has a name and sha', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createTag(BARE_REPO, 'v2.0.0', sha);
      const tags = await listTags(BARE_REPO);
      for (const t of tags) {
        expect(t.name).toBeTruthy();
        expect(t.sha).toMatch(/^[a-f0-9]+$/);
      }
      // cleanup
      await deleteTag(BARE_REPO, 'v2.0.0');
    });

    it('lists multiple tags', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createTag(BARE_REPO, 'v1.0.0', sha);
      await createTag(BARE_REPO, 'v1.1.0', sha);
      const tags = await listTags(BARE_REPO);
      const names = tags.map((t) => t.name);
      expect(names).toContain('v1.0.0');
      expect(names).toContain('v1.1.0');
      // cleanup
      await deleteTag(BARE_REPO, 'v1.0.0');
      await deleteTag(BARE_REPO, 'v1.1.0');
    });
  });

  describe('createTag()', () => {
    it('creates a lightweight tag at a SHA', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createTag(BARE_REPO, 'lightweight', sha);
      const tags = await listTags(BARE_REPO);
      expect(tags.map((t) => t.name)).toContain('lightweight');
      // cleanup
      await deleteTag(BARE_REPO, 'lightweight');
    });

    it('creates an annotated tag with a message', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createTag(BARE_REPO, 'annotated', sha, 'Release v1.0');
      const tags = await listTags(BARE_REPO);
      expect(tags.map((t) => t.name)).toContain('annotated');
      // cleanup
      await deleteTag(BARE_REPO, 'annotated');
    });

    it('throws when creating a tag on an invalid SHA', async () => {
      await expect(createTag(BARE_REPO, 'bad-tag', 'deadbeefdeadbeef')).rejects.toThrow();
    });

    it('throws when creating a duplicate tag', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createTag(BARE_REPO, 'dup-tag', sha);
      await expect(createTag(BARE_REPO, 'dup-tag', sha)).rejects.toThrow();
      // cleanup
      await deleteTag(BARE_REPO, 'dup-tag');
    });
  });

  describe('deleteTag()', () => {
    it('removes an existing tag', async () => {
      const sha = await resolveRef(BARE_REPO, 'refs/heads/main');
      await createTag(BARE_REPO, 'to-delete', sha);
      let tags = await listTags(BARE_REPO);
      expect(tags.map((t) => t.name)).toContain('to-delete');

      await deleteTag(BARE_REPO, 'to-delete');
      tags = await listTags(BARE_REPO);
      expect(tags.map((t) => t.name)).not.toContain('to-delete');
    });

    it('throws when deleting a non-existent tag', async () => {
      await expect(deleteTag(BARE_REPO, 'ghost-tag')).rejects.toThrow();
    });
  });
});
