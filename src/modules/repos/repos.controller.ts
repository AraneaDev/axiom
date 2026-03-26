import { Request, Response } from 'express';

import { prisma } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';
import {
  validate,
  createRepoSchema,
  updateRepoSchema,
  forkRepoSchema,
  createBranchSchema,
  updateRepoSettingsSchema,
  updateFileSchema,
} from '../../utils/validation';

import * as reposService from './repos.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(createRepoSchema, req.body);
  const repo = await reposService.createRepo(param(req, 'teamId'), body);
  res.status(201).json(repo);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const repo = await reposService.getRepo(param(req, 'repoId'));
  res.json(repo);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { take, skip } = parsePagination(req.query as Record<string, string>);
  const result = await reposService.listRepos(param(req, 'teamId'), {
    limit: take,
    offset: skip,
  });
  res.json(result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updateRepoSchema, req.body);
  const repo = await reposService.updateRepo(param(req, 'repoId'), body);
  res.json(repo);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await reposService.deleteRepoById(param(req, 'repoId'));
  res.status(204).send();
});

export const fork = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(forkRepoSchema, req.body);
  const repo = await reposService.forkRepoById(param(req, 'repoId'), body.targetTeamId, body.slug);
  res.status(201).json(repo);
});

// Settings
export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updateRepoSettingsSchema, req.body);
  const repo = await reposService.updateRepoSettings(param(req, 'repoId'), body);
  res.json(repo);
});

// Branches
export const listBranches = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reposService.getBranches(param(req, 'repoId')));
});

export const getBranch = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reposService.getBranchDetail(param(req, 'repoId'), param(req, 'branchName')));
});

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(createBranchSchema, req.body);
  res
    .status(201)
    .json(await reposService.createRepoBranch(param(req, 'repoId'), body.name, body.startPoint));
});

export const deleteBranch = asyncHandler(async (req: Request, res: Response) => {
  await reposService.deleteRepoBranch(param(req, 'repoId'), param(req, 'branchName'));
  res.status(204).send();
});

// Commits
export const listCommits = asyncHandler(async (req: Request, res: Response) => {
  const ref = (req.query.ref as string) || 'HEAD';
  const limit = Math.max(1, Math.min(parseInt((req.query.limit as string) || '20', 10) || 20, 100));
  const skip = Math.max(0, parseInt((req.query.skip as string) || '0', 10) || 0);
  const filePath = (req.query.path as string) || undefined;
  res.json(await reposService.getCommits(param(req, 'repoId'), ref, limit, skip, filePath));
});

export const getCommit = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reposService.getCommitDetail(param(req, 'repoId'), param(req, 'sha')));
});

// Tree / File browser
export const getTree = asyncHandler(async (req: Request, res: Response) => {
  const ref = param(req, 'ref');
  const treePath = req.params[0] || ''; // wildcard capture
  res.json(await reposService.getTree(param(req, 'repoId'), ref, treePath));
});

export const getBlob = asyncHandler(async (req: Request, res: Response) => {
  const ref = param(req, 'ref');
  const filePath = req.params[0] || '';
  res.json(await reposService.getBlob(param(req, 'repoId'), ref, filePath));
});

export const getBlame = asyncHandler(async (req: Request, res: Response) => {
  const ref = param(req, 'ref');
  const filePath = req.params[0] || '';
  res.json(await reposService.getBlame(param(req, 'repoId'), ref, filePath));
});

// Tags
export const listTags = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reposService.getTags(param(req, 'repoId')));
});

// File editor
export const updateBlob = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateFileSchema, req.body);
  const filePath = req.params[0];
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { displayName: true, email: true },
  });
  const result = await reposService.updateFile(
    param(req, 'repoId'),
    filePath,
    data.content,
    data.message,
    data.branch,
    user!.displayName,
    user!.email,
  );
  res.json(result);
});
