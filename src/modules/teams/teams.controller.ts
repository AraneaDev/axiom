import { TeamRole } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import { createTeamSchema, addTeamMemberSchema } from '../../utils/validation';

import * as teamsService from './teams.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createTeamSchema.parse(req.body);
    const team = await teamsService.createTeam(param(req, 'orgId'), req.userId!, data);
    res.status(201).json(team);
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
    const team = await teamsService.getTeam(param(req, 'teamId'));
    res.json(team);
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
    const teams = await teamsService.listOrgTeams(
      param(req, 'orgId'),
      req.query as Record<string, string>,
    );
    res.json(teams);
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
    const { name, description } = req.body;
    if (name !== undefined && typeof name !== 'string') {
      res.status(400).json({ error: { message: 'name must be a string' } });
      return;
    }
    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({ error: { message: 'description must be a string' } });
      return;
    }
    const team = await teamsService.updateTeam(param(req, 'teamId'), { name, description });
    res.json(team);
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
    await teamsService.deleteTeam(param(req, 'teamId'));
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
    const members = await teamsService.listTeamMembers(param(req, 'teamId'));
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
    const data = addTeamMemberSchema.parse(req.body);
    const member = await teamsService.addTeamMember(
      param(req, 'teamId'),
      data.userId,
      data.role as TeamRole,
    );
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
    const member = await teamsService.updateTeamMemberRole(
      param(req, 'teamId'),
      param(req, 'memberId'),
      req.body.role,
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
    await teamsService.removeTeamMember(param(req, 'teamId'), param(req, 'memberId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
