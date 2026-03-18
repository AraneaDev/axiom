import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as reposService from './repos.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = await reposService.createRepo(param(req, 'teamId'), req.body);
    res.status(201).json(repo);
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
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = await reposService.getRepo(param(req, 'repoId'));
    res.json(repo);
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
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    const result = await reposService.listRepos(param(req, 'teamId'), { limit, offset });
    res.json(result);
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
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = await reposService.updateRepo(param(req, 'repoId'), req.body);
    res.json(repo);
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
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await reposService.deleteRepoById(param(req, 'repoId'));
    res.status(204).send();
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
export async function fork(req: Request, res: Response, next: NextFunction) {
  try {
    const { targetTeamId, slug } = req.body;
    const repo = await reposService.forkRepoById(param(req, 'repoId'), targetTeamId, slug);
    res.status(201).json(repo);
  } catch (err) {
    next(err);
  }
}

// Settings
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = await reposService.updateRepoSettings(param(req, 'repoId'), req.body);
    res.json(repo);
  } catch (err) {
    next(err);
  }
}

// Branches
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listBranches(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getBranches(param(req, 'repoId')));
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
export async function getBranch(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getBranchDetail(param(req, 'repoId'), param(req, 'branchName')));
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
export async function createBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, startPoint } = req.body;
    res
      .status(201)
      .json(await reposService.createRepoBranch(param(req, 'repoId'), name, startPoint));
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
export async function deleteBranch(req: Request, res: Response, next: NextFunction) {
  try {
    await reposService.deleteRepoBranch(param(req, 'repoId'), param(req, 'branchName'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Commits
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listCommits(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = (req.query.ref as string) || 'HEAD';
    const limit = parseInt((req.query.limit as string) || '20');
    const skip = parseInt((req.query.skip as string) || '0');
    const filePath = (req.query.path as string) || undefined;
    res.json(await reposService.getCommits(param(req, 'repoId'), ref, limit, skip, filePath));
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
export async function getCommit(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getCommitDetail(param(req, 'repoId'), param(req, 'sha')));
  } catch (err) {
    next(err);
  }
}

// Tree / File browser
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getTree(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = param(req, 'ref');
    const treePath = req.params[0] || ''; // wildcard capture
    res.json(await reposService.getTree(param(req, 'repoId'), ref, treePath));
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
export async function getBlob(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = param(req, 'ref');
    const filePath = req.params[0] || '';
    res.json(await reposService.getBlob(param(req, 'repoId'), ref, filePath));
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
export async function getBlame(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = param(req, 'ref');
    const filePath = req.params[0] || '';
    res.json(await reposService.getBlame(param(req, 'repoId'), ref, filePath));
  } catch (err) {
    next(err);
  }
}

// Tags
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listTags(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reposService.getTags(param(req, 'repoId')));
  } catch (err) {
    next(err);
  }
}
