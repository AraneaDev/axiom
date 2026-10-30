import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import {
  validate,
  createOrgSchema,
  updateOrgSchema,
  addOrgMemberSchema,
  createInviteLinkSchema,
} from '../../utils/validation';

import * as orgsService from './orgs.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createOrgSchema, req.body);
  const org = await orgsService.createOrg(req.userId!, data);
  res.status(201).json(org);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const org = await orgsService.getOrg(param(req, 'orgId'), req.userId!);
  res.json(org);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const orgs = await orgsService.listUserOrgs(req.userId!);
  res.json(orgs);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateOrgSchema, req.body);
  const org = await orgsService.updateOrg(param(req, 'orgId'), data);
  res.json(org);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await orgsService.deleteOrg(param(req, 'orgId'));
  res.status(204).send();
});

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const members = await orgsService.listOrgMembers(param(req, 'orgId'));
  res.json(members);
});

export const addMember = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role } = validate(addOrgMemberSchema, req.body);
  const member = await orgsService.addOrgMember(param(req, 'orgId'), userId, role, req.userId!);
  res.status(201).json(member);
});

export const updateMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const { role } = validate(addOrgMemberSchema.pick({ role: true }), req.body);
  const member = await orgsService.updateOrgMemberRole(
    param(req, 'orgId'),
    param(req, 'memberId'),
    role,
    req.userId!,
  );
  res.json(member);
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  await orgsService.removeOrgMember(param(req, 'orgId'), param(req, 'memberId'), req.userId!);
  res.status(204).send();
});

// Invite Links
export const createInvite = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createInviteLinkSchema, req.body);
  const invite = await orgsService.createInviteLink(param(req, 'orgId'), req.userId!, data);
  res.status(201).json(invite);
});

export const listInvites = asyncHandler(async (req: Request, res: Response) => {
  const invites = await orgsService.listInviteLinks(param(req, 'orgId'));
  res.json(invites);
});

export const deleteInvite = asyncHandler(async (req: Request, res: Response) => {
  await orgsService.deleteInviteLink(param(req, 'orgId'), param(req, 'inviteId'));
  res.status(204).send();
});
