import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as invitationsService from './invitations.service';

/**
 * Create an invitation to join an org (and optionally a team).
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, role, teamId } = req.body;
    const invitation = await invitationsService.createInvitation(param(req, 'orgId'), req.userId!, {
      email,
      role,
      teamId,
    });
    res.status(201).json(invitation);
  } catch (err) {
    next(err);
  }
}

/**
 * List invitations for an org, optionally filtered by teamId query param.
 * @param req
 * @param res
 * @param next
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const teamId = req.query.teamId as string | undefined;
    const invitations = await invitationsService.listInvitations(param(req, 'orgId'), teamId);
    res.json(invitations);
  } catch (err) {
    next(err);
  }
}

/**
 * Revoke a pending invitation.
 * @param req
 * @param res
 * @param next
 */
export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    await invitationsService.revokeInvitation(param(req, 'id'), param(req, 'orgId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Accept an invitation by token (requires auth).
 * @param req
 * @param res
 * @param next
 */
export async function accept(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await invitationsService.acceptInvitation(param(req, 'token'), req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
