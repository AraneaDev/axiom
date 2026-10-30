import type { PageTreeNode } from '@/lib/types';
import type { TocEntry } from '@/lib/wiki-types';

/**
 * Extract a table-of-contents from raw markdown headings (h1-h3).
 * @param markdown
 */
export function extractToc(markdown: string): TocEntry[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const entries: TocEntry[] = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    entries.push({ level: match[1].length, text, id });
  }
  return entries;
}

/**
 * @param node
 * Count all descendants of a tree node recursively.
 */
export function countDescendants(node: PageTreeNode): number {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child);
  }
  return count;
}

/**
 * @param nodes
 * @param targetSlug
 * @param ancestors
 * Walk the tree and return the IDs of all ancestors of the node whose slug
 * matches `targetSlug`. Returns `null` when the target is not found.
 */
export function collectAncestorIds(
  nodes: PageTreeNode[],
  targetSlug: string,
  ancestors: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.slug === targetSlug) {
      return ancestors;
    }
    if (node.children.length > 0) {
      const found = collectAncestorIds(node.children, targetSlug, [...ancestors, node.id]);
      if (found) return found;
    }
  }
  return null;
}

export type DropZone = 'before' | 'child' | 'after';

/**
 *
 * @param nodes
 * @param id
 */
export interface DropTarget {
  nodeId: string;
  zone: DropZone;
}

/**
 * @param nodes
 * @param id
 */
export function findNodeById(nodes: PageTreeNode[], id: string): PageTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return undefined;
}

/**
 *
 * @param tree
 * @param target
 */
export function findSiblings(tree: PageTreeNode[], target: PageTreeNode): PageTreeNode[] {
  if (!target.parentId) return tree;
  const parent = findNodeById(tree, target.parentId);
  return parent?.children ?? tree;
}

/**
 *
 * @param node
 * @param targetId
 */
export function isDescendant(node: PageTreeNode, targetId: string): boolean {
  for (const child of node.children) {
    if (child.id === targetId) return true;
    if (isDescendant(child, targetId)) return true;
  }
  return false;
}
