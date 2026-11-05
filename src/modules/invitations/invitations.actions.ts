import { z } from 'zod';

import { orgPermission } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { createInvitationSchema } from '../../utils/validation';

import * as invitationsService from './invitations.service';

const record = z.looseObject({ id: z.string() });

const orgTarget = z.object({ orgId: z.string() });
const invitationTarget = orgTarget.extend({ invitationId: z.string() });

const manageMembers = orgPermission<z.infer<typeof orgTarget>>(
  'team:manage_members',
  (input) => input.orgId,
);

/**
 * An invitation without its token, which lets whoever holds it join: it stays with the person who
 * approved the run, and out of what is stored and what the agent reads (A4).
 * @param invitation - The invitation
 * @param invitation.token - What gets left out
 */
function withoutToken({ token: _token, ...rest }: Record<string, unknown>) {
  return rest;
}

// Accepting an invitation stays legacy until plan 4. Everyone who may manage members reads these
registerActions([
  defineAction({
    name: 'invitation.list',
    admin: true,
    area: 'admin',
    kind: 'read',
    summary: 'List the invitations of an organization, optionally of one team',
    target: orgTarget,
    input: orgTarget.extend({ teamId: z.string().optional() }),
    output: z.array(record),
    preview: (_ctx, { orgId, teamId }) => previews.invitationList(orgId, teamId),
    redactResult: (result) => result.map(withoutToken),
    rest: { method: 'GET', path: '/api/orgs/:orgId/invitations' },
    authorize: manageMembers,
    handler: async (_ctx, { orgId, teamId }) => invitationsService.listInvitations(orgId, teamId),
  }),
  defineAction({
    name: 'invitation.create',
    admin: true,
    area: 'admin',
    kind: 'write',
    summary: 'Invite someone by email to an organization, and optionally to one of its teams',
    target: orgTarget,
    input: orgTarget.extend(createInvitationSchema.shape),
    output: record,
    preview: (_ctx, { orgId, email, role, teamId }) =>
      previews.invitationCreate(orgId, email, role, teamId),
    redactResult: withoutToken,
    rest: { method: 'POST', path: '/api/orgs/:orgId/invitations' },
    authorize: manageMembers,
    handler: async (ctx, { orgId, ...data }) =>
      invitationsService.createInvitation(orgId, ctx.userId, data),
  }),
  defineAction({
    name: 'invitation.revoke',
    admin: true,
    destructive: true,
    area: 'admin',
    kind: 'write',
    summary: 'Revoke a pending invitation',
    input: invitationTarget,
    output: z.void(),
    preview: (_ctx, { orgId, invitationId }) => previews.invitationRevoke(orgId, invitationId),
    rest: { method: 'DELETE', path: '/api/orgs/:orgId/invitations/:invitationId' },
    authorize: manageMembers,
    handler: async (_ctx, { orgId, invitationId }) => {
      await invitationsService.revokeInvitation(invitationId, orgId);
    },
  }),
]);
