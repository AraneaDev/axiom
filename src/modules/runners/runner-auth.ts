import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';

import { prisma } from '../../config/database';

export interface RunnerRequest extends Request {
  runner?: {
    id: string;
    uuid: string;
    name: string;
    scopeType: string;
    scopeId: string;
    labels: unknown;
  };
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function authenticateRunner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const uuid = req.headers['x-runner-uuid'] as string | undefined;
  const token = req.headers['x-runner-token'] as string | undefined;

  if (!uuid || !token) {
    res.status(401).json({ error: { message: 'Missing runner credentials' } });
    return;
  }

  const runner = await prisma.runner.findUnique({ where: { uuid } });
  if (!runner) {
    res.status(401).json({ error: { message: 'Unknown runner' } });
    return;
  }

  const valid = await bcrypt.compare(token, runner.tokenHash);
  if (!valid) {
    res.status(401).json({ error: { message: 'Invalid runner token' } });
    return;
  }

  // Update lastSeenAt
  await prisma.runner.update({
    where: { id: runner.id },
    data: { lastSeenAt: new Date() },
  });

  (req as RunnerRequest).runner = {
    id: runner.id,
    uuid: runner.uuid,
    name: runner.name,
    scopeType: runner.scopeType,
    scopeId: runner.scopeId,
    labels: runner.labels,
  };

  next();
}
