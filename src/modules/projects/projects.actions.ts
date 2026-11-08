import { z } from 'zod';

import { projectAction, projectRead, teamMemberWith, teamRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { inputPlace } from '../../actions/places';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { createProjectSchema, updateProjectSchema } from '../../utils/validation';

import * as projectsService from './projects.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });

const teamTarget = z.object({ teamId: z.string() });
const projectTarget = z.object({ projectId: z.string() });

// The team path comes first: it is the static one.
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
  defineAction({
    name: 'project.create',
    place: inputPlace,
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Create a project in a team',
    target: teamTarget,
    input: teamTarget.extend(createProjectSchema.shape),
    output: record,
    preview: (_ctx, { teamId, ...fields }) => previews.projectCreate(teamId, fields),
    rest: { method: 'POST', path: '/api/projects/team/:teamId' },
    authorize: teamMemberWith<z.infer<typeof teamTarget>>(
      'project:create',
      (input) => input.teamId,
    ),
    handler: async (_ctx, { teamId, ...data }) => projectsService.createProject(teamId, data),
  }),
  defineAction({
    name: 'project.update',
    place: inputPlace,
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: "Change a project's settings",
    target: projectTarget,
    input: projectTarget.extend(updateProjectSchema.shape),
    output: record,
    preview: (_ctx, { projectId, ...fields }) => previews.projectUpdate(projectId, fields),
    rest: { method: 'PATCH', path: '/api/projects/:projectId' },
    authorize: projectAction<z.infer<typeof projectTarget>>(
      'team:manage_members',
      (input) => input.projectId,
    ),
    handler: async (_ctx, { projectId, ...data }) => projectsService.updateProject(projectId, data),
  }),
  defineAction({
    name: 'project.delete',
    place: inputPlace,
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Delete a project with its issues',
    input: projectTarget,
    output: z.void(),
    preview: (_ctx, { projectId }) => previews.projectDelete(projectId),
    rest: { method: 'DELETE', path: '/api/projects/:projectId' },
    authorize: projectAction<z.infer<typeof projectTarget>>(
      'project:delete',
      (input) => input.projectId,
    ),
    handler: async (_ctx, { projectId }) => {
      await projectsService.deleteProject(projectId);
    },
  }),
]);
