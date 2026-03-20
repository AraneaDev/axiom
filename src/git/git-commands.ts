// Barrel re-export: all git command modules
// Consumers can continue to import from this file for backward compatibility.

export { validateRef, validateSha } from './git-core';
export { listBranches, branchExists, createBranch, deleteBranch } from './git-branch-commands';
export type { BranchInfo } from './git-branch-commands';
export {
  log,
  getCommit,
  commitCount,
  lsTree,
  showBlob,
  blobSize,
  blame,
  resolveRef,
} from './git-log-commands';
export type { CommitInfo, TreeEntry, BlameLine } from './git-log-commands';
export {
  diff,
  diffCommit,
  diffStat,
  mergeBase,
  canMerge,
  squashMerge,
  rebaseMerge,
} from './git-diff-commands';
export type { DiffStat } from './git-diff-commands';
export { listTags, createTag, deleteTag } from './git-tag-commands';
export type { TagInfo } from './git-tag-commands';
