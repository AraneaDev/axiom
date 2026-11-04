import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

import { cn } from '@/lib/utils';

import { AttachmentImage } from './AttachmentImage';

/**
 * Node view for an image in the editor. Attachment sources are fetched with auth, so
 * a plain `<img src="/api/attachments/...">` would be refused.
 * @param props - TipTap node view props.
 * @param props.node - The image node.
 * @param props.selected - Whether the node is selected.
 */
export default function ImageNode({ node, selected }: NodeViewProps) {
  const { src, alt } = node.attrs as { src: string; alt?: string | null };
  return (
    <NodeViewWrapper
      as="span"
      className={cn('inline-block max-w-full', selected && 'ring-2 ring-primary')}
    >
      <AttachmentImage src={src} alt={alt ?? ''} />
    </NodeViewWrapper>
  );
}
