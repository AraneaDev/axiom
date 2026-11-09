import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { orgsApi } from '@/api/orgs.api';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';

/** Org roles that may own a bot: member or above */
const OWNER_ROLES = new Set(['OWNER', 'ADMIN', 'MEMBER']);

interface ServiceAccountOwnerPickerProps {
  orgId: string;
  selected: string[];
  onChange: (ownerIds: string[]) => void;
}

/**
 * Pick a bot's owners: people in its org with role member or above. The member list holds people
 * only, so no bot is offered.
 * @param props - The org, the picked ids and the change handler
 * @param props.orgId - The bot's org
 * @param props.selected - The ids picked
 * @param props.onChange - Called with the new ids
 */
export function ServiceAccountOwnerPicker({
  orgId,
  selected,
  onChange,
}: ServiceAccountOwnerPickerProps) {
  const [filter, setFilter] = useState('');
  const { data: members, isLoading } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => orgsApi.listMembers(orgId),
  });

  const eligible = (members ?? []).filter((m) => OWNER_ROLES.has(m.role));
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? eligible.filter(
        (m) =>
          m.user.displayName.toLowerCase().includes(needle) ||
          m.user.username.toLowerCase().includes(needle),
      )
    : eligible;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text">Owners</legend>
      <p className="text-xs text-text-tertiary">
        People in this org with role member or above. Owners decide the bot&apos;s requests and
        manage its tokens.
      </p>
      {eligible.length > 8 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-text-tertiary" />
          <Input
            aria-label="Filter people"
            placeholder="Filter people"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
      )}
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
          {shown.length === 0 && (
            <p className="text-xs text-text-tertiary">No one here can own a bot.</p>
          )}
          {shown.map((m) => (
            <Checkbox
              key={m.userId}
              id={`owner-${m.userId}`}
              label={`${m.user.displayName} (@${m.user.username})`}
              checked={selected.includes(m.userId)}
              onChange={() => toggle(m.userId)}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
