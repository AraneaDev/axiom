import { ReactNodeViewRenderer } from '@tiptap/react';

import { CalloutNode } from '@/editor-core/nodes/callout';

import { CalloutBlock } from './CalloutBlock';

export type { CalloutType } from '@/editor-core/nodes/callout';

/** Callout block for the browser editor: the shared node plus its React node view. */
export const CalloutExtension = CalloutNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CalloutBlock);
  },
});
