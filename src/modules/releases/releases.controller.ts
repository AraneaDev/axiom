import { Request, Response } from 'express';

import * as svc from './releases.service';

/**
 *
 * @param req
 * @param res
 */
export async function listReleases(req: Request, res: Response) {
  const { repoId } = req.params;
  const draft = req.query.draft !== undefined ? req.query.draft === 'true' : undefined;
  const prerelease =
    req.query.prerelease !== undefined ? req.query.prerelease === 'true' : undefined;
  res.json(await svc.listReleases(repoId, { draft, prerelease }));
}

/**
 *
 * @param req
 * @param res
 */
export async function getRelease(req: Request, res: Response) {
  const { repoId, tagName } = req.params;
  const release = await svc.getRelease(repoId, tagName);
  if (!release) {
    res.status(404).json({ error: 'Release not found' });
    return;
  }
  res.json(release);
}

/**
 *
 * @param req
 * @param res
 */
export async function createRelease(req: Request, res: Response) {
  const { repoId } = req.params;
  const release = await svc.createRelease(repoId, req.userId!, req.body);
  res.status(201).json(release);
}

/**
 *
 * @param req
 * @param res
 */
export async function updateRelease(req: Request, res: Response) {
  const { repoId, tagName } = req.params;
  res.json(await svc.updateRelease(repoId, tagName, req.body));
}

/**
 *
 * @param req
 * @param res
 */
export async function publishRelease(req: Request, res: Response) {
  const { repoId, tagName } = req.params;
  res.json(await svc.publishRelease(repoId, tagName));
}

/**
 *
 * @param req
 * @param res
 */
export async function deleteRelease(req: Request, res: Response) {
  const { repoId, tagName } = req.params;
  await svc.deleteRelease(repoId, tagName);
  res.status(204).send();
}

/**
 *
 * @param req
 * @param res
 */
export async function compareRelease(req: Request, res: Response) {
  const { repoId } = req.params;
  const { base, head } = req.query as { base: string; head: string };
  res.json(await svc.compareRelease(repoId, base, head));
}
