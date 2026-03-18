import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import { addSshKeySchema, createApiTokenSchema } from '../../utils/validation';

import * as usersService from './users.service';

// Profile
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await usersService.getProfile(req.userId!);
    res.json(user);
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
export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await usersService.updateProfile(req.userId!, req.body);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

// SSH Keys
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listSshKeys(req: Request, res: Response, next: NextFunction) {
  try {
    const keys = await usersService.listSshKeys(req.userId!);
    res.json(keys);
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
export async function addSshKey(req: Request, res: Response, next: NextFunction) {
  try {
    const data = addSshKeySchema.parse(req.body);
    const key = await usersService.addSshKey(req.userId!, data);
    res.status(201).json(key);
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
export async function deleteSshKey(req: Request, res: Response, next: NextFunction) {
  try {
    await usersService.deleteSshKey(req.userId!, param(req, 'keyId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// API Tokens
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listApiTokens(req: Request, res: Response, next: NextFunction) {
  try {
    const tokens = await usersService.listApiTokens(req.userId!);
    res.json(tokens);
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
export async function createApiToken(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createApiTokenSchema.parse(req.body);
    const token = await usersService.createApiToken(req.userId!, data);
    res.status(201).json(token);
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
export async function deleteApiToken(req: Request, res: Response, next: NextFunction) {
  try {
    await usersService.deleteApiToken(req.userId!, param(req, 'tokenId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
