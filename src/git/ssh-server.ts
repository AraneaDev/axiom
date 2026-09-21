import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { Server, type AuthContext, type Connection, type ServerChannel } from 'ssh2';

import { prisma } from '../config/database';
import { logger } from '../utils/logger';

import { resolveRepoForGit } from './git-access';
import { fingerprintOf, verifyPublicKeyAuth } from './ssh-auth';

export interface SshServerOptions {
  port?: number;
  host?: string;
  hostKeyPath?: string;
}

/**
 * Parse a git command from an SSH exec request.
 * Accepts: git-upload-pack '/org/team/repo.git' or git-receive-pack 'org/team/repo'
 * @param command - The exec command string
 * @returns Parsed service and slugs, or null for anything else
 */
export function parseGitCommand(command: string): {
  service: 'git-upload-pack' | 'git-receive-pack';
  orgSlug: string;
  teamSlug: string;
  repoSlug: string;
} | null {
  const match = command.match(
    /^(git-upload-pack|git-receive-pack)\s+'?\/?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?'?$/,
  );
  if (!match) return null;
  return {
    service: match[1] as 'git-upload-pack' | 'git-receive-pack',
    orgSlug: match[2],
    teamSlug: match[3],
    repoSlug: match[4],
  };
}

/**
 * Load the SSH host key from disk, generating and persisting a new ed25519
 * key the first time the server starts.
 *
 * The key is generated with the `ssh-keygen` binary rather than Node's
 * `crypto.generateKeyPairSync`: Node can only export ed25519 private keys as
 * PKCS8 PEM, and ssh2's key parser does not accept that format (it needs the
 * OpenSSH private key format that `ssh-keygen` writes).
 * @param hostKeyPath - Path to the OpenSSH-format private key
 * @returns The host key contents
 */
function loadOrCreateHostKey(hostKeyPath: string): Buffer {
  if (!fs.existsSync(hostKeyPath)) {
    fs.mkdirSync(path.dirname(hostKeyPath), { recursive: true });
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', hostKeyPath]);
    fs.chmodSync(hostKeyPath, 0o600);
    logger.info('Generated SSH host key', { path: hostKeyPath });
  }
  return fs.readFileSync(hostKeyPath);
}

/**
 * Write an error to the channel's stderr and close it with a non-zero exit code.
 * @param channel - The SSH channel to fail
 * @param message - Human readable error message
 */
function fail(channel: ServerChannel, message: string): void {
  channel.stderr.write(`Error: ${message}\n`);
  channel.exit(1);
  channel.close();
}

/**
 * Start the SSH git transport. Only git-upload-pack and git-receive-pack are allowed.
 * @param options - Listen port and host, host key path (defaults from env)
 * @returns The listening server
 * @throws {Error} when the host key cannot be read or created, or listen fails
 */
export async function startSshServer(options: SshServerOptions = {}): Promise<Server> {
  const port = options.port ?? parseInt(process.env.SSH_LISTEN_PORT || '2222', 10);
  const host = options.host ?? '0.0.0.0';
  const hostKeyPath = options.hostKeyPath ?? (process.env.SSH_HOST_KEY || '/data/ssh/host_key');

  const hostKey = loadOrCreateHostKey(hostKeyPath);

  const server = new Server({ hostKeys: [hostKey] }, (client: Connection) => {
    let authenticatedUserId: string | null = null;

    client.on('authentication', async (ctx: AuthContext) => {
      if (ctx.method !== 'publickey') return ctx.reject(['publickey']);
      try {
        const sshKey = await prisma.sshKey.findUnique({
          where: { fingerprint: fingerprintOf(ctx.key.data) },
        });
        if (!sshKey) return ctx.reject(['publickey']);

        const result = verifyPublicKeyAuth(ctx, sshKey.publicKey);
        if (result === 'reject') return ctx.reject(['publickey']);
        if (result === 'authenticated') {
          authenticatedUserId = sshKey.userId;
          await prisma.sshKey.update({
            where: { id: sshKey.id },
            data: { lastUsedAt: new Date() },
          });
        }
        return ctx.accept();
      } catch (err) {
        logger.error('SSH authentication error', {}, err as Error);
        return ctx.reject(['publickey']);
      }
    });

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();

        session.on('exec', async (acceptExec, _reject, info) => {
          const channel = acceptExec();
          const parsed = parseGitCommand(info.command);
          if (!parsed) return fail(channel, 'only git commands are allowed');
          if (!authenticatedUserId) return fail(channel, 'not authenticated');

          try {
            const repo = await resolveRepoForGit(
              authenticatedUserId,
              parsed.orgSlug,
              parsed.teamSlug,
              parsed.repoSlug,
              parsed.service === 'git-receive-pack',
            );

            const gitProcess = spawn(parsed.service, [repo.diskPath]);
            channel.pipe(gitProcess.stdin);
            // { end: false }: ssh2's Channel auto-sends EOF and closes itself as
            // soon as its writable side finishes (an internal 'finish' listener
            // registered ahead of ours). Left at the pipe() default, that fires
            // the moment the child's stdout ends, which flips the channel's
            // outgoing state away from 'open' before we get a chance to send the
            // exit-status request -- channel.exit() silently no-ops once the
            // state has moved on, so the client never learns the command
            // succeeded (OpenSSH logs "Exit status -1") even though every byte
            // of the pack protocol response was delivered. Keeping the channel
            // open until we explicitly exit()/close() it after the child closes
            // avoids that race.
            gitProcess.stdout.pipe(channel, { end: false });
            gitProcess.stderr.pipe(channel.stderr);

            gitProcess.on('close', (code) => {
              channel.exit(code ?? 1);
              channel.close();
            });
            gitProcess.on('error', () => fail(channel, 'git operation failed'));
          } catch (err) {
            fail(channel, err instanceof Error ? err.message : 'Unknown error');
          }
        });
      });
    });

    client.on('error', () => {
      // Client disconnects and protocol errors are expected; nothing to do.
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  logger.info('Axiom SSH server listening', { port: (server.address() as { port: number }).port });
  return server;
}
