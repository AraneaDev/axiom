import { CircleCheck, CircleDot, ExternalLink, X } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { PriorityBadge } from '@/components/ui/PriorityBadge';

interface Issue {
  id: string;
  key: string;
  title: string;
  number: number;
  type: string;
  priority: string;
  column?: { name: string } | null;
  assignee?: { displayName: string } | null;
  labels?: { id: string; name: string }[];
}

interface IssueListSidebarProps {
  selectedIssue: Issue | null;
  allIssues: Issue[];
  onClose: () => void;
  issueUrl: (issueNumber: number) => string;
}

/**
 * @param root0
 * @param root0.selectedIssue
 * @param root0.allIssues
 * @param root0.onClose
 * @param root0.issueUrl
 */
export function IssueListSidebar({
  selectedIssue,
  allIssues,
  onClose,
  issueUrl,
}: IssueListSidebarProps) {
  const openCount = allIssues.filter(
    (i) => i.column?.name !== 'Done' && i.column?.name !== 'Closed',
  ).length;
  const closedCount = allIssues.length - openCount;

  if (selectedIssue) {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm text-text truncate">Issue Preview</h3>
          <Button variant="ghost" size="xs" onClick={onClose} title="Close preview">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-2">
            <IssueTypeIcon type={selectedIssue.type} className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-mono text-text-secondary">{selectedIssue.key}</span>
              <h4 className="text-sm font-medium text-text leading-snug">{selectedIssue.title}</h4>
            </div>
          </div>

          <div className="space-y-2">
            {selectedIssue.column && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-tertiary">Status</span>
                <Badge variant="outline" size="sm">
                  {selectedIssue.column.name}
                </Badge>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Priority</span>
              <PriorityBadge priority={selectedIssue.priority} />
            </div>

            {selectedIssue.assignee && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-tertiary">Assignee</span>
                <div className="flex items-center gap-1.5">
                  <Avatar name={selectedIssue.assignee.displayName} size="xs" />
                  <span className="text-xs text-text">{selectedIssue.assignee.displayName}</span>
                </div>
              </div>
            )}

            {selectedIssue.labels && selectedIssue.labels.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-tertiary">Labels</span>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {selectedIssue.labels.map((l) => (
                    <Badge key={l.id} variant="outline" size="sm">
                      {l.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Link
            to={issueUrl(selectedIssue.number)}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover mt-2"
          >
            <ExternalLink className="h-3 w-3" /> View full details
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm text-text">Summary</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Total Issues</span>
          <span className="text-sm font-medium text-text">{allIssues.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CircleDot className="h-3 w-3 text-success" />
            <span className="text-xs text-text-tertiary">Open</span>
          </div>
          <span className="text-sm font-medium text-text">{openCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CircleCheck className="h-3 w-3 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">Closed</span>
          </div>
          <span className="text-sm font-medium text-text">{closedCount}</span>
        </div>
        <p className="text-xs text-text-tertiary pt-2 border-t border-border">
          Click an issue row to preview it here
        </p>
      </div>
    </Card>
  );
}
