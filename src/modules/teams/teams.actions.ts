import { z } from 'zod';

import { orgMember, orgPermission, teamPermission, teamRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import {
  addTeamMemberSchema,
  createTeamSchema,
  firstQueryText,
  queryCount,
} from '../../utils/validation';
import { teamRoleValidator } from '../../utils/validation/common-validators';

import * as teamsService from './teams.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });

const orgTarget = z.object({ orgId: z.string() });
const teamTarget = z.object({ teamId: z.string() });
const memberTarget = teamTarget.extend({ memberId: z.string() });
const nothing = z.void();

const manageMembers = teamPermission<z.infer<typeof teamTarget>>(
  'team:manage_members',
  (input) => input.teamId,
);

registerActions([
  defineAction({
    name: 'team.list',
    area: 'teams',
    kind: 'read',
    summary: 'List the teams of an organization, paged; a GUEST sees only their own teams',
    target: orgTarget,
    input: orgTarget.extend({ limit: queryCount, offset: queryCount }),
    output: z.looseObject({ data: z.array(record), total: z.number() }),
    rest: { method: 'GET', path: '/api/teams/org/:orgId' },
    authorize: orgMember<z.infer<typeof orgTarget>>((input) => input.orgId),
    handler: async (ctx, { orgId, limit, offset }) =>
      teamsService.listOrgTeams(
        orgId,
        { limit: firstQueryText(limit), offset: firstQueryText(offset) },
        ctx.userId,
      ),
  }),
  defineAction({
    name: 'team.get',
    area: 'teams',
    kind: 'read',
    summary: 'Read one team',
    target: teamTarget,
    input: teamTarget,
    output: record,
    rest: { method: 'GET', path: '/api/teams/:teamId' },
    authorize: teamRead<z.infer<typeof teamTarget>>((input) => input.teamId),
    handler: async (_ctx, { teamId }) => teamsService.getTeam(teamId),
  }),
  defineAction({
    name: 'team.create',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Create a team in an organization',
    target: orgTarget,
    input: orgTarget.extend(createTeamSchema.shape),
    output: record,
    preview: (_ctx, { orgId, name, slug }) => previews.teamCreate(orgId, name, slug),
    rest: { method: 'POST', path: '/api/teams/org/:orgId' },
    authorize: orgPermission<z.infer<typeof orgTarget>>('team:create', (input) => input.orgId),
    handler: async (ctx, { orgId, ...data }) => teamsService.createTeam(orgId, ctx.userId, data),
  }),
  defineAction({
    name: 'team.update',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Change the name or description of a team',
    target: teamTarget,
    input: teamTarget.extend({
      name: z.string().optional(),
      description: z.string().optional(),
    }),
    output: record,
    preview: (_ctx, { teamId, ...fields }) => previews.teamUpdate(teamId, fields),
    rest: { method: 'PATCH', path: '/api/teams/:teamId' },
    authorize: manageMembers,
    handler: async (_ctx, { teamId, ...data }) => teamsService.updateTeam(teamId, data),
  }),
  defineAction({
    name: 'team.delete',
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Delete a team with its projects and spaces',
    input: teamTarget,
    output: nothing,
    preview: (_ctx, { teamId }) => previews.teamDelete(teamId),
    rest: { method: 'DELETE', path: '/api/teams/:teamId' },
    authorize: teamPermission<z.infer<typeof teamTarget>>('team:delete', (input) => input.teamId),
    handler: async (_ctx, { teamId }) => {
      await teamsService.deleteTeam(teamId);
    },
  }),
  defineAction({
    name: 'teamMember.add',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Add a member of the organization to a team',
    target: teamTarget,
    input: teamTarget.extend(addTeamMemberSchema.shape),
    output: record,
    preview: (_ctx, { teamId, userId, role }) => previews.teamMemberAdd(teamId, userId, role),
    rest: { method: 'POST', path: '/api/teams/:teamId/members' },
    authorize: manageMembers,
    handler: async (_ctx, { teamId, userId, role }) =>
      teamsService.addTeamMember(teamId, userId, role),
  }),
  defineAction({
    name: 'teamMember.update',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: "Change a member's role in a team",
    target: memberTarget,
    input: memberTarget.extend({ role: teamRoleValidator }),
    output: record,
    preview: (_ctx, { teamId, memberId, role }) =>
      previews.teamMemberUpdate(teamId, memberId, role),
    rest: { method: 'PATCH', path: '/api/teams/:teamId/members/:memberId' },
    authorize: manageMembers,
    handler: async (_ctx, { teamId, memberId, role }) =>
      teamsService.updateTeamMemberRole(teamId, memberId, role),
  }),
  defineAction({
    name: 'teamMember.remove',
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Remove a member from a team',
    input: memberTarget,
    output: nothing,
    preview: (_ctx, { teamId, memberId }) => previews.teamMemberRemove(teamId, memberId),
    rest: { method: 'DELETE', path: '/api/teams/:teamId/members/:memberId' },
    authorize: manageMembers,
    handler: async (_ctx, { teamId, memberId }) => {
      await teamsService.removeTeamMember(teamId, memberId);
    },
  }),
]);
