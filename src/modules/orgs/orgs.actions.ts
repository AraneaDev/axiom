import { z } from 'zod';

import { orgMember, orgPermission } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { addOrgMemberSchema, createOrgSchema, updateOrgSchema } from '../../utils/validation';

import * as orgsService from './orgs.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });

const nothing = z.void();

const orgTarget = z.object({ orgId: z.string() });
const memberTarget = orgTarget.extend({ memberId: z.string() });

const manageOrg = orgPermission<z.infer<typeof orgTarget>>('org:manage', (input) => input.orgId);
const manageMembers = orgPermission<z.infer<typeof orgTarget>>(
  'team:manage_members',
  (input) => input.orgId,
);

// Invite links stay legacy, and refused to tokens, until plan 4. All that is admin waits for a person
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
  defineAction({
    name: 'org.create',
    admin: true,
    // A new org has no rules yet: only the user's own bind this
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: 'Create an organization, with you as its owner',
    target: z.object({}),
    input: z.object(createOrgSchema.shape),
    output: record,
    preview: (_ctx, { name, slug }) => previews.orgCreate(name, slug),
    rest: { method: 'POST', path: '/api/orgs' },
    authorize: async () => {},
    handler: async (ctx, input) => orgsService.createOrg(ctx.userId, input),
  }),
  defineAction({
    name: 'org.update',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Change the name or description of an organization',
    target: orgTarget,
    input: orgTarget.extend(updateOrgSchema.shape),
    output: record,
    preview: (_ctx, { orgId, ...fields }) => previews.orgUpdate(orgId, fields),
    rest: { method: 'PATCH', path: '/api/orgs/:orgId' },
    authorize: manageOrg,
    handler: async (_ctx, { orgId, ...data }) => orgsService.updateOrg(orgId, data),
  }),
  defineAction({
    name: 'org.delete',
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Delete an organization with everything in it',
    input: orgTarget,
    output: nothing,
    preview: (_ctx, { orgId }) => previews.orgDelete(orgId),
    rest: { method: 'DELETE', path: '/api/orgs/:orgId' },
    authorize: manageOrg,
    handler: async (_ctx, { orgId }) => {
      await orgsService.deleteOrg(orgId);
    },
  }),
  defineAction({
    name: 'orgMember.add',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Add a user to an organization, in a role no higher than your own',
    target: orgTarget,
    input: orgTarget.extend(addOrgMemberSchema.shape),
    output: record,
    preview: (_ctx, { orgId, userId, role }) => previews.orgMemberAdd(orgId, userId, role),
    rest: { method: 'POST', path: '/api/orgs/:orgId/members' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, userId, role }) =>
      orgsService.addOrgMember(orgId, userId, role, ctx.userId),
  }),
  defineAction({
    name: 'orgMember.update',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: "Change a member's role in an organization",
    target: memberTarget,
    input: memberTarget.extend({ role: addOrgMemberSchema.shape.role }),
    output: record,
    preview: (_ctx, { orgId, memberId, role }) => previews.orgMemberUpdate(orgId, memberId, role),
    rest: { method: 'PATCH', path: '/api/orgs/:orgId/members/:memberId' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, memberId, role }) =>
      orgsService.updateOrgMemberRole(orgId, memberId, role, ctx.userId),
  }),
  defineAction({
    name: 'orgMember.remove',
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Remove a member from an organization, with what the organization gave them',
    input: memberTarget,
    output: nothing,
    preview: (_ctx, { orgId, memberId }) => previews.orgMemberRemove(orgId, memberId),
    rest: { method: 'DELETE', path: '/api/orgs/:orgId/members/:memberId' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, memberId }) => {
      await orgsService.removeOrgMember(orgId, memberId, ctx.userId);
    },
  }),
]);
