import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as customFieldsService from './custom-fields.service';

export const createDefinition = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const { name, type, options, required, position } = req.body;
  if (!name || !type) {
    throw new AppError(400, 'name and type are required');
  }
  const definition = await customFieldsService.createFieldDefinition(projectId, {
    name,
    type,
    options,
    required,
    position,
  });
  res.status(201).json(definition);
});

export const listDefinitions = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const definitions = await customFieldsService.listFieldDefinitions(projectId);
  res.json(definitions);
});

export const updateDefinition = asyncHandler(async (req: Request, res: Response) => {
  const fieldId = param(req, 'fieldId');
  const { name, options, required, position } = req.body;
  const definition = await customFieldsService.updateFieldDefinition(fieldId, {
    name,
    options,
    required,
    position,
  });
  res.json(definition);
});

export const deleteDefinition = asyncHandler(async (req: Request, res: Response) => {
  const fieldId = param(req, 'fieldId');
  await customFieldsService.deleteFieldDefinition(fieldId);
  res.status(204).send();
});

export const setFieldValue = asyncHandler(async (req: Request, res: Response) => {
  const issueId = param(req, 'issueId');
  const fieldId = param(req, 'fieldId');
  const { value } = req.body;
  if (value === undefined) {
    throw new AppError(400, 'value is required');
  }
  const fieldValue = await customFieldsService.setFieldValue(issueId, fieldId, String(value));
  res.json(fieldValue);
});

export const getFieldValues = asyncHandler(async (req: Request, res: Response) => {
  const issueId = param(req, 'issueId');
  const values = await customFieldsService.getFieldValues(issueId);
  res.json(values);
});
