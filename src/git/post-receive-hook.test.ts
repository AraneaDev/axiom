import { execFile, spawn } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { generatePostReceiveHook } from './hook-handler';
import { initBareRepo } from './repo-manager';

const execFileAsync = promisify(execFile);
const HOOK_ENTRY = path.resolve('src/git/post-receive-hook.ts');
const SECRET = 'test-hook-secret-1234567890';

interface Captured {
  headers: http.IncomingHttpHeaders;
  body: { repo: string; ref: string; before: string; after: string };
}

describe('post-receive hook', () => {
  let server: http.Server;
  let baseUrl: string;
  let captured: Captured[] = [];
  let tmp: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        captured.push({ headers: req.headers, body: JSON.parse(raw) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'axiom-hook-'));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    captured = [];
  });

  function runEntry(
    args: string[],
    stdin: string,
    env: Record<string, string>,
  ): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [HOOK_ENTRY, ...args], {
        env: { PATH: process.env.PATH ?? '', ...env },
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve({ code, stderr }));
      child.stdin.end(stdin);
    });
  }

  it('posts every updated ref with the secret from the environment', async () => {
    const { code } = await runEntry(
      ['repo-123'],
      'aaa bbb refs/heads/main\nccc ddd refs/tags/v1\n',
      { AXIOM_INTERNAL_URL: baseUrl, HOOK_SECRET: SECRET },
    );
    expect(code).toBe(0);
    expect(captured).toHaveLength(2);
    const main = captured.find((c) => c.body.ref === 'refs/heads/main')!;
    expect(main.body).toEqual({
      repo: 'repo-123',
      ref: 'refs/heads/main',
      before: 'aaa',
      after: 'bbb',
    });
    expect(main.headers['x-hook-secret']).toBe(SECRET);
  });

  it('exits 0 and reports on stderr when HOOK_SECRET is missing', async () => {
    const { code, stderr } = await runEntry(['repo-123'], 'a b refs/heads/main\n', {
      AXIOM_INTERNAL_URL: baseUrl,
    });
    expect(code).toBe(0);
    expect(stderr).toContain('HOOK_SECRET');
    expect(captured).toHaveLength(0);
  });

  it('exits 0 and reports on stderr when the API is unreachable', async () => {
    const { code, stderr } = await runEntry(['repo-123'], 'a b refs/heads/main\n', {
      AXIOM_INTERNAL_URL: 'http://127.0.0.1:9',
      HOOK_SECRET: SECRET,
    });
    expect(code).toBe(0);
    expect(stderr).toContain('refs/heads/main');
  });

  it('generates a sh script that holds no secret and no URL', () => {
    const script = generatePostReceiveHook('repo-abc-123');
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain('"repo-abc-123"');
    expect(script).toContain('AXIOM_HOOK_ENTRY');
    expect(script).not.toContain(process.env.HOOK_SECRET ?? 'unset');
    expect(script).not.toMatch(/https?:\/\//);
  });

  it('rejects repo ids with shell metacharacters', () => {
    expect(() => generatePostReceiveHook('x"; rm -rf /; "')).toThrow();
  });

  it('fires on a real push into a bare repo', async () => {
    const bare = path.join(tmp, 'hooked.git');
    await initBareRepo(bare, 'main', 'repo-real-push');
    const work = path.join(tmp, 'work');
    await execFileAsync('git', ['clone', bare, work]);
    await fs.writeFile(path.join(work, 'a.txt'), 'a');
    await execFileAsync('git', ['-C', work, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      work,
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@t.dev',
      'commit',
      '-m',
      'a',
    ]);
    await execFileAsync('git', ['-C', work, 'push', 'origin', 'main'], {
      env: {
        ...process.env,
        AXIOM_INTERNAL_URL: baseUrl,
        HOOK_SECRET: SECRET,
        AXIOM_HOOK_ENTRY: HOOK_ENTRY,
      },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].body.repo).toBe('repo-real-push');
    expect(captured[0].body.ref).toBe('refs/heads/main');
  });
});
