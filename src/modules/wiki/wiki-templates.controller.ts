import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import { validate, createPageTemplateSchema } from '../../utils/validation';

import * as svc from './wiki-templates.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(createPageTemplateSchema, req.body);
    const template = await svc.createTemplate(param(req, 'spaceId'), data);
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
export async function listTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    const templates = await svc.listTemplates(param(req, 'spaceId'));
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
export async function getTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const template = await svc.getTemplate(param(req, 'templateId'));
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
export async function deleteTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deleteTemplate(param(req, 'templateId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
