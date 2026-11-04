import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';

import ImageNode from './ImageNode';

/**
 * Image for the browser editor: the shared inline image plus a node view that loads
 * attachment sources with auth. Only the render path differs; the node keeps its
 * attributes and serializes to `![alt](src)` exactly as the shared node does.
 */
export const ImageExtension = Image.configure({ inline: true }).extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNode, { as: 'span' });
  },
});
