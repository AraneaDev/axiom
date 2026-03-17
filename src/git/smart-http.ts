import { Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';

type GitService = 'git-upload-pack' | 'git-receive-pack';

/**
 * Authenticate via HTTP Basic Auth using API token as password.
 * Returns userId if valid.
 */
async function authenticateGitRequest(req: Request): Promise<string> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    throw new AppError(401, 'Authentication required');
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) throw new AppError(401, 'Invalid credentials');

  const password = decoded.slice(colonIdx + 1); // username is ignored
  if (!password.startsWith('tk_')) throw new AppError(401, 'Use an API token as password');

  const tokenHash = crypto.createHash('sha256').update(password).digest('hex');
  const apiToken = await prisma.apiToken.findUnique({ where: { tokenHash } });
  if (!apiToken) throw new AppError(401, 'Invalid API token');
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
    throw new AppError(401, 'Token expired');
  }

  // Update last used
  await prisma.apiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() },
  });

  return apiToken.userId;
}

/**
 * Resolve org/team/repo slugs to a repository record and verify access.
 */
async function resolveRepo(
  orgSlug: string,
  teamSlug: string,
  repoSlug: string,
  userId: string,
  needsWrite: boolean,
) {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new AppError(404, 'Not found');

  const team = await prisma.team.findUnique({
    where: { orgId_slug: { orgId: org.id, slug: teamSlug } },
  });
  if (!team) throw new AppError(404, 'Not found');

  const repo = await prisma.repository.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: repoSlug } },
  });
  if (!repo || !repo.diskPath) throw new AppError(404, 'Not found');

  // Check permissions
  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: org.id } },
  });

  if (!orgMembership && repo.visibility === 'PRIVATE') {
    throw new AppError(403, 'Access denied');
  }

  if (needsWrite) {
    // Need at least MEMBER role to push
    if (!orgMembership || orgMembership.role === 'VIEWER' || orgMembership.role === 'GUEST') {
      throw new AppError(403, 'Write access denied');
    }
  }

  return repo;
}

function sendAuthChallenge(res: Response) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Axiom Git"');
  res.status(401).send('Authentication required');
}

/**
 * Handle GET /info/refs?service=git-upload-pack|git-receive-pack
 */
export async function handleInfoRefs(req: Request, res: Response, next: NextFunction) {
  try {
    const service = req.query.service as string;
    if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
      return res.status(400).send('Invalid service');
    }

    let userId: string;
    try {
      userId = await authenticateGitRequest(req);
    } catch {
      return sendAuthChallenge(res);
    }

    const { org, team, repo: repoSlug } = req.params;
    const cleanSlug = repoSlug.replace(/\.git$/, '');
    const needsWrite = service === 'git-receive-pack';
    const repoRecord = await resolveRepo(org, team, cleanSlug, userId, needsWrite);

    res.setHeader('Content-Type', `application/x-${service}-advertisement`);
    res.setHeader('Cache-Control', 'no-cache');

    // Write the pkt-line header
    const header = `# service=${service}\n`;
    const headerPkt = `${(header.length + 4).toString(16).padStart(4, '0')}${header}`;
    res.write(headerPkt);
    res.write('0000'); // flush-pkt

    // Spawn the git service with --advertise-refs
    const gitProcess = spawn(service, ['--stateless-rpc', '--advertise-refs', repoRecord.diskPath!]);

    gitProcess.stdout.pipe(res);
    gitProcess.stderr.on('data', (data) => {
      console.error(`git ${service} stderr:`, data.toString());
    });
    gitProcess.on('error', (err) => next(err));
  } catch (err) {
    next(err);
  }
}

/**
 * Handle POST /git-upload-pack or /git-receive-pack
 */
export async function handleServiceRpc(req: Request, res: Response, next: NextFunction) {
  try {
    const service = req.params.service as GitService;
    if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
      return res.status(400).send('Invalid service');
    }

    let userId: string;
    try {
      userId = await authenticateGitRequest(req);
    } catch {
      return sendAuthChallenge(res);
    }

    const { org, team, repo: repoSlug } = req.params;
    const cleanSlug = repoSlug.replace(/\.git$/, '');
    const needsWrite = service === 'git-receive-pack';
    const repoRecord = await resolveRepo(org, team, cleanSlug, userId, needsWrite);

    res.setHeader('Content-Type', `application/x-${service}-result`);
    res.setHeader('Cache-Control', 'no-cache');

    const gitProcess = spawn(service, ['--stateless-rpc', repoRecord.diskPath!]);

    req.pipe(gitProcess.stdin);
    gitProcess.stdout.pipe(res);

    gitProcess.stderr.on('data', (data) => {
      console.error(`git ${service} stderr:`, data.toString());
    });

    gitProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`git ${service} exited with code ${code}`);
      }
      // If it was a push, we could trigger webhooks here
    });

    gitProcess.on('error', (err) => {
      console.error(`git ${service} error:`, err);
      if (!res.headersSent) {
        res.status(500).send('Git operation failed');
      }
    });
  } catch (err) {
    next(err);
  }
}
