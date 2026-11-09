import { z } from 'zod';

import { orgMember, orgPermission, teamPermission, teamRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { inputPlace } from '../../actions/places';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import {
  addTeamMemberSchema,
  createTeamSchema,
  firstQueryText,
  queryCount,
  queryFlag,
  queryFlagSet,
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
    name: 'team.activity',
    area: 'issues',
    kind: 'read',
    summary: 'Read the latest activity of the members of a team',
    target: teamTarget,
    input: teamTarget,
    output: z.array(z.looseObject({})),
    rest: { method: 'GET', path: '/api/teams/:teamId/activity' },
    authorize: teamRead<z.infer<typeof teamTarget>>((input) => input.teamId),
    handler: async (ctx, { teamId }) => teamsService.getTeamActivity(teamId, ctx.userId),
  }),
  defineAction({
    name: 'team.memberProfile',
    area: 'issues',
    kind: 'read',
    summary: 'Read the profile of a member of a team: their work and recent activity',
    target: teamTarget,
    input: teamTarget.extend({ username: z.string() }),
    output: z.looseObject({}),
    rest: { method: 'GET', path: '/api/teams/:teamId/members/profile/:username' },
    authorize: teamRead<z.infer<typeof teamTarget>>((input) => input.teamId),
    handler: async (ctx, { teamId, username }) =>
      teamsService.getTeamMemberProfile(teamId, username, ctx.userId),
  }),
  defineAction({
    name: 'teamMember.list',
    area: 'teams',
    kind: 'read',
    summary:
      'List the members of a team with their roles: people only, or with includeBots its ' +
      'service accounts too, or with assignable the people and bots an issue can be assigned to',
    target: teamTarget,
    input: teamTarget.extend({ includeBots: queryFlag, assignable: queryFlag }),
    output: z.array(record),
    rest: { method: 'GET', path: '/api/teams/:teamId/members' },
    authorize: teamRead<z.infer<typeof teamTarget>>((input) => input.teamId),
    handler: async (_ctx, { teamId, includeBots, assignable }) =>
      teamsService.listTeamMembers(teamId, {
        includeBots: queryFlagSet(includeBots),
        assignable: queryFlagSet(assignable),
      }),
  }),
  defineAction({
    name: 'team.create',
    orgLevel: true,
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Create a team in an organization',
    target: orgTarget,
    input: orgTarget.extend(createTeamSchema.shape),
    output: record,
    preview: (_ctx, { orgId, name, slug, description }) =>
      previews.teamCreate(orgId, name, slug, description),
    rest: { method: 'POST', path: '/api/teams/org/:orgId' },
    authorize: orgPermission<z.infer<typeof orgTarget>>('team:create', (input) => input.orgId),
    handler: async (ctx, { orgId, ...data }) => teamsService.createTeam(orgId, ctx.userId, data),
  }),
  defineAction({
    name: 'team.update',
    place: inputPlace,
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
    place: inputPlace,
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
    place: inputPlace,
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Add a member of the organization to a team',
    target: teamTarget,
    input: teamTarget.extend(addTeamMemberSchema.shape),
    output: record,
    preview: (ctx, { teamId, userId, role }) =>
      previews.teamMemberAdd(ctx.userId, teamId, userId, role),
    rest: { method: 'POST', path: '/api/teams/:teamId/members' },
    authorize: manageMembers,
    handler: async (_ctx, { teamId, userId, role }) =>
      teamsService.addTeamMember(teamId, userId, role),
  }),
  defineAction({
    name: 'teamMember.update',
    place: inputPlace,
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: "Change a member's role in a team",
    target: memberTarget,
    input: memberTarget.extend({ role: teamRoleValidator }),
    output: record,
    preview: (ctx, { teamId, memberId, role }) =>
      previews.teamMemberUpdate(ctx.userId, teamId, memberId, role),
    rest: { method: 'PATCH', path: '/api/teams/:teamId/members/:memberId' },
    authorize: manageMembers,
    handler: async (_ctx, { teamId, memberId, role }) =>
      teamsService.updateTeamMemberRole(teamId, memberId, role),
  }),
  defineAction({
    name: 'teamMember.remove',
    place: inputPlace,
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Remove a member from a team',
    input: memberTarget,
    output: nothing,
    preview: (ctx, { teamId, memberId }) => previews.teamMemberRemove(ctx.userId, teamId, memberId),
    rest: { method: 'DELETE', path: '/api/teams/:teamId/members/:memberId' },
    authorize: manageMembers,
    handler: async (_ctx, { teamId, memberId }) => {
      await teamsService.removeTeamMember(teamId, memberId);
    },
  }),
]);
