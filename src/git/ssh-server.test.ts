import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import type { Server } from 'ssh2';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { authPost } from '../test/helpers';

import { parseGitCommand, startSshServer } from './ssh-server';

const execFileAsync = promisify(execFile);

async function makeKey(dir: string, name: string): Promise<{ file: string; pub: string }> {
  const file = path.join(dir, name);
  await execFileAsync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', file]);
  return { file, pub: (await fs.readFile(`${file}.pub`, 'utf8')).trim() };
}

// Register a public key for a user directly; the REST endpoint was removed with SSH key management.
async function registerKey(userId: string, title: string, publicKey: string) {
  const keyData = Buffer.from(publicKey.trim().split(/\s+/)[1], 'base64');
  const hash = crypto.createHash('sha256').update(keyData).digest('base64').replace(/=+$/, '');
  await prisma.sshKey.create({
    data: { userId, title, publicKey: publicKey.trim(), fingerprint: `SHA256:${hash}` },
  });
}

describe('parseGitCommand', () => {
  it('parses quoted paths with a leading slash', () => {
    expect(parseGitCommand("git-upload-pack '/o/t/r.git'")).toEqual({
      service: 'git-upload-pack',
      orgSlug: 'o',
      teamSlug: 't',
      repoSlug: 'r',
    });
  });

  it('rejects anything else', () => {
    expect(parseGitCommand('sh -c id')).toBeNull();
  });
});

describe('SSH git transport', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let server: Server;
  let hookServer: http.Server;
  const hookCalls: { repo: string; ref: string }[] = [];
  let tmp: string;
  let port: number;
  let repoId: string;
  let repoPath: string;
  let ownerKey: { file: string; pub: string };
  let viewerKey: { file: string; pub: string };
  let strangerKey: { file: string; pub: string };
  let hostKeyPath: string;
  const savedInternalUrl = process.env.AXIOM_INTERNAL_URL;

  function git(args: string[], key: string, cwd?: string) {
    return execFileAsync('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_SSH_COMMAND: `ssh -i ${key} -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o BatchMode=yes -o LogLevel=ERROR`,
      },
    });
  }

  function url(): string {
    return `ssh://git@127.0.0.1:${port}/${repoPath}.git`;
  }

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'axiom-ssh-'));

    hookServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.headers['x-hook-secret'] === process.env.HOOK_SECRET)
          hookCalls.push(JSON.parse(raw));
        res.writeHead(200);
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
    process.env.AXIOM_INTERNAL_URL = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}`;

    ctx = await createTestContext();
    const res = await authPost(`/api/repos/team/${ctx.teamId}`, ctx.owner.token, {
      name: 'SSH Repo',
      slug: 'ssh-repo',
    });
    repoId = res.body.id;
    repoPath = `${ctx.orgSlug}/${ctx.teamSlug}/ssh-repo`;

    viewer = await addMemberToContext(ctx, {
      email: `sshviewer-${Date.now()}@test.dev`,
      username: `sshviewer-${Date.now()}`,
    });
    ctx.member = viewer;
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: viewer.id, orgId: ctx.orgId } },
      data: { role: 'VIEWER' },
    });

    ownerKey = await makeKey(tmp, 'owner');
    viewerKey = await makeKey(tmp, 'viewer');
    strangerKey = await makeKey(tmp, 'stranger');
    await registerKey(ctx.owner.id, 'owner', ownerKey.pub);
    await registerKey(viewer.id, 'viewer', viewerKey.pub);

    hostKeyPath = path.join(tmp, 'host', 'host_key');
    server = await startSshServer({
      port: 0,
      host: '127.0.0.1',
      hostKeyPath,
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    process.env.AXIOM_INTERNAL_URL = savedInternalUrl;
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => hookServer.close(resolve));
    await prisma.sshKey.deleteMany({ where: { userId: { in: [ctx.owner.id, viewer.id] } } });
    await cleanupTestContext(ctx);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('generates the host key file with mode 0o600', async () => {
    const stat = await fs.stat(hostKeyPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('lets the owner clone, commit and push, and the push reaches the hook', async () => {
    const work = path.join(tmp, 'owner-work');
    await git(['clone', url(), work], ownerKey.file);
    await fs.writeFile(path.join(work, 'README.md'), '# ssh');
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
      'init',
    ]);
    await git(['push', 'origin', 'HEAD:main'], ownerKey.file, work);

    expect(hookCalls).toContainEqual(
      expect.objectContaining({ repo: repoId, ref: 'refs/heads/main' }),
    );

    const key = await prisma.sshKey.findFirst({ where: { userId: ctx.owner.id } });
    expect(key?.lastUsedAt).not.toBeNull();
  });

  it('transfers a large incompressible file over ssh without truncation', async () => {
    const work = path.join(tmp, 'large-push');
    await git(['clone', url(), work], ownerKey.file);
    const data = crypto.randomBytes(8 * 1024 * 1024);
    const expectedSha = crypto.createHash('sha256').update(data).digest('hex');
    await fs.writeFile(path.join(work, 'blob.bin'), data);
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
      'large blob',
    ]);
    await git(['push', 'origin', 'HEAD:main'], ownerKey.file, work);

    const clone = path.join(tmp, 'large-clone');
    await git(['clone', url(), clone], ownerKey.file);
    const cloned = await fs.readFile(path.join(clone, 'blob.bin'));
    expect(cloned.length).toBe(data.length);
    expect(crypto.createHash('sha256').update(cloned).digest('hex')).toBe(expectedSha);
  }, 30000);

  it('lets a viewer read but not push', async () => {
    const { stdout } = await git(['ls-remote', url()], viewerKey.file);
    expect(stdout).toContain('refs/heads/main');

    const work = path.join(tmp, 'viewer-work');
    await git(['clone', url(), work], viewerKey.file);
    await fs.writeFile(path.join(work, 'x.txt'), 'x');
    await execFileAsync('git', ['-C', work, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      work,
      '-c',
      'user.name=V',
      '-c',
      'user.email=v@t.dev',
      'commit',
      '-m',
      'x',
    ]);
    await expect(git(['push', 'origin', 'HEAD:main'], viewerKey.file, work)).rejects.toThrow(
      /Write access denied/,
    );
  });

  it('refuses an unregistered key', async () => {
    await expect(git(['ls-remote', url()], strangerKey.file)).rejects.toThrow(/Permission denied/);
  });

  it('refuses a deactivated user even with a registered key', async () => {
    const deactivated = await createTestUser({
      email: `sshdeactivated-${Date.now()}@test.dev`,
      username: `sshdeactivated-${Date.now()}`,
    });
    const deactivatedKey = await makeKey(tmp, 'deactivated');
    await registerKey(deactivated.id, 'deactivated', deactivatedKey.pub);
    await prisma.user.update({
      where: { id: deactivated.id },
      data: { deactivatedAt: new Date() },
    });

    await expect(git(['ls-remote', url()], deactivatedKey.file)).rejects.toThrow(
      /Permission denied/,
    );

    await prisma.sshKey.deleteMany({ where: { userId: deactivated.id } });
    await prisma.user.deleteMany({ where: { id: deactivated.id } });
  });
});
