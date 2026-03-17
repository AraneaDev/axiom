import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { registerSchema, loginSchema, refreshSchema } from '../../utils/validation';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function enableTwoFactor(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.enableTwoFactor(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyTwoFactor(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.body;
    const result = await authService.verifyAndActivateTwoFactor(req.userId!, code);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function disableTwoFactor(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.body;
    const result = await authService.disableTwoFactor(req.userId!, code);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
