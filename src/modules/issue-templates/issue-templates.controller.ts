import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as templatesService from './issue-templates.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, type, title, body, labels, assigneeId } = req.body;
    if (!name || !type || !title) {
      res.status(400).json({ error: { message: 'name, type, and title are required' } });
      return;
    }
    const template = await templatesService.createTemplate(param(req, 'projectId'), {
      name,
      type,
      title,
      body: body ?? '',
      labels,
      assigneeId,
    });
    res.status(201).json(template);
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
    const templates = await templatesService.listTemplates(param(req, 'projectId'));
    res.json(templates);
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
    const template = await templatesService.getTemplate(
      param(req, 'projectId'),
      param(req, 'templateId'),
    );
    res.json(template);
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
    const { name, type, title, body, labels, assigneeId } = req.body;
    const template = await templatesService.updateTemplate(
      param(req, 'projectId'),
      param(req, 'templateId'),
      { name, type, title, body, labels, assigneeId },
    );
    res.json(template);
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
    await templatesService.deleteTemplate(param(req, 'projectId'), param(req, 'templateId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
