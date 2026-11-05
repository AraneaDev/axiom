import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

import { QueryBlock } from '@/components/dashboards/QueryBlock';

/**
 * Block React node view showing a live query or dashboard in the editor.
 * @param root0
 * @param root0.node
 */
export default function QueryEmbedNode({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper>
      <QueryBlock target={(node.attrs.target as string) || ''} />
    </NodeViewWrapper>
  );
}
