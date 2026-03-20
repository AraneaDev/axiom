import { git } from './git-core';

export interface TagInfo {
  name: string;
  sha: string;
}

/**
 *
 * @param repoPath
 */
export async function listTags(repoPath: string): Promise<TagInfo[]> {
  const stdout = await git(
    ['for-each-ref', '--format=%(refname:short) %(objectname:short)', 'refs/tags/'],
    { cwd: repoPath },
  );
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [name, sha] = line.split(' ');
      return { name, sha };
    });
}

/**
 *
 * @param repoPath
 * @param tagName
 * @param sha
 * @param message
 */
export async function createTag(
  repoPath: string,
  tagName: string,
  sha: string,
  message?: string,
): Promise<void> {
  if (message) {
    await git(
      [
        '-c',
        'user.name=Axiom',
        '-c',
        'user.email=axiom@local',
        'tag',
        '-a',
        tagName,
        sha,
        '-m',
        message,
      ],
      { cwd: repoPath },
    );
  } else {
    await git(['tag', tagName, sha], { cwd: repoPath });
  }
}

/**
 *
 * @param repoPath
 * @param tagName
 */
export async function deleteTag(repoPath: string, tagName: string): Promise<void> {
  await git(['tag', '-d', tagName], { cwd: repoPath });
}
