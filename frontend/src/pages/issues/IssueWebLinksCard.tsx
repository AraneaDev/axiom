import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { issueWebLinksApi } from '@/api/issue-web-links.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

interface IssueWebLinksCardProps {
  projectId: string;
  issueNumber: number;
}

/**
 * Right-sidebar card with the external links on an issue: a spec, a build, a ticket elsewhere.
 * @param root0
 * @param root0.projectId
 * @param root0.issueNumber
 */
export function IssueWebLinksCard({ projectId, issueNumber }: IssueWebLinksCardProps) {
  // Under ['issue', projectId], so the issue:updated event refreshes it in other tabs
  const queryKey = ['issue', projectId, issueNumber, 'web-links'];
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  const {
    data: links = [],
    isLoading,
    error: listError,
  } = useQuery({
    queryKey,
    queryFn: () => issueWebLinksApi.list(projectId, issueNumber),
  });

  const add = useMutationWithToast(
    () =>
      issueWebLinksApi.add(projectId, issueNumber, {
        url: url.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
      }),
    {
      successMessage: 'Link added',
      errorMessage: 'Could not add the link',
      invalidateKeys: [queryKey],
      onSuccess: () => {
        setUrl('');
        setTitle('');
      },
    },
  );

  const remove = useMutationWithToast(
    (linkId: string) => issueWebLinksApi.remove(projectId, issueNumber, linkId),
    {
      successMessage: 'Link removed',
      errorMessage: 'Could not remove the link',
      invalidateKeys: [queryKey],
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) add.mutate();
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <ExternalLink className="h-4 w-4 text-text-secondary" />
        <h3 className="text-sm font-semibold">Links</h3>
        {isLoading && <Spinner className="h-3.5 w-3.5" />}
        {links.length > 0 && (
          <span className="ml-auto text-xs text-text-tertiary">{links.length}</span>
        )}
      </div>

      {listError && <p className="text-xs text-danger mb-3">Could not load the links.</p>}

      {links.length > 0 && (
        <div className="space-y-1 mb-3">
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-2 text-xs py-0.5">
              <ExternalLink className="h-3 w-3 text-text-tertiary flex-shrink-0" />
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary truncate flex-1 hover:underline"
                title={link.url}
              >
                {link.title ?? link.url}
              </a>
              <Button
                variant="ghost"
                size="xs"
                title="Remove link"
                aria-label="Remove link"
                disabled={remove.isPending}
                onClick={() => remove.mutate(link.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="space-y-2">
        <Input
          type="url"
          placeholder="https://"
          aria-label="Link URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Input
          placeholder="Title (optional)"
          aria-label="Link title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!url.trim() || add.isPending}>
          <Plus className="h-3.5 w-3.5" />
          Add link
        </Button>
      </form>
    </Card>
  );
}
