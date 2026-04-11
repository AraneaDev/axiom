import { execFile } from 'child_process';
import { promisify } from 'util';

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { repoExists } from '../../git/repo-manager';
import { TEAM_ORG_SELECT } from '../../utils/prisma-selects';

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────

interface CodeSearchParams {
  q: string;
  repoIds?: string;
  limit: number;
  userId?: string;
}

export interface CodeMatch {
  repoId: string;
  repoName: string;
  repoUrl: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

// ─── Constants ──────────────────────────────────────────────

const MAX_MATCHES_PER_REPO = 10;

// ─── Code Search (git grep) ────────────────────────────────

/**
 * Search code across repositories using git grep, returning matching lines with file paths.
 * @param params - Code search parameters including query, optional repo IDs filter, and limit
 * @returns Search results with matching code lines, file paths, and line numbers
 */
export async function searchCode(
  params: CodeSearchParams,
): Promise<{ type: string; items: CodeMatch[]; total: number }> {
  const repoFilter: Prisma.RepositoryWhereInput = {};
  if (params.repoIds) {
    repoFilter.id = { in: params.repoIds.split(',').map((s) => s.trim()) };
  }
  // Scope to repos the user has access to via team membership
  if (params.userId) {
    repoFilter.team = {
      members: { some: { userId: params.userId } },
    };
  }

  const repos = await prisma.repository.findMany({
    where: repoFilter,
    include: {
      team: { select: TEAM_ORG_SELECT },
    },
    take: 20, // limit repos to search
  });

  const allMatches: CodeMatch[] = [];

  for (const repo of repos) {
    if (allMatches.length >= params.limit) break;
    if (!repo.diskPath) continue;

    const exists = await repoExists(repo.diskPath);
    if (!exists) continue;

    try {
      const remaining = Math.min(MAX_MATCHES_PER_REPO, params.limit - allMatches.length);
      const { stdout } = await execFileAsync(
        'git',
        [
          '--no-pager',
          'grep',
          '-n', // line numbers
          '-I', // skip binary files
          '--max-count',
          String(remaining),
          '-e',
          params.q,
          'HEAD',
          '--',
        ],
        {
          cwd: repo.diskPath,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        },
      );

      const repoUrl = `/${repo.team.org.slug}/${repo.team.slug}/repos/${repo.slug}`;
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        // Format: HEAD:path/to/file:lineNum:content
        const match = line.match(/^HEAD:(.+?):(\d+):(.*)$/);
        if (match) {
          allMatches.push({
            repoId: repo.id,
            repoName: repo.name,
            repoUrl,
            filePath: match[1],
            lineNumber: parseInt(match[2], 10),
            lineContent: match[3],
          });
        }
      }
    } catch {
      // git grep exits with 1 when no matches found -- ignore
    }
  }

  return {
    type: 'code',
    items: allMatches.slice(0, params.limit),
    total: allMatches.length,
  };
}
