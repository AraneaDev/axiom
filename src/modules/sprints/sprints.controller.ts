import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as sprintsService from './sprints.service';

/**
 * Create a new sprint.
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.createSprint(param(req, 'projectId'), req.body);
    res.status(201).json(sprint);
  } catch (err) {
    next(err);
  }
}

/**
 * List sprints for a project.
 * @param req
 * @param res
 * @param next
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const sprints = await sprintsService.listSprints(param(req, 'projectId'), {
      status: req.query.status as string | undefined,
    });
    res.json(sprints);
  } catch (err) {
    next(err);
  }
}

/**
 * Get a single sprint.
 * @param req
 * @param res
 * @param next
 */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.getSprint(param(req, 'sprintId'));
    res.json(sprint);
  } catch (err) {
    next(err);
  }
}

/**
 * Update a sprint.
 * @param req
 * @param res
 * @param next
 */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.updateSprint(param(req, 'sprintId'), req.body);
    res.json(sprint);
  } catch (err) {
    next(err);
  }
}

/**
 * Start a sprint.
 * @param req
 * @param res
 * @param next
 */
export async function start(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.startSprint(param(req, 'sprintId'));
    res.json(sprint);
  } catch (err) {
    next(err);
  }
}

/**
 * Complete a sprint.
 * @param req
 * @param res
 * @param next
 */
export async function complete(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.completeSprint(
      param(req, 'sprintId'),
      req.body.moveToSprintId,
    );
    res.json(sprint);
  } catch (err) {
    next(err);
  }
}

/**
 * Add issues to a sprint.
 * @param req
 * @param res
 * @param next
 */
export async function addIssues(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.addIssuesToSprint(
      param(req, 'sprintId'),
      req.body.issueIds,
    );
    res.json(sprint);
  } catch (err) {
    next(err);
  }
}

/**
 * Remove an issue from a sprint.
 * @param req
 * @param res
 * @param next
 */
export async function removeIssue(req: Request, res: Response, next: NextFunction) {
  try {
    await sprintsService.removeIssueFromSprint(param(req, 'issueId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Get velocity data for a project.
 * @param req
 * @param res
 * @param next
 */
export async function velocity(req: Request, res: Response, next: NextFunction) {
  try {
    const count = req.query.count ? parseInt(req.query.count as string) : undefined;
    const data = await sprintsService.getVelocity(param(req, 'projectId'), count);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * Get backlog issues (no sprint assigned).
 * @param req
 * @param res
 * @param next
 */
export async function backlog(req: Request, res: Response, next: NextFunction) {
  try {
    const issues = await sprintsService.getBacklog(param(req, 'projectId'));
    res.json(issues);
  } catch (err) {
    next(err);
  }
}
