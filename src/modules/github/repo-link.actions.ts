import { z } from 'zod';

import { projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';

import * as service from './repo-link.service';

const link = z.looseObject({ repoFullName: z.string(), htmlUrl: z.string() });
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
    output: link.nullable(),
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
    handler: async (ctx, { projectId, repo }) => service.linkRepo(ctx.userId, projectId, repo),
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
