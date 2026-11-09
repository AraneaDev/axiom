import { Bot } from 'lucide-react';

import { authorName } from '@/lib/authors';
import type { UserKind } from '@/lib/types';

interface UserNameProps {
  /** The user shown; nothing renders when there is none */
  user: { displayName: string; kind?: UserKind } | null | undefined;
  /** The GitHub login of an imported author: shows "GitHub (<login>)" instead of the user */
  externalLogin?: string | null;
}

/**
 * A user's display name, with the bot marker (the Bot icon and "bot") for a service account.
 * Renders text inline, without a wrapper, so it reads as part of the sentence around it.
 * @param props - The user and an optional imported GitHub login
 * @param props.user - The user, with its kind when known
 * @param props.externalLogin - The GitHub login of an imported author
 */
export function UserName({ user, externalLogin }: UserNameProps) {
  const name = authorName(user, externalLogin);
  const isBot = !externalLogin && user?.kind === 'SERVICE';
  return (
    <>
      {name}
      {isBot && (
        <>
          {' '}
          <span
            className="inline-flex items-center gap-0.5 rounded-full bg-surface-tertiary px-1.5 py-px align-middle text-[11px] font-medium leading-none text-text-secondary"
            title="Service account"
          >
            <Bot className="h-3 w-3" aria-hidden="true" />
            bot
          </span>
        </>
      )}
    </>
  );
}
