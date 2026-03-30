import { useQuery } from '@tanstack/react-query';
import { Link2, X, Hash } from 'lucide-react';
import { useState } from 'react';

import { issuesApi } from '@/api/issues.api';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Dropdown';
import { FormModal } from '@/components/ui/FormModal';
import { Input } from '@/components/ui/Input';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

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

  const { data: results } = useQuery({
    queryKey: ['issue-search', projectId, search],
    queryFn: () => issuesApi.list(projectId, search ? { q: search } : {}),
    enabled: search.length >= 2,
  });

  const mutation = useMutationWithToast(
    () =>
      issuesApi.addLink(projectId, issueNumber, {
        targetProjectId: selected!.projectId,
        targetIssueNumber: selected!.number,
        type: linkType,
      }),
    {
      successMessage: null,
      errorMessage: null,
      invalidateKeys: [['issue-links', projectId, issueNumber]],
      onSuccess: () => onLinked(),
      onError: (e: Error) => setError(e.message || 'Failed to add link'),
    },
  );

  const issues =
    (results as { issues?: { id: string; number: number; title: string; priority: string }[] })
      ?.issues ?? [];

  return (
    <FormModal
      open={true}
      onClose={onClose}
      title="Link Issue"
      size="md"
      onSubmit={() => mutation.mutate()}
      isPending={mutation.isPending}
      error={error}
      submitLabel="Add Link"
      submitIcon={<Link2 className="h-4 w-4" />}
      disabled={!selected}
    >
      <Select
        label="Relationship"
        value={linkType}
        onChange={(v) => setLinkType(v as string)}
        options={LINK_TYPES}
      />
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
          {issues.map((issue: { id: string; number: number; title: string; priority: string }) => (
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
              <PriorityBadge priority={issue.priority} />
            </Button>
          ))}
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
    </FormModal>
  );
}
