import { Request, Response, NextFunction } from 'express';
import * as reposService from './repos.service';
import { param } from '../../utils/params';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = await reposService.createRepo(param(req, 'teamId'), req.body);
    res.status(201).json(repo);
  } catch (err) { next(err); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = await reposService.getRepo(param(req, 'repoId'));
    res.json(repo);
  } catch (err) { next(err); }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const repos = await reposService.listRepos(param(req, 'teamId'));
    res.json(repos);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = await reposService.updateRepo(param(req, 'repoId'), req.body);
    res.json(repo);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await reposService.deleteRepoById(param(req, 'repoId'));
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function fork(req: Request, res: Response, next: NextFunction) {
  try {
    const { targetTeamId, slug } = req.body;
    const repo = await reposService.forkRepoById(param(req, 'repoId'), targetTeamId, slug);
    res.status(201).json(repo);
  } catch (err) { next(err); }
}

// Branches
export async function listBranches(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getBranches(param(req, 'repoId')));
  } catch (err) { next(err); }
}

export async function getBranch(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getBranchDetail(param(req, 'repoId'), param(req, 'branchName')));
  } catch (err) { next(err); }
}

export async function createBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, startPoint } = req.body;
    res.status(201).json(await reposService.createRepoBranch(param(req, 'repoId'), name, startPoint));
  } catch (err) { next(err); }
}

export async function deleteBranch(req: Request, res: Response, next: NextFunction) {
  try {
    await reposService.deleteRepoBranch(param(req, 'repoId'), param(req, 'branchName'));
    res.status(204).send();
  } catch (err) { next(err); }
}

// Commits
export async function listCommits(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = (req.query.ref as string) || 'HEAD';
    const limit = parseInt((req.query.limit as string) || '20');
    const skip = parseInt((req.query.skip as string) || '0');
    res.json(await reposService.getCommits(param(req, 'repoId'), ref, limit, skip));
  } catch (err) { next(err); }
}

export async function getCommit(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getCommitDetail(param(req, 'repoId'), param(req, 'sha')));
  } catch (err) { next(err); }
}

// Tree / File browser
export async function getTree(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = param(req, 'ref');
    const treePath = req.params[0] || ''; // wildcard capture
    res.json(await reposService.getTree(param(req, 'repoId'), ref, treePath));
  } catch (err) { next(err); }
}

export async function getBlob(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = param(req, 'ref');
    const filePath = req.params[0] || '';
    res.json(await reposService.getBlob(param(req, 'repoId'), ref, filePath));
  } catch (err) { next(err); }
}

export async function getBlame(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = param(req, 'ref');
    const filePath = req.params[0] || '';
    res.json(await reposService.getBlame(param(req, 'repoId'), ref, filePath));
  } catch (err) { next(err); }
}

// Tags
export async function listTags(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getTags(param(req, 'repoId')));
  } catch (err) { next(err); }
}
