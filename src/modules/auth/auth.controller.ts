import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import {
  validate,
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../../utils/validation';

import * as authService from './auth.service';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(registerSchema, req.body);
  const result = await authService.register(data);
  res.status(201).json(result);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(loginSchema, req.body);
  const result = await authService.login(data);
  res.json(result);
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = validate(refreshSchema, req.body);
  const result = await authService.refresh(refreshToken);
  res.json(result);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  await authService.logout(req.userId!, refreshToken);
  res.status(204).send();
});

export const enableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.enableTwoFactor(req.userId!);
  res.json(result);
});

export const verifyTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.body;
  const result = await authService.verifyAndActivateTwoFactor(req.userId!, code);
  res.json(result);
});

export const disableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.body;
  const result = await authService.disableTwoFactor(req.userId!, code);
  res.json(result);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = validate(forgotPasswordSchema, req.body);
  const result = await authService.requestPasswordReset(email);
  res.json(result);
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(resetPasswordSchema, req.body);
  const result = await authService.resetPassword(data.token, data.password);
  res.json(result);
});
