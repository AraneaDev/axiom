import { UserName } from '@/components/ui/UserName';

/**
 * Who asked, on a bot's request: the bot, with its marker, and why it is yours to decide.
 * @param props - The bot
 * @param props.bot - The bot that asked
 * @param props.bot.displayName - Its name
 */
export function BotLine({ bot }: { bot: { displayName: string } }) {
  return (
    <span className="mt-0.5 block text-xs text-text-secondary">
      <span className="font-medium text-text">
        <UserName user={{ displayName: bot.displayName, kind: 'SERVICE' }} />
      </span>{' '}
      asked, on behalf of nobody. You own this bot.
    </span>
  );
}
