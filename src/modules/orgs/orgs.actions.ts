import { z } from 'zod';

import { orgMember } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as orgsService from './orgs.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });

const orgTarget = z.object({ orgId: z.string() });

// Writes to orgs, members and invites stay legacy until plan 3 brings them behind approval (R9)
registerActions([
  defineAction({
    name: 'org.list',
    area: 'orgs',
    kind: 'read',
    summary: 'List the organizations you belong to',
    input: z.object({}),
    output: z.array(record),
    rest: { method: 'GET', path: '/api/orgs' },
    // Only your own memberships come back
    authorize: async () => {},
    handler: async (ctx) => orgsService.listUserOrgs(ctx.userId),
  }),
  defineAction({
    name: 'org.get',
    area: 'orgs',
    kind: 'read',
    summary: 'Read one organization and its members',
    target: orgTarget,
    input: orgTarget,
    output: record,
    rest: { method: 'GET', path: '/api/orgs/:orgId' },
    authorize: orgMember<z.infer<typeof orgTarget>>((input) => input.orgId),
    handler: async (ctx, { orgId }) => orgsService.getOrg(orgId, ctx.userId),
  }),
]);
