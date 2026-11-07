import { z } from 'zod';

import { projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import { claimReconcile, reconcileRepo } from './reconcile.service';
import * as service from './repo-link.service';

const link = z.looseObject({ repoFullName: z.string(), htmlUrl: z.string() });
const linkWithCount = link.extend({ linkedIssueCount: z.number() });
const RECONCILE_COOLDOWN_MS = 60_000;
const PATH = '/api/projects/:projectId/github';

// Authorization runs on the id alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
type ProjectInput = z.infer<typeof projectTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Team ADMINs, org OWNERs/ADMINs and platform admins: team:manage_members is held by no
// team MEMBER and no org MEMBER, which is the "team ADMIN or higher" the spec asks for
const manage = projectAction<ProjectInput>('team:manage_members', (input) => input.projectId);

// A project reads the pull requests, reviews and CI logs of one GitHub repository to everyone
// who can read the project, so linking and unlinking are settings of the team's admins
registerActions([
  defineAction({
    name: 'githubRepo.get',
    area: 'github',
    kind: 'read',
    summary: 'Read the GitHub repository a project is linked to, or null',
    target: projectTarget,
    input: projectTarget,
    output: linkWithCount.nullable(),
    rest: { method: 'GET', path: PATH },
    authorize: read,
    handler: async (_ctx, { projectId }) => service.getRepoLink(projectId),
  }),
  defineAction({
    name: 'githubRepo.link',
    // Linking shows a repository's pull requests, reviews and CI logs to the whole project
    permissionChange: () => true,
    area: 'github',
    kind: 'write',
    summary: 'Link a project to one GitHub repository (you need admin rights on it on GitHub)',
    target: projectTarget,
    input: projectTarget.extend({
      repo: z
        .string()
        .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, 'Not an owner/name GitHub repository')
        .describe('The repository as owner/name, such as acme-labs/widget'),
    }),
    output: link,
    preview: (_ctx, { projectId, repo }) => previews.githubRepoLink(projectId, repo),
    rest: { method: 'POST', path: PATH },
    authorize: manage,
    handler: async (ctx, { projectId, repo }) => {
      const linked = await service.linkRepo(ctx.userId, projectId, repo);
      // A fresh link shows its open pull requests now, not after the first round of the worker
      setImmediate(() => {
        reconcileRepo(linked.id).catch((err: unknown) => {
          logger.warn('first github reconcile failed', {
            repoLinkId: linked.id,
            error: err instanceof Error ? err.message : 'unknown',
          });
        });
      });
      return linked;
    },
  }),
  defineAction({
    name: 'githubRepo.reconcile',
    area: 'github',
    kind: 'write',
    summary: 'Read the linked GitHub repository now and store what the webhooks missed',
    target: projectTarget,
    input: projectTarget,
    output: z.looseObject({ started: z.boolean() }),
    rest: { method: 'POST', path: `${PATH}/reconcile` },
    authorize: manage,
    handler: async (_ctx, { projectId }) => {
      const link = await service.findRepoLinkByProject(projectId);
      if (!link) {
        throw new AppError(404, 'This project is not linked to a GitHub repository', 'NOT_FOUND');
      }
      // Without its installation the App cannot read the repository; health says which case it is
      const installation = await service.installationState(link.installationId);
      if (installation === 'missing') {
        throw new AppError(
          409,
          'The GitHub App is not installed for this repository any more. Install it again, then reconcile.',
          'GITHUB_APP_NOT_INSTALLED',
        );
      }
      if (installation === 'suspended') {
        throw new AppError(
          409,
          'The GitHub App installation for this repository is suspended. Unsuspend it on GitHub, then reconcile.',
          'GITHUB_APP_SUSPENDED',
        );
      }
      // The worker reads every link every 15 minutes: a manual run is for seeing a change now,
      // not for spending 300 GitHub calls in a loop
      const wait =
        link.lastReconciledAt &&
        RECONCILE_COOLDOWN_MS - (Date.now() - link.lastReconciledAt.getTime());
      if (wait && wait > 0) {
        throw new AppError(
          429,
          'This repository was reconciled a moment ago.',
          'GITHUB_RECONCILE_COOLDOWN',
          { retryAfter: Math.ceil(wait / 1000), retryAfterSeconds: Math.ceil(wait / 1000) },
        );
      }
      // The lease is claimed now, so a run that is going answers 409 here. A run makes up to 300
      // GitHub calls, longer than the server waits for a response: it carries on after the answer
      // and records its result on the link, which health shows.
      const run = await claimReconcile(link.id);
      setImmediate(() => {
        run().catch((err: unknown) => {
          logger.warn('manual github reconcile failed', {
            repoLinkId: link.id,
            error: err instanceof Error ? err.message : 'unknown',
          });
        });
      });
      return { started: true };
    },
  }),
  defineAction({
    name: 'githubRepo.health',
    area: 'github',
    kind: 'read',
    summary: 'How the GitHub link of a project is doing: installation, last delivery, failures',
    target: projectTarget,
    input: projectTarget,
    output: z.looseObject({ linked: z.boolean() }),
    rest: { method: 'GET', path: `${PATH}/health` },
    authorize: read,
    handler: async (_ctx, { projectId }) => service.getLinkHealth(projectId),
  }),
  defineAction({
    name: 'githubRepo.unlink',
    destructive: true,
    area: 'github',
    kind: 'write',
    summary: 'Unlink the GitHub repository of a project',
    target: projectTarget,
    input: projectTarget,
    output: z.looseObject({ unlinked: z.boolean() }),
    preview: (_ctx, { projectId }) => previews.githubRepoUnlink(projectId),
    rest: { method: 'DELETE', path: PATH },
    authorize: manage,
    handler: async (_ctx, { projectId }) => service.unlinkRepo(projectId),
  }),
]);
