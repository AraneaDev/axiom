import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { AppError } from '../../middleware/errorHandler';
import { assertAuthor } from '../../utils/assert-author';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import { notifyMentions } from '../../utils/mention-notifier';
import { parseServicePagination } from '../../utils/pagination';
import { getRepoDisk } from '../../utils/repo-disk';
import { logActivity } from '../activity/activity.service';

const execFileAsync = promisify(execFile);

const SUGGESTION_RE = /```suggestion\n([\s\S]*?)```/;

function extractSuggestion(body: string): string | null {
  const match = body.match(SUGGESTION_RE);
  return match ? match[1] : null;
}

/**
 * Add a comment to a pull request, optionally anchored to a file and line.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param authorId - The user authoring the comment
 * @param data - Comment data including body, optional filePath and line number
 * @param data.body
 * @param data.filePath
 * @param data.line
 * @param data.parentId
 * @returns The created PR comment record
 * @throws {AppError} 404 if PR not found
 */
export async function addPRComment(
  repoId: string,
  prNumber: number,
  authorId: string,
  data: {
    body: string;
    filePath?: string;
    line?: number;
    parentId?: string;
  },
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  if (data.parentId) {
    const parent = await prisma.pRComment.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.prId !== pr.id) throw new AppError(400, 'Invalid parent comment');
    data.filePath = parent.filePath ?? undefined;
    data.line = parent.line ?? undefined;
  }

  const comment = await prisma.pRComment.create({
    data: {
      prId: pr.id,
      authorId,
      body: data.body,
      filePath: data.filePath,
      line: data.line,
      parentId: data.parentId,
    },
  });

  // Notify @mentioned users in the PR comment
  notifyMentions(data.body, authorId).catch((err) => {
    logger.error('Failed to send mention notifications', undefined, err as Error);
  });

  return comment;
}

/**
 * List comments on a pull request, ordered chronologically.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param opts - Pagination options (limit, offset)
 * @param opts.limit
 * @param opts.offset
 * @returns List of PR comment records
 * @throws {AppError} 404 if PR not found
 */
export async function listPRComments(
  repoId: string,
  prNumber: number,
  opts?: { limit?: number; offset?: number },
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  const { take, skip } = parseServicePagination(opts, 100);
  return prisma.pRComment.findMany({
    where: { prId: pr.id },
    orderBy: { createdAt: 'asc' },
    take,
    skip,
  });
}

/**
 * Update a PR comment (only the author may edit).
 * @param commentId - The comment to update
 * @param userId - The user attempting the update
 * @param body - The new comment body text
 * @returns The updated PR comment record
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 403 if user is not the comment author
 */
export async function updatePRComment(commentId: string, userId: string, body: string) {
  const comment = await findOrThrow(
    prisma.pRComment.findUnique({ where: { id: commentId } }),
    ERR.COMMENT_NOT_FOUND,
  );
  assertAuthor(comment, userId, 'edit');

  return prisma.pRComment.update({
    where: { id: commentId },
    data: { body },
  });
}

/**
 * Delete a PR comment (only the author may delete).
 * @param commentId - The comment to delete
 * @param userId - The user attempting the deletion
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 403 if user is not the comment author
 */
export async function deletePRComment(commentId: string, userId: string) {
  const comment = await findOrThrow(
    prisma.pRComment.findUnique({ where: { id: commentId } }),
    ERR.COMMENT_NOT_FOUND,
  );
  assertAuthor(comment, userId, 'delete');

  await prisma.pRComment.delete({ where: { id: commentId } });
}

/**
 * Apply a single code suggestion from a PR comment by replacing lines and committing to the source branch.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param commentId - The comment containing the suggestion block
 * @param userId - The user applying the suggestion
 * @returns Object indicating the suggestion was applied
 * @throws {AppError} 404 if PR or comment not found
 * @throws {AppError} 400 if PR is not open, comment has no file reference, or no suggestion block
 */
export async function applySuggestion(
  repoId: string,
  prNumber: number,
  commentId: string,
  userId: string,
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );
  if (pr.status !== 'OPEN') throw new AppError(400, 'Can only apply suggestions on open PRs');

  const comment = await findOrThrow(
    prisma.pRComment.findUnique({ where: { id: commentId } }),
    ERR.COMMENT_NOT_FOUND,
  );
  if (!comment.filePath || comment.line == null) {
    throw new AppError(400, 'Comment does not reference a file location');
  }

  const suggestion = extractSuggestion(comment.body);
  if (!suggestion) throw new AppError(400, 'Comment does not contain a suggestion block');

  const { diskPath } = await getRepoDisk(repoId);

  if (!(await gitCmd.branchExists(diskPath, pr.sourceBranch))) {
    throw new AppError(400, 'Source branch no longer exists');
  }

  // Read the current file content from the source branch
  let fileContent: string;
  try {
    fileContent = await gitCmd.showBlob(diskPath, pr.sourceBranch, comment.filePath);
  } catch {
    throw new AppError(400, `File '${comment.filePath}' not found on source branch`);
  }

  const lines = fileContent.split('\n');
  const lineIndex = comment.line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new AppError(400, 'Comment line is out of range');
  }

  // Count how many lines the suggestion replaces (default: 1 line)
  const suggestionLines = suggestion.endsWith('\n')
    ? suggestion.slice(0, -1).split('\n')
    : suggestion.split('\n');

  // Replace the single line with the suggestion content
  lines.splice(lineIndex, 1, ...suggestionLines);
  const newContent = lines.join('\n');

  // Apply via a temporary worktree
  await applyFileChange(
    diskPath,
    pr.sourceBranch,
    comment.filePath,
    newContent,
    'Apply suggestion from code review',
  );

  await logActivity('pull_request', pr.id, 'suggestion_applied', userId, {
    commentId,
    filePath: comment.filePath,
  });

  return { applied: true, commentId };
}

/**
 * Apply multiple code suggestions from PR comments as a single commit on the source branch.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param commentIds - Array of comment IDs containing suggestion blocks
 * @param userId - The user applying the suggestions
 * @returns Object with applied flag and count of suggestions applied
 * @throws {AppError} 404 if PR or any comment not found
 * @throws {AppError} 400 if PR is not open, any comment lacks a file reference or suggestion block
 */
export async function batchApplySuggestions(
  repoId: string,
  prNumber: number,
  commentIds: string[],
  userId: string,
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );
  if (pr.status !== 'OPEN') throw new AppError(400, 'Can only apply suggestions on open PRs');

  if (!commentIds.length) throw new AppError(400, 'No comment IDs provided');

  const comments = await prisma.pRComment.findMany({
    where: { id: { in: commentIds } },
    orderBy: { line: 'desc' }, // Process bottom-up so line numbers stay valid
  });

  if (comments.length !== commentIds.length) {
    throw new AppError(404, 'One or more comments not found');
  }

  const { diskPath } = await getRepoDisk(repoId);

  if (!(await gitCmd.branchExists(diskPath, pr.sourceBranch))) {
    throw new AppError(400, 'Source branch no longer exists');
  }

  // Group suggestions by file, then apply bottom-up within each file
  const fileChanges = new Map<string, { line: number; suggestion: string; commentId: string }[]>();
  for (const comment of comments) {
    if (!comment.filePath || comment.line == null) {
      throw new AppError(400, `Comment ${comment.id} does not reference a file location`);
    }
    const suggestion = extractSuggestion(comment.body);
    if (!suggestion) {
      throw new AppError(400, `Comment ${comment.id} does not contain a suggestion block`);
    }
    const existing = fileChanges.get(comment.filePath) ?? [];
    existing.push({ line: comment.line, suggestion, commentId: comment.id });
    fileChanges.set(comment.filePath, existing);
  }

  // Build the set of file path -> new content
  const filePatchMap = new Map<string, string>();
  for (const [filePath, changes] of fileChanges) {
    let fileContent: string;
    try {
      fileContent = await gitCmd.showBlob(diskPath, pr.sourceBranch, filePath);
    } catch {
      throw new AppError(400, `File '${filePath}' not found on source branch`);
    }

    const lines = fileContent.split('\n');
    // Sort descending by line so earlier replacements don't shift later ones
    const sorted = [...changes].sort((a, b) => b.line - a.line);
    for (const change of sorted) {
      const lineIndex = change.line - 1;
      if (lineIndex < 0 || lineIndex >= lines.length) {
        throw new AppError(400, `Line ${change.line} out of range in ${filePath}`);
      }
      const suggestionLines = change.suggestion.endsWith('\n')
        ? change.suggestion.slice(0, -1).split('\n')
        : change.suggestion.split('\n');
      lines.splice(lineIndex, 1, ...suggestionLines);
    }
    filePatchMap.set(filePath, lines.join('\n'));
  }

  const count = commentIds.length;
  const message = `Apply ${count} suggestions from code review`;

  // Apply all file changes in a single commit
  await applyMultiFileChanges(diskPath, pr.sourceBranch, filePatchMap, message);

  await logActivity('pull_request', pr.id, 'suggestions_batch_applied', userId, {
    count,
    commentIds,
  });

  return { applied: true, count };
}

/**
 * Helper: apply a single file change as a commit on a branch in a bare repo.
 * @param diskPath
 * @param branch
 * @param filePath
 * @param newContent
 * @param message
 */
async function applyFileChange(
  diskPath: string,
  branch: string,
  filePath: string,
  newContent: string,
  message: string,
): Promise<void> {
  const patchMap = new Map<string, string>();
  patchMap.set(filePath, newContent);
  await applyMultiFileChanges(diskPath, branch, patchMap, message);
}

/**
 * Helper: apply multiple file changes as a single commit on a branch in a bare repo.
 * @param diskPath
 * @param branch
 * @param fileChanges
 * @param message
 */
async function applyMultiFileChanges(
  diskPath: string,
  branch: string,
  fileChanges: Map<string, string>,
  message: string,
): Promise<void> {
  const worktreeDir = path.join(diskPath, '..', `_suggestion_${Date.now()}`);
  try {
    await execFileAsync('git', ['worktree', 'add', worktreeDir, branch], {
      cwd: diskPath,
    });

    // Write the new file contents
    for (const [filePath, content] of fileChanges) {
      const fullPath = path.join(worktreeDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      await execFileAsync('git', ['-C', worktreeDir, 'add', filePath]);
    }

    // Commit
    await execFileAsync('git', [
      '-C',
      worktreeDir,
      '-c',
      'user.name=Axiom',
      '-c',
      'user.email=axiom@local',
      'commit',
      '-m',
      message,
    ]);

    // Update the bare repo ref
    const newHead = (
      await execFileAsync('git', ['-C', worktreeDir, 'rev-parse', 'HEAD'])
    ).stdout.trim();
    await execFileAsync('git', ['update-ref', `refs/heads/${branch}`, newHead], {
      cwd: diskPath,
    });
  } finally {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreeDir], {
      cwd: diskPath,
    }).catch((err) => {
      logger.error('Failed to remove suggestion worktree', undefined, err as Error);
    });
    await fs.rm(worktreeDir, { recursive: true, force: true }).catch((err) => {
      logger.error('Failed to clean up suggestion worktree directory', undefined, err as Error);
    });
  }
}
