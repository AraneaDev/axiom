import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import { createProjectSchema, updateProjectSchema } from '../../utils/validation';

import * as projectsService from './projects.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createProjectSchema.parse(req.body);
    const project = await projectsService.createProject(param(req, 'teamId'), data);
    res.status(201).json(project);
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
    const project = await projectsService.getProject(param(req, 'projectId'));
    res.json(project);
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
    const projects = await projectsService.listProjects(param(req, 'teamId'));
    res.json(projects);
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
    const data = updateProjectSchema.parse(req.body);
    const project = await projectsService.updateProject(param(req, 'projectId'), data);
    res.json(project);
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
    await projectsService.deleteProject(param(req, 'projectId'));
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
export async function analytics(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await projectsService.getProjectAnalytics(param(req, 'projectId'));
    res.json(data);
  } catch (err) {
    next(err);
  }
}
