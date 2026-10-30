import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createApiTokenSchema } from '../../utils/validation';

import * as usersService from './users.service';

export const searchUsersHandler = asyncHandler(async (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  const users = await usersService.searchUsers(q, req.userId!);
  res.json(users);
});

// Profile
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getProfile(req.userId!);
  res.json(user);
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.updateProfile(req.userId!, req.body);
  res.json(user);
});

// Dashboard
export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const data = await usersService.getDashboard(req.userId!);
  res.json(data);
});

// API Tokens
export const listApiTokens = asyncHandler(async (req: Request, res: Response) => {
  const tokens = await usersService.listApiTokens(req.userId!);
  res.json(tokens);
});

export const createApiToken = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createApiTokenSchema, req.body);
  const token = await usersService.createApiToken(req.userId!, data);
  res.status(201).json(token);
});

export const deleteApiToken = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deleteApiToken(req.userId!, param(req, 'tokenId'));
  res.status(204).send();
});
