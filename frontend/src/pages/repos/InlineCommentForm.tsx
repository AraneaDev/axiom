import { MessageSquare, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';

interface InlineCommentFormProps {
  onCancel: () => void;
  onSubmit: (body: string) => void;
  isPending: boolean;
}

/**
 *
 * @param root0
 * @param root0.onCancel
 * @param root0.onSubmit
 * @param root0.isPending
 */
export function InlineCommentForm({ onCancel, onSubmit, isPending }: InlineCommentFormProps) {
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="px-3 py-2 bg-surface-secondary border-t border-b border-border">
      <Textarea
        ref={textareaRef}
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        rows={3}
        className="text-xs resize-none"
      />
      <div className="flex items-center gap-2 mt-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!body.trim() || isPending}
          onClick={() => onSubmit(body)}
        >
          <MessageSquare className="h-3.5 w-3.5" /> Comment
        </Button>
      </div>
    </div>
  );
}
