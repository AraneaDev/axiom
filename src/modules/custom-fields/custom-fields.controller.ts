import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as customFieldsService from './custom-fields.service';

/**
 * Create a custom field definition for a project.
 * @param req
 * @param res
 * @param next
 */
export async function createDefinition(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const { name, type, options, required, position } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: { message: 'name and type are required' } });
    }
    const definition = await customFieldsService.createFieldDefinition(projectId, {
      name,
      type,
      options,
      required,
      position,
    });
    res.status(201).json(definition);
  } catch (err) {
    next(err);
  }
}

/**
 * List all custom field definitions for a project.
 * @param req
 * @param res
 * @param next
 */
export async function listDefinitions(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const definitions = await customFieldsService.listFieldDefinitions(projectId);
    res.json(definitions);
  } catch (err) {
    next(err);
  }
}

/**
 * Update a custom field definition.
 * @param req
 * @param res
 * @param next
 */
export async function updateDefinition(req: Request, res: Response, next: NextFunction) {
  try {
    const fieldId = param(req, 'fieldId');
    const { name, options, required, position } = req.body;
    const definition = await customFieldsService.updateFieldDefinition(fieldId, {
      name,
      options,
      required,
      position,
    });
    res.json(definition);
  } catch (err) {
    next(err);
  }
}

/**
 * Delete a custom field definition and all its values.
 * @param req
 * @param res
 * @param next
 */
export async function deleteDefinition(req: Request, res: Response, next: NextFunction) {
  try {
    const fieldId = param(req, 'fieldId');
    await customFieldsService.deleteFieldDefinition(fieldId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Set a custom field value for an issue.
 * @param req
 * @param res
 * @param next
 */
export async function setFieldValue(req: Request, res: Response, next: NextFunction) {
  try {
    const issueId = param(req, 'issueId');
    const fieldId = param(req, 'fieldId');
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: { message: 'value is required' } });
    }
    const fieldValue = await customFieldsService.setFieldValue(issueId, fieldId, String(value));
    res.json(fieldValue);
  } catch (err) {
    next(err);
  }
}

/**
 * Get all custom field values for an issue.
 * @param req
 * @param res
 * @param next
 */
export async function getFieldValues(req: Request, res: Response, next: NextFunction) {
  try {
    const issueId = param(req, 'issueId');
    const values = await customFieldsService.getFieldValues(issueId);
    res.json(values);
  } catch (err) {
    next(err);
  }
}
