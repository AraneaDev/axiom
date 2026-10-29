import { ReactNodeViewRenderer } from '@tiptap/react';

import { CollapsibleNode } from '@/editor-core/nodes/collapsible';

import { CollapsibleBlock } from './CollapsibleBlock';

/** Collapsible section for the browser editor: the shared node plus its React node view. */
export const CollapsibleExtension = CollapsibleNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleBlock);
  },
});
