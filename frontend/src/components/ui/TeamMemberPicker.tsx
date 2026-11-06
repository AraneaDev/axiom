import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { useState } from 'react';

import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

interface TeamMemberPickerProps {
  teamId: string;
  /** Id of the chosen user, or an empty string */
  value: string;
  onChange: (userId: string) => void;
  className?: string;
}

/**
 * Searchable list of a team's members. Reports the id of the chosen user.
 * @param root0
 * @param root0.teamId
 * @param root0.value
 * @param root0.onChange
 * @param root0.className
 */
export function TeamMemberPicker({ teamId, value, onChange, className }: TeamMemberPickerProps) {
  const [search, setSearch] = useState('');
  const { data: team, isLoading } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId),
  });

  const needle = search.trim().toLowerCase();
  const members = (team?.members ?? []).filter(
    (m) =>
      !needle ||
      m.user.displayName.toLowerCase().includes(needle) ||
      m.user.username.toLowerCase().includes(needle),
  );

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members"
          aria-label="Search members"
          className="pl-8"
        />
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-2">
            <Spinner />
          </div>
        ) : members.length === 0 ? (
          <p className="px-1 py-2 text-xs text-text-tertiary">No members found</p>
        ) : (
          members.map((m) => (
            <Button
              key={m.user.id}
              variant="outline"
              size="xs"
              onClick={() => onChange(m.user.id)}
              className={cn(
                'w-full justify-start',
                value === m.user.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-text-secondary hover:border-primary',
              )}
            >
              <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="xs" />
              {m.user.displayName}
              <span className="text-text-tertiary">@{m.user.username}</span>
              {value === m.user.id && <Check className="ml-auto h-3.5 w-3.5" />}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
