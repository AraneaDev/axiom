import { Link } from 'react-router';

import type { GroupsResult, ItemsResult } from '@/api/dashboards.api';

import { groupLabel, groupValue, isGroups } from './widget-data';
import { NothingMatches, TruncatedNote } from './WidgetNotes';

const ROW = 'flex items-center gap-3 py-2 text-sm';

/**
 * A query's result as a compact list: linked items, or groups with their numbers.
 * @param root0
 * @param root0.result
 */
export function ListWidget({ result }: { result: ItemsResult | GroupsResult }) {
  if (isGroups(result)) {
    if (result.groups.length === 0) return <NothingMatches />;
    return (
      <>
        <ul className="divide-y divide-border-light">
          {result.groups.map((group) => (
            <li key={JSON.stringify(group.key)} className={ROW}>
              <span className="min-w-0 flex-1 truncate text-text">{groupLabel(group)}</span>
              <span className="tabular-nums text-text-secondary">{groupValue(group)}</span>
            </li>
          ))}
        </ul>
        {result.truncated && <TruncatedNote />}
      </>
    );
  }
  if (result.items.length === 0) return <NothingMatches />;
  return (
    <>
      <ul className="divide-y divide-border-light">
        {result.items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.url ?? '#'}
              className={`${ROW} hover:bg-surface-secondary transition-colors`}
            >
              <span className="font-mono text-xs text-text-secondary shrink-0">{item.key}</span>
              <span className="min-w-0 flex-1 truncate text-text">{item.title}</span>
              <span className="text-xs text-text-tertiary shrink-0">{item.status}</span>
            </Link>
          </li>
        ))}
      </ul>
      {result.nextCursor && <TruncatedNote />}
    </>
  );
}
