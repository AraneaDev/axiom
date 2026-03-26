import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import {
  createOrgSchema,
  updateOrgSchema,
  addOrgMemberSchema,
  createInviteLinkSchema,
} from '../../utils/validation';

import * as orgsService from './orgs.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createOrgSchema.parse(req.body);
    const org = await orgsService.createOrg(req.userId!, data);
    res.status(201).json(org);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await orgsService.getOrg(param(req, 'orgId'));
    res.json(org);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const orgs = await orgsService.listUserOrgs(req.userId!);
    res.json(orgs);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateOrgSchema.parse(req.body);
    const org = await orgsService.updateOrg(param(req, 'orgId'), data);
    res.json(org);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await orgsService.deleteOrg(param(req, 'orgId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const members = await orgsService.listOrgMembers(param(req, 'orgId'));
    res.json(members);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function addMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, role } = addOrgMemberSchema.parse(req.body);
    const member = await orgsService.addOrgMember(param(req, 'orgId'), userId, role);
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function updateMemberRole(req: Request, res: Response, next: NextFunction) {
  try {
    const { role } = addOrgMemberSchema.pick({ role: true }).parse(req.body);
    const member = await orgsService.updateOrgMemberRole(
      param(req, 'orgId'),
      param(req, 'memberId'),
      role,
    );
    res.json(member);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    await orgsService.removeOrgMember(param(req, 'orgId'), param(req, 'memberId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Invite Links
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createInviteLinkSchema.parse(req.body);
    const invite = await orgsService.createInviteLink(param(req, 'orgId'), req.userId!, data);
    res.status(201).json(invite);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listInvites(req: Request, res: Response, next: NextFunction) {
  try {
    const invites = await orgsService.listInviteLinks(param(req, 'orgId'));
    res.json(invites);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deleteInvite(req: Request, res: Response, next: NextFunction) {
  try {
    await orgsService.deleteInviteLink(param(req, 'inviteId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
