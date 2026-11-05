import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

import { LazyQueryBlock } from '@/components/dashboards/LazyQueryBlock';

/**
 * Block React node view showing a live query or dashboard in the editor.
 * @param root0
 * @param root0.node
 */
export default function QueryEmbedNode({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper>
      <LazyQueryBlock target={(node.attrs.target as string) || ''} />
    </NodeViewWrapper>
  );
}
