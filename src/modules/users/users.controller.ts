import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';

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
