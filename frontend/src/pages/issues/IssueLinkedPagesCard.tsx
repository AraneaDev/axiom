import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';

import { wikiIssueLinksApi } from '@/api/wiki-issue-links.api';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { subscribe, unsubscribe } from '@/hooks/useWebSocket';

interface IssueLinkedPagesCardProps {
  projectId: string;
  issueId: string;
  issueNumber: number;
}

/**
 * Right-sidebar card listing the wiki pages linked to an issue.
 * Joins the `issue:{id}` room while mounted: the backend broadcasts
 * `issue:links-updated` there when a wiki page links or unlinks this issue.
 * @param root0
 * @param root0.projectId
 * @param root0.issueId
 * @param root0.issueNumber
 */
export function IssueLinkedPagesCard({
  projectId,
  issueId,
  issueNumber,
}: IssueLinkedPagesCardProps) {
  useEffect(() => {
    const rooms = [`issue:${issueId}`];
    subscribe(rooms);
    return () => unsubscribe(rooms);
  }, [issueId]);

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ['issue-wiki-links', projectId, issueNumber],
    queryFn: () => wikiIssueLinksApi.listForIssue(projectId, issueNumber),
  });

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 text-text-secondary" />
        <h3 className="text-sm font-semibold">Linked pages</h3>
        {isLoading && <Spinner className="h-3.5 w-3.5" />}
        {pages.length > 0 && (
          <span className="ml-auto text-xs text-text-tertiary">{pages.length}</span>
        )}
      </div>

      {pages.length > 0 ? (
        <div className="space-y-1">
          {pages.map((w) => (
            <Link
              key={w.id}
              to={`/${w.page.space.team.org.slug}/${w.page.space.team.slug}/wiki/${w.page.space.slug}/${w.page.slug}`}
              className="flex items-center gap-2 text-xs py-0.5 hover:bg-surface-secondary rounded px-1 -mx-1 transition-colors"
            >
              <FileText className="h-3 w-3 text-text-tertiary flex-shrink-0" />
              <span className="text-primary truncate flex-1">{w.page.title}</span>
              <span className="text-text-tertiary ml-auto flex-shrink-0">{w.page.space.name}</span>
            </Link>
          ))}
        </div>
      ) : (
        !isLoading && <p className="text-xs text-text-tertiary">No linked pages yet.</p>
      )}
    </Card>
  );
}
