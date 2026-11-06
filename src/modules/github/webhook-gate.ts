import type { NextFunction, Request, Response } from 'express';

import { prisma } from '../../config/database';

import { GITHUB_APP_ROW_ID } from './github-app.service';

const SIGNATURE_SHAPE = /^sha256=[0-9a-f]{64}$/;

const refuse = (res: Response, status: number, message: string, code: string) =>
  res.status(status).json({ error: { message, code } });

/**
 * The cheap checks of a webhook call, ahead of the body parser: a caller that is going to be
 * refused is answered before the server reads up to 25 MB of body. It checks only what the
 * headers and one indexed read tell; the signature itself is checked in the action, over the
 * bytes. Anything but a POST is answered 405 here, so no body is read for it.
 * @param req The request
 * @param res The response
 * @param next Continues to the body parser
 */
export async function githubWebhookGate(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    return refuse(res, 405, 'Only POST is allowed', 'METHOD_NOT_ALLOWED');
  }
  try {
    const app = await prisma.githubApp.findUnique({
      where: { id: GITHUB_APP_ROW_ID },
      select: { id: true },
    });
    if (!app) return refuse(res, 404, 'No GitHub App is set up', 'NOT_FOUND');
    const signature = req.headers['x-hub-signature-256'];
    if (typeof signature !== 'string' || !SIGNATURE_SHAPE.test(signature)) {
      return refuse(res, 401, 'The signature does not match', 'INVALID_SIGNATURE');
    }
    if (!req.headers['x-github-event'] || !req.headers['x-github-delivery']) {
      return refuse(res, 400, 'X-GitHub-Delivery and X-GitHub-Event are required', 'BAD_REQUEST');
    }
    return next();
  } catch (err) {
    return next(err);
  }
}
