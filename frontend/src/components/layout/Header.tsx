import { Search, Menu, Moon, Sun, Settings, LogOut, User, Shield } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { NotificationCenter } from '@/components/layout/NotificationCenter';
import { Avatar } from '@/components/ui/Avatar';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';

/**
 *
 */
export function Header() {
  const { user, logout } = useAuthStore();
  const { toggleSidebar, toggleSearch } = useUIStore();
  const { isDark, toggle: toggleDark } = useDarkMode();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="h-12 border-b border-border bg-surface/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1 rounded-md hover:bg-surface-tertiary transition-colors"
        >
          <Menu className="h-4 w-4 text-text-secondary" />
        </button>
        <Link to="/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">A</span>
          </div>
          <span className="text-sm font-semibold text-text tracking-tight">Axiom</span>
        </Link>
      </div>

      <button
        onClick={toggleSearch}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-tertiary hover:text-text-secondary hover:border-border-focus/30 transition-all w-72 shadow-sm"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">Search anything...</span>
        <kbd className="ml-auto text-[10px] font-mono bg-surface-tertiary text-text-tertiary px-1.5 py-0.5 rounded">
          Ctrl+K
        </kbd>
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={toggleDark}
          className="p-1.5 rounded-md hover:bg-surface-tertiary transition-colors"
          title="Toggle theme"
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-text-tertiary hover:text-warning" />
          ) : (
            <Moon className="h-4 w-4 text-text-tertiary hover:text-primary" />
          )}
        </button>

        <NotificationCenter />

        <div className="relative ml-1">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-lg hover:bg-surface-tertiary px-2 py-1 transition-colors"
          >
            <Avatar name={user?.displayName ?? 'User'} src={user?.avatarUrl} size="sm" />
            <span className="text-xs font-medium text-text-secondary hidden sm:block">
              {user?.displayName}
            </span>
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-surface-elevated shadow-lg py-1.5 z-50 animate-fade-in">
                <div className="px-3 py-2.5 border-b border-border-light">
                  <p className="text-sm font-semibold text-text">{user?.displayName}</p>
                  <p className="text-xs text-text-tertiary">@{user?.username}</p>
                </div>
                <div className="py-1">
                  <Link
                    to="/settings/profile"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text hover:bg-surface-tertiary transition-colors"
                  >
                    <User className="h-3.5 w-3.5" /> Profile
                  </Link>
                  <Link
                    to="/settings/security"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text hover:bg-surface-tertiary transition-colors"
                  >
                    <Shield className="h-3.5 w-3.5" /> Security
                  </Link>
                  <Link
                    to="/settings/tokens"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text hover:bg-surface-tertiary transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" /> API Tokens
                  </Link>
                </div>
                <div className="border-t border-border-light pt-1">
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-danger hover:bg-danger-light w-full transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
