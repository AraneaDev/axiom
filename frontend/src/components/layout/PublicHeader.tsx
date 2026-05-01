import { LogIn, Moon, Sun } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
import { useDarkMode } from '@/hooks/useDarkMode';

/**
 *
 * @param root0
 * @param root0.showSignIn
 */
export function PublicHeader({ showSignIn = false }: { showSignIn?: boolean }) {
  const { isDark, toggle } = useDarkMode();

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border">
      <Link to="/" className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-text-inverse text-sm font-bold">A</span>
        </div>
        <span className="text-xl font-bold text-text">Axiom</span>
      </Link>
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="p-2 rounded-md text-text-secondary hover:text-text hover:bg-surface-tertiary transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {showSignIn && (
          <Link to="/login">
            <Button variant="outline" size="sm">
              <LogIn className="h-4 w-4" /> Sign in
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
