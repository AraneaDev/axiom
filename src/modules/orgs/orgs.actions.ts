import { z } from 'zod';

import { orgMember, orgPermission } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import {
  addOrgMemberSchema,
  createInviteLinkSchema,
  createOrgSchema,
  updateOrgSchema,
} from '../../utils/validation';

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

// Invite links are refused to every token: their code lets whoever holds it join. All that is
// admin waits for a person
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
    orgLevel: true,
    admin: true,
    // A new org has no rules yet: only the user's own bind this
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: 'Create an organization, with you as its owner',
    target: z.object({}),
    input: z.object(createOrgSchema.shape),
    output: record,
    preview: (_ctx, { name, slug, description }) => previews.orgCreate(name, slug, description),
    rest: { method: 'POST', path: '/api/orgs' },
    authorize: async () => {},
    handler: async (ctx, input) => orgsService.createOrg(ctx.userId, input),
  }),
  defineAction({
    name: 'org.update',
    orgLevel: true,
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
    orgLevel: true,
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
    name: 'orgMember.list',
    area: 'orgs',
    kind: 'read',
    summary: 'List the members of an organization with their roles; members only, as it has emails',
    target: orgTarget,
    input: orgTarget,
    output: z.array(record),
    rest: { method: 'GET', path: '/api/orgs/:orgId/members' },
    authorize: orgMember<z.infer<typeof orgTarget>>((input) => input.orgId),
    handler: async (_ctx, { orgId }) => orgsService.listOrgMembers(orgId),
  }),
  defineAction({
    name: 'inviteLink.list',
    tokenBlocked: true,
    area: 'orgs',
    kind: 'read',
    summary: 'List the invite links of an organization',
    target: orgTarget,
    input: orgTarget,
    output: z.array(record),
    rest: { method: 'GET', path: '/api/orgs/:orgId/invites' },
    authorize: manageMembers,
    handler: async (_ctx, { orgId }) => orgsService.listInviteLinks(orgId),
  }),
  defineAction({
    name: 'inviteLink.create',
    tokenBlocked: true,
    area: 'orgs',
    kind: 'write',
    summary:
      'Create a link that lets someone join an organization in a role no higher than your own',
    target: orgTarget,
    input: orgTarget.extend(createInviteLinkSchema.shape),
    output: record,
    rest: { method: 'POST', path: '/api/orgs/:orgId/invites' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, ...data }) =>
      orgsService.createInviteLink(orgId, ctx.userId, data),
  }),
  defineAction({
    name: 'inviteLink.delete',
    tokenBlocked: true,
    destructive: true,
    area: 'orgs',
    kind: 'write',
    summary: 'Delete an invite link of an organization',
    input: orgTarget.extend({ inviteId: z.string() }),
    output: nothing,
    preview: (_ctx, { orgId, inviteId }) => previews.inviteLinkDelete(orgId, inviteId),
    rest: { method: 'DELETE', path: '/api/orgs/:orgId/invites/:inviteId' },
    authorize: manageMembers,
    handler: async (_ctx, { orgId, inviteId }) => {
      await orgsService.deleteInviteLink(orgId, inviteId);
    },
  }),
  defineAction({
    name: 'orgMember.add',
    orgLevel: true,
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Add a user to an organization, in a role no higher than your own',
    target: orgTarget,
    input: orgTarget.extend(addOrgMemberSchema.shape),
    output: record,
    preview: (ctx, { orgId, userId, role }) =>
      previews.orgMemberAdd(ctx.userId, orgId, userId, role),
    rest: { method: 'POST', path: '/api/orgs/:orgId/members' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, userId, role }) =>
      orgsService.addOrgMember(orgId, userId, role, ctx.userId),
  }),
  defineAction({
    name: 'orgMember.update',
    orgLevel: true,
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: "Change a member's role in an organization",
    target: memberTarget,
    input: memberTarget.extend({ role: addOrgMemberSchema.shape.role }),
    output: record,
    preview: (ctx, { orgId, memberId, role }) =>
      previews.orgMemberUpdate(ctx.userId, orgId, memberId, role),
    rest: { method: 'PATCH', path: '/api/orgs/:orgId/members/:memberId' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, memberId, role }) =>
      orgsService.updateOrgMemberRole(orgId, memberId, role, ctx.userId),
  }),
  defineAction({
    name: 'orgMember.remove',
    orgLevel: true,
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Remove a member from an organization, with what the organization gave them',
    input: memberTarget,
    output: nothing,
    preview: (ctx, { orgId, memberId }) => previews.orgMemberRemove(ctx.userId, orgId, memberId),
    rest: { method: 'DELETE', path: '/api/orgs/:orgId/members/:memberId' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, memberId }) => {
      await orgsService.removeOrgMember(orgId, memberId, ctx.userId);
    },
  }),
]);
