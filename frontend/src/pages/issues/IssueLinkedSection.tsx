import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import IssueLinkModal from './IssueLinkModal';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface IssueLinkResource {
  id: string;
  number: number;
  title: string;
  project: { slug: string; prefix: string; team: { slug: string; org: { slug: string } } };
}

interface IssueLink {
  id: string;
  type: string;
  fromId: string;
  fromKey: string;
  toKey: string;
  from: IssueLinkResource;
  to: IssueLinkResource;
}

interface IssueLinkedSectionProps {
  issueId: string;
  issueNumber: number;
  projectId: string;
  links: IssueLink[];
}

/**
 *
 * @param root0
 * @param root0.issueId
 * @param root0.issueNumber
 * @param root0.projectId
 * @param root0.links
 */
export function IssueLinkedSection({
  issueId,
  issueNumber,
  projectId,
  links,
}: IssueLinkedSectionProps) {
  const queryClient = useQueryClient();
  const [showLinkModal, setShowLinkModal] = useState(false);

  const content =
    links.length > 0 ? (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Linked Issues</h3>
          <Button variant="ghost" size="sm" onClick={() => setShowLinkModal(true)}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <div className="space-y-1">
          {links.map((link) => {
            const isFrom = link.fromId === issueId;
            const linkedIssue = isFrom ? link.to : link.from;
            const linkedKey = isFrom ? link.toKey : link.fromKey;
            const linkedProject = linkedIssue?.project;
            const linkUrl =
              linkedProject?.team?.org?.slug &&
              linkedProject?.team?.slug &&
              linkedProject?.slug &&
              linkedIssue?.number
                ? `/${linkedProject.team.org.slug}/${linkedProject.team.slug}/${linkedProject.slug}/issues/${linkedIssue.number}`
                : null;
            return (
              <div key={link.id} className="flex items-center gap-2 text-xs">
                <span className="text-text-tertiary capitalize">
                  {link.type.replace(/_/g, ' ').toLowerCase()}
                </span>
                {linkUrl ? (
                  <Link to={linkUrl} className="font-mono text-primary hover:underline">
                    {linkedKey}
                  </Link>
                ) : (
                  <span className="font-mono text-primary">{linkedKey}</span>
                )}
                {linkedIssue?.title && (
                  <span className="text-text-secondary truncate">{linkedIssue.title}</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    ) : (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">Linked Issues</h3>
          <Button variant="ghost" size="sm" onClick={() => setShowLinkModal(true)}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <p className="text-xs text-text-tertiary">No linked issues yet.</p>
      </Card>
    );

  return (
    <>
      {content}
      {showLinkModal && (
        <IssueLinkModal
          projectId={projectId}
          issueNumber={issueNumber}
          onClose={() => setShowLinkModal(false)}
          onLinked={() => {
            queryClient.invalidateQueries({
              queryKey: ['issue-links', projectId, issueNumber],
            });
            setShowLinkModal(false);
          }}
        />
      )}
    </>
  );
}
