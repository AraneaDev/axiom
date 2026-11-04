import { z } from 'zod';

import { orgMember, teamRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as teamsService from './teams.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });

const orgTarget = z.object({ orgId: z.string() });
const teamTarget = z.object({ teamId: z.string() });

// Writes to teams and their members stay legacy until plan 3 brings them behind approval (R9)
registerActions([
  defineAction({
    name: 'team.list',
    area: 'teams',
    kind: 'read',
    summary: 'List the teams of an organization, paged; a GUEST sees only their own teams',
    target: orgTarget,
    // Any query value passes, as it did before: a repeated ?limit= is read as its first number
    input: orgTarget.extend({ limit: z.unknown(), offset: z.unknown() }),
    output: z.looseObject({ data: z.array(record), total: z.number() }),
    rest: { method: 'GET', path: '/api/teams/org/:orgId' },
    authorize: orgMember<z.infer<typeof orgTarget>>((input) => input.orgId),
    handler: async (ctx, { orgId, limit, offset }) =>
      teamsService.listOrgTeams(
        orgId,
        { limit: limit as string | undefined, offset: offset as string | undefined },
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
]);
