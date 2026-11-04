import { Check, Pencil, X } from 'lucide-react';

import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface IssueBodySectionProps {
  body: string | null;
  basePath: string;
  projectId?: string;
  issueId?: string;
  isEditing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 *
 * @param root0
 * @param root0.body
 * @param root0.basePath
 * @param root0.projectId
 * @param root0.issueId
 * @param root0.isEditing
 * @param root0.draft
 * @param root0.onDraftChange
 * @param root0.onStartEdit
 * @param root0.onSave
 * @param root0.onCancel
 */
export function IssueBodySection({
  body,
  basePath,
  projectId,
  issueId,
  isEditing,
  draft,
  onDraftChange,
  onStartEdit,
  onSave,
  onCancel,
}: IssueBodySectionProps) {
  return (
    <Card className="p-5 mb-8">
      {isEditing ? (
        <div className="space-y-2">
          <MarkdownEditor
            value={draft}
            onChange={onDraftChange}
            projectId={projectId}
            uploadTarget={issueId ? { issueId } : undefined}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={onSave}>
              <Check className="h-4 w-4" /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="group relative">
          {body ? (
            <MarkdownRenderer content={body} basePath={basePath} />
          ) : (
            <p className="text-text-tertiary italic text-sm">No description provided.</p>
          )}
          <Button
            size="xs"
            variant="ghost"
            className="opacity-0 group-hover:opacity-100 absolute top-0 right-0 transition-opacity"
            title="Edit description"
            onClick={onStartEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </Card>
  );
}
