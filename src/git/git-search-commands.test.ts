import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { grepFiles } from './git-search-commands';

const execFileAsync = promisify(execFile);

const TEST_BASE = '/tmp/axiom-git-search-test';
const BARE_REPO = path.join(TEST_BASE, 'search-repo.git');
const WORK_REPO = path.join(TEST_BASE, 'search-work');

async function seedRepo() {
  await execFileAsync('git', ['clone', BARE_REPO, WORK_REPO]);

  await fs.writeFile(path.join(WORK_REPO, 'README.md'), '# Search Test\nThis is a test repo.');
  await fs.mkdir(path.join(WORK_REPO, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(WORK_REPO, 'src', 'index.ts'),
    'const greeting = "hello world";\nconsole.log(greeting);\n',
  );
  await fs.writeFile(
    path.join(WORK_REPO, 'src', 'utils.ts'),
    'export const add = (a: number, b: number) => a + b;\nexport const greeting = "hello";\n',
  );

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
  await execFileAsync('git', ['-C', WORK_REPO, 'push', 'origin', 'master']);
}

describe('git-search-commands', () => {
  beforeAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
    await fs.mkdir(TEST_BASE, { recursive: true });
    await execFileAsync('git', ['init', '--bare', BARE_REPO]);
    await seedRepo();
  });

  afterAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
  });

  it('finds matches across files', async () => {
    const results = await grepFiles(BARE_REPO, 'greeting');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.lineContent.includes('greeting'))).toBe(true);
    expect(results.every((r) => typeof r.lineNumber === 'number' && r.lineNumber > 0)).toBe(true);
  });

  it('returns file paths relative to repo root', async () => {
    const results = await grepFiles(BARE_REPO, 'hello');
    const paths = results.map((r) => r.filePath);
    expect(paths).toContain('src/index.ts');
  });

  it('returns empty array when no matches', async () => {
    const results = await grepFiles(BARE_REPO, 'nonexistent_string_xyz_42');
    expect(results).toEqual([]);
  });

  it('respects filePattern filter', async () => {
    const results = await grepFiles(BARE_REPO, 'greeting', { filePattern: '*.ts' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.filePath.endsWith('.ts'))).toBe(true);
  });

  it('respects maxResults limit', async () => {
    const results = await grepFiles(BARE_REPO, 'greeting', { maxResults: 1 });
    expect(results.length).toBe(1);
  });

  it('parses line content with colons correctly', async () => {
    // "hello world" line doesn't have colons, but the export line has colons in type annotation
    const results = await grepFiles(BARE_REPO, 'number');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find((r) => r.filePath === 'src/utils.ts');
    expect(match).toBeDefined();
    expect(match!.lineContent).toContain('number');
  });
});
