import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';

import { Server, type Connection, type AuthContext } from 'ssh2';

import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { ERR } from '../utils/error-messages';
import { logger } from '../utils/logger';

const SSH_PORT = parseInt(process.env.SSH_PORT || '2222', 10);
const HOST_KEY_PATH = process.env.SSH_HOST_KEY || '/data/ssh/host_key';

/**
 * Look up an SSH key by its fingerprint and return the associated userId.
 * @param key
 * @param key.data
 */
async function authenticateByKey(key: { data: Buffer }): Promise<string | null> {
  const hash = crypto.createHash('sha256').update(key.data).digest('base64');
  const fingerprint = `SHA256:${hash.replace(/=+$/, '')}`;

  const sshKey = await prisma.sshKey.findUnique({ where: { fingerprint } });
  if (!sshKey) return null;

  // Update last used
  await prisma.sshKey.update({
    where: { id: sshKey.id },
    data: { lastUsedAt: new Date() },
  });

  return sshKey.userId;
}

/**
 * Parse a git command from the SSH exec request.
 * Expected format: git-upload-pack '/org/team/repo.git' or git-receive-pack '/org/team/repo.git'
 * @param command
 */
function parseGitCommand(command: string): {
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
 * Resolve the repo path and check user permissions.
 * @param userId
 * @param orgSlug
 * @param teamSlug
 * @param repoSlug
 * @param needsWrite
 */
async function resolveAndAuthorize(
  userId: string,
  orgSlug: string,
  teamSlug: string,
  repoSlug: string,
  needsWrite: boolean,
): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new AppError(404, ERR.REPOSITORY_NOT_FOUND);

  const team = await prisma.team.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: teamSlug } },
  });
  if (!team) throw new AppError(404, ERR.REPOSITORY_NOT_FOUND);

  const repo = await prisma.repository.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: repoSlug } },
  });
  if (!repo || !repo.diskPath) throw new AppError(404, ERR.REPOSITORY_NOT_FOUND);

  // Check permissions
  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: org.id } },
  });

  if (!orgMembership && repo.visibility === 'PRIVATE') {
    throw new AppError(403, ERR.ACCESS_DENIED);
  }

  if (needsWrite) {
    if (!orgMembership || orgMembership.role === 'VIEWER' || orgMembership.role === 'GUEST') {
      throw new AppError(403, 'Write access denied');
    }
  }

  return repo.diskPath;
}

/**
 *
 */
export function startSshServer() {
  // Generate host key if it doesn't exist
  const hostKeyDir = HOST_KEY_PATH.substring(0, HOST_KEY_PATH.lastIndexOf('/'));
  if (!fs.existsSync(hostKeyDir)) {
    fs.mkdirSync(hostKeyDir, { recursive: true });
  }
  if (!fs.existsSync(HOST_KEY_PATH)) {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(HOST_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.chmodSync(HOST_KEY_PATH, 0o600);
  }

  const server = new Server(
    {
      hostKeys: [fs.readFileSync(HOST_KEY_PATH)],
    },
    (client: Connection) => {
      let authenticatedUserId: string | null = null;

      client.on('authentication', async (ctx: AuthContext) => {
        if (ctx.method === 'publickey') {
          const userId = await authenticateByKey(ctx.key!);
          if (userId) {
            authenticatedUserId = userId;
            return ctx.accept();
          }
        }
        // Reject all other methods
        ctx.reject(['publickey']);
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();

          session.on('exec', async (accept, reject, info) => {
            const parsed = parseGitCommand(info.command);
            if (!parsed) {
              const channel = accept();
              channel.stderr.write('Error: only git commands are allowed\n');
              channel.exit(1);
              channel.close();
              return;
            }

            if (!authenticatedUserId) {
              const channel = accept();
              channel.stderr.write('Error: not authenticated\n');
              channel.exit(1);
              channel.close();
              return;
            }

            try {
              const needsWrite = parsed.service === 'git-receive-pack';
              const diskPath = await resolveAndAuthorize(
                authenticatedUserId,
                parsed.orgSlug,
                parsed.teamSlug,
                parsed.repoSlug,
                needsWrite,
              );

              const channel = accept();
              const gitProcess = spawn(parsed.service, [diskPath]);

              channel.pipe(gitProcess.stdin);
              gitProcess.stdout.pipe(channel);
              gitProcess.stderr.pipe(channel.stderr);

              gitProcess.on('close', (code) => {
                channel.exit(code ?? 1);
                channel.close();
              });

              gitProcess.on('error', () => {
                channel.stderr.write('Error: git operation failed\n');
                channel.exit(1);
                channel.close();
              });
            } catch (err: unknown) {
              const channel = accept();
              channel.stderr.write(
                `Error: ${err instanceof Error ? err.message : 'Unknown error'}\n`,
              );
              channel.exit(1);
              channel.close();
            }
          });
        });
      });

      client.on('error', () => {
        // Ignore client errors (disconnects, etc.)
      });
    },
  );

  server.listen(SSH_PORT, '0.0.0.0', () => {
    logger.info('Axiom SSH server listening', { port: SSH_PORT });
  });

  return server;
}
