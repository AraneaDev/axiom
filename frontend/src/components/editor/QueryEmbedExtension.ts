import { ReactNodeViewRenderer } from '@tiptap/react';

import { QueryEmbedNode as SharedQueryEmbedNode } from '@/editor-core/nodes/query-embed';

import QueryEmbedNode from './QueryEmbedNode';

/**
 * Live query or dashboard block for the browser editor: the shared node plus its live view.
 * Serializes to markdown as `:::query <target>:::`.
 */
export const QueryEmbedExtension = SharedQueryEmbedNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(QueryEmbedNode);
  },
});
