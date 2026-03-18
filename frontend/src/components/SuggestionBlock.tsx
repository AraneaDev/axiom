import { Check, ListChecks, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const SUGGESTION_RE = /```suggestion\n([\s\S]*?)```/;

interface SuggestionBlockProps {
  commentId: string;
  body: string;
  originalLine?: string;
  isApplying?: boolean;
  isSelected?: boolean;
  onApply: (commentId: string) => void;
  onToggleSelect: (commentId: string) => void;
}

/**
 *
 * @param body
 */
export function parseSuggestion(body: string): string | null {
  const match = body.match(SUGGESTION_RE);
  return match ? match[1] : null;
}

/**
 *
 * @param body
 */
export function hasSuggestion(body: string): boolean {
  return SUGGESTION_RE.test(body);
}

/**
 *
 * @param root0
 * @param root0.commentId
 * @param root0.body
 * @param root0.originalLine
 * @param root0.isApplying
 * @param root0.isSelected
 * @param root0.onApply
 * @param root0.onToggleSelect
 */
export function SuggestionBlock({
  commentId,
  body,
  originalLine,
  isApplying,
  isSelected,
  onApply,
  onToggleSelect,
}: SuggestionBlockProps) {
  const suggestion = parseSuggestion(body);
  if (!suggestion) return null;

  const suggestedLines = suggestion.endsWith('\n')
    ? suggestion.slice(0, -1).split('\n')
    : suggestion.split('\n');

  return (
    <div className="rounded-lg border border-border overflow-hidden mt-2">
      <div className="flex items-center justify-between bg-surface-secondary px-3 py-1.5">
        <span className="text-xs font-semibold text-text-secondary">Suggested change</span>
        <div className="flex items-center gap-2">
          <label
            className={cn('flex items-center gap-1.5 text-xs cursor-pointer text-text-secondary')}
          >
            <input
              type="checkbox"
              checked={isSelected ?? false}
              onChange={() => onToggleSelect(commentId)}
              className="rounded border-border"
            />
            <ListChecks className="h-3 w-3" />
            Batch
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={isApplying}
            onClick={() => onApply(commentId)}
          >
            {isApplying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Apply
          </Button>
        </div>
      </div>
      <div className="font-mono text-xs">
        {originalLine != null && (
          <div className="bg-danger-light text-danger px-3 py-0.5">
            <span className="select-none text-text-tertiary mr-2">-</span>
            {originalLine}
          </div>
        )}
        {suggestedLines.map((line, i) => (
          <div key={i} className="bg-success-light text-success px-3 py-0.5">
            <span className="select-none text-text-tertiary mr-2">+</span>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
