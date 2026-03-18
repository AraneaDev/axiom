import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, X, Hash } from 'lucide-react';
import { useState } from 'react';

import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PRIORITY_COLORS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const LINK_TYPES = [
  { value: 'BLOCKS', label: 'Blocks' },
  { value: 'IS_BLOCKED_BY', label: 'Is blocked by' },
  { value: 'RELATES_TO', label: 'Relates to' },
  { value: 'DUPLICATES', label: 'Duplicates' },
];

interface Props {
  projectId: string;
  issueNumber: number;
  onClose: () => void;
  onLinked: () => void;
}

/**
 *
 * @param root0
 * @param root0.projectId
 * @param root0.issueNumber
 * @param root0.onClose
 * @param root0.onLinked
 */
export default function IssueLinkModal({ projectId, issueNumber, onClose, onLinked }: Props) {
  const [search, setSearch] = useState('');
  const [linkType, setLinkType] = useState('RELATES_TO');
  const [selected, setSelected] = useState<{
    id: string;
    number: number;
    title: string;
    projectId: string;
  } | null>(null);
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const { data: results } = useQuery({
    queryKey: ['issue-search', projectId, search],
    queryFn: () => issuesApi.list(projectId, search ? { q: search } : {}),
    enabled: search.length >= 2,
  });

  const mutation = useMutation({
    mutationFn: () =>
      issuesApi.addLink(projectId, issueNumber, {
        targetProjectId: selected!.projectId,
        targetIssueNumber: selected!.number,
        type: linkType,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-links', projectId, issueNumber] });
      onLinked();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to add link'),
  });

  const issues =
    (results as { issues?: { id: string; number: number; title: string; priority: string }[] })
      ?.issues ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-elevated rounded-xl border border-border shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Link Issue
          </h2>
          <Button variant="ghost" size="xs" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-text-secondary mb-1.5 block">
              Relationship
            </label>
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors"
            >
              {LINK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Search issues"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
            }}
            placeholder="Type to search..."
          />
          {issues.length > 0 && !selected && (
            <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
              {issues.map(
                (issue: { id: string; number: number; title: string; priority: string }) => (
                  <Button
                    key={issue.id}
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSelected({
                        id: issue.id,
                        number: issue.number,
                        title: issue.title,
                        projectId,
                      })
                    }
                    className="w-full justify-start rounded-none"
                  >
                    <Hash className="h-3 w-3 text-text-tertiary" />
                    <span className="text-text-tertiary font-mono text-xs">{issue.number}</span>
                    <span className="flex-1 truncate text-left">{issue.title}</span>
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded-full',
                        PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS] ?? '',
                      )}
                    >
                      {issue.priority}
                    </span>
                  </Button>
                ),
              )}
            </div>
          )}
          {selected && (
            <div className="flex items-center gap-2 p-2 bg-primary-light border border-primary/20 rounded-lg text-sm">
              <span className="font-medium truncate flex-1">{selected.title}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setSelected(null)}
                className="text-text-tertiary hover:text-danger"
                title="Remove selection"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!selected || mutation.isPending}>
            <Link2 className="h-4 w-4" /> Add Link
          </Button>
        </div>
      </div>
    </div>
  );
}
