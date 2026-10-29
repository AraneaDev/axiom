import { ReactNodeViewRenderer } from '@tiptap/react';

import { IssueEmbedNode as SharedIssueEmbedNode } from '@/editor-core/nodes/issue-embed';

import IssueEmbedNode from './IssueEmbedNode';

/**
 * Issue embed for the browser editor: the shared node plus the live issue card.
 * Serializes to markdown as `:::issue AXM-123:::`.
 */
export const IssueEmbedExtension = SharedIssueEmbedNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(IssueEmbedNode);
  },
});
