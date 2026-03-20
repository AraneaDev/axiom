import { useEffect } from 'react';

import { useUIStore } from '@/stores/ui.store';

/**
 * Returns true if the active element is an input, textarea, or contenteditable,
 * meaning single-key shortcuts should be suppressed.
 */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Global keyboard shortcut handler.
 * Registers shortcuts for search, navigation, issue creation, and help.
 * Should be called once near the top of the component tree.
 */
export function useGlobalKeyboard() {
  const { toggleSearch, toggleShortcutHelp } = useUIStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K or Ctrl+K -- open search (works even when typing)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // All remaining shortcuts are suppressed while typing in an input
      if (isTyping()) return;

      // ? -- show keyboard shortcut help
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleShortcutHelp();
        return;
      }

      // / -- focus search (open command palette)
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // c -- create new issue (navigate to new issue page)
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        // Find the "New Issue" link on the page and click it
        const newIssueLink = document.querySelector<HTMLAnchorElement>('a[href*="/issues/new"]');
        if (newIssueLink) {
          e.preventDefault();
          newIssueLink.click();
        }
        return;
      }

      // j / k -- navigate down / up in issue lists
      if ((e.key === 'j' || e.key === 'k') && !e.metaKey && !e.ctrlKey) {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-issue-row]'));
        if (rows.length === 0) return;

        e.preventDefault();
        const current = rows.findIndex((r) => r.classList.contains('ring-1'));
        let next: number;

        if (e.key === 'j') {
          next = current < 0 ? 0 : Math.min(current + 1, rows.length - 1);
        } else {
          next = current < 0 ? rows.length - 1 : Math.max(current - 1, 0);
        }

        // Remove highlight from current
        if (current >= 0) {
          rows[current].classList.remove('ring-1', 'ring-primary');
        }

        // Add highlight to next
        rows[next].classList.add('ring-1', 'ring-primary');
        rows[next].scrollIntoView({ block: 'nearest' });

        return;
      }

      // Enter -- open highlighted issue
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        const highlighted = document.querySelector<HTMLElement>('[data-issue-row].ring-1');
        if (highlighted) {
          const link = highlighted.querySelector<HTMLAnchorElement>('a[href*="/issues/"]');
          if (link) {
            e.preventDefault();
            link.click();
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSearch, toggleShortcutHelp]);
}
