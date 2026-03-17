import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui.store';

export function useGlobalKeyboard() {
  const { toggleSearch } = useUIStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K or Ctrl+K — open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
      }

      // Escape — close modals/search
      if (e.key === 'Escape') {
        // Could close modals here
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSearch]);
}
