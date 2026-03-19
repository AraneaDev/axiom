import { useQuery } from '@tanstack/react-query';
import { AtSign } from 'lucide-react';
import { useState, useRef, useCallback, useEffect, forwardRef } from 'react';

import { usersApi } from '@/api/users.api';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}

/**
 * Textarea with `@mention` autocomplete.
 * Shows a dropdown of matching users when the user types @.
 */
export const MentionInput = forwardRef<HTMLTextAreaElement, MentionInputProps>(
  function MentionInput({ value, onChange, placeholder, className, rows = 3 }, ref) {
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionStart, setMentionStart] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [_dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({
      top: 0,
      left: 0,
    });
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const { data: users = [] } = useQuery({
      queryKey: ['users-search', mentionQuery],
      queryFn: () => usersApi.search(mentionQuery ?? ''),
      enabled: mentionQuery !== null,
      staleTime: 30000,
    });

    const setRefs = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const closeMention = useCallback(() => {
      setMentionQuery(null);
      setSelectedIndex(0);
    }, []);

    const insertMention = useCallback(
      (username: string) => {
        const before = value.slice(0, mentionStart);
        const after = value.slice(
          textareaRef.current?.selectionStart ?? mentionStart + (mentionQuery?.length ?? 0) + 1,
        );
        const newValue = `${before}@${username} ${after}`;
        onChange(newValue);
        closeMention();
        // Restore focus
        requestAnimationFrame(() => {
          const pos = before.length + username.length + 2;
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(pos, pos);
        });
      },
      [value, mentionStart, mentionQuery, onChange, closeMention],
    );

    const handleInput = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        onChange(newValue);

        const cursorPos = e.target.selectionStart;
        // Look backwards from cursor for an @ trigger
        const textBefore = newValue.slice(0, cursorPos);
        const atMatch = textBefore.match(/(^|[\s(])@([a-zA-Z0-9_-]*)$/);

        if (atMatch) {
          const query = atMatch[2];
          const start = cursorPos - query.length - 1; // position of @
          setMentionQuery(query);
          setMentionStart(start);
          setSelectedIndex(0);

          // Position dropdown below cursor (approximate)
          if (textareaRef.current) {
            const ta = textareaRef.current;
            const rect = ta.getBoundingClientRect();
            const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 20;
            const lines = textBefore.split('\n');
            const currentLine = lines.length - 1;
            setDropdownPos({
              top: rect.top + (currentLine + 1) * lineHeight + 4 - ta.scrollTop,
              left: rect.left,
            });
          }
        } else {
          closeMention();
        }
      },
      [onChange, closeMention],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (mentionQuery === null) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, users.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (users.length > 0) {
            e.preventDefault();
            insertMention(users[selectedIndex].username);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeMention();
        }
      },
      [mentionQuery, users, selectedIndex, insertMention, closeMention],
    );

    // Close dropdown on click outside
    useEffect(() => {
      function handleClickOutside(e: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
          closeMention();
        }
      }
      if (mentionQuery !== null) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [mentionQuery, closeMention]);

    const showDropdown = mentionQuery !== null && users.length > 0;

    return (
      <div className="relative">
        <textarea
          ref={setRefs}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          className={cn(
            'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text',
            'placeholder:text-text-tertiary resize-none',
            'focus:outline-none focus:ring-2 focus:ring-border-focus focus:border-border-focus',
            className,
          )}
        />
        {showDropdown && (
          <div
            ref={dropdownRef}
            className={cn(
              'absolute z-50 w-64 rounded-lg border border-border bg-surface-elevated shadow-lg',
              'max-h-48 overflow-y-auto py-1',
            )}
            style={{ top: '100%', left: 0, marginTop: 4 }}
          >
            <div className="px-2 py-1 text-[10px] uppercase font-semibold text-text-tertiary flex items-center gap-1">
              <AtSign className="h-3 w-3" /> Mention a user
            </div>
            {users.map((user, i) => (
              <button
                key={user.id}
                type="button"
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left transition-colors',
                  i === selectedIndex
                    ? 'bg-primary-light text-primary'
                    : 'text-text hover:bg-surface-secondary',
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(user.username);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <Avatar name={user.displayName} size="xs" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{user.displayName}</span>
                  <span className="text-xs text-text-tertiary">@{user.username}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
