import { z } from 'zod';

import { projectRead, teamRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as projectsService from './projects.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });

const teamTarget = z.object({ teamId: z.string() });
const projectTarget = z.object({ projectId: z.string() });

// Creating, changing and deleting projects stay legacy until plan 3 brings them behind approval
// (R9). The team path comes first: it is the static one.
registerActions([
  defineAction({
    name: 'project.list',
    area: 'projects',
    kind: 'read',
    summary: 'List the projects of a team',
    target: teamTarget,
    input: teamTarget,
    output: z.array(record),
    rest: { method: 'GET', path: '/api/projects/team/:teamId' },
    authorize: teamRead<z.infer<typeof teamTarget>>((input) => input.teamId),
    handler: async (_ctx, { teamId }) => projectsService.listProjects(teamId),
  }),
  defineAction({
    name: 'project.get',
    area: 'projects',
    kind: 'read',
    summary: 'Read one project',
    target: projectTarget,
    input: projectTarget,
    output: record,
    rest: { method: 'GET', path: '/api/projects/:projectId' },
    authorize: projectRead<z.infer<typeof projectTarget>>((input) => input.projectId),
    handler: async (_ctx, { projectId }) => projectsService.getProject(projectId),
  }),
]);
