import { ReactNodeViewRenderer } from '@tiptap/react';

import { TableOfContentsNode } from '@/editor-core/nodes/table-of-contents';

import { TableOfContentsBlock } from './TableOfContentsBlock';

/** Table of contents for the browser editor: the shared node plus its React node view. */
export const TableOfContentsExtension = TableOfContentsNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsBlock);
  },
});
