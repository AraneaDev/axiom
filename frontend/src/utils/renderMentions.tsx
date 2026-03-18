import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';

/**
 * Replace `@username` mentions and #PREFIX-123 issue references in text
 * with styled, interactive elements.
 * Returns a ReactNode array suitable for rendering inline.
 * @param text
 */
export function renderTextWithMentions(text: string): React.ReactNode[] {
  // Combined pattern: match @username or #PREFIX-123
  const pattern = /(@[a-zA-Z0-9_-]+)|(#[A-Z]+-\d+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // @mention
      const username = match[1].slice(1); // remove @
      parts.push(
        <span
          key={`mention-${match.index}`}
          className="text-primary font-medium cursor-default"
          title={`@${username}`}
        >
          @{username}
        </span>,
      );
    } else if (match[2]) {
      // #issue ref
      const issueKey = match[2].slice(1); // remove #
      parts.push(
        <Badge
          key={`ref-${match.index}`}
          variant="primary"
          size="sm"
          className="cursor-pointer inline-flex"
        >
          <Link to={`/issues/${issueKey}`} className="no-underline text-inherit">
            {match[2]}
          </Link>
        </Badge>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
