import { Search, Menu, Moon, Sun, Settings, LogOut, User, Shield, Bell } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { NotificationCenter } from '@/components/layout/NotificationCenter';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
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
    <header className="h-14 border-b border-border bg-surface/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="p-2"
          title="Toggle sidebar"
        >
          <Menu className="h-4 w-4 text-text-secondary" />
        </Button>
        <Link to="/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
            <span className="text-white text-xs font-bold">A</span>
          </div>
          <span className="text-sm font-semibold text-text tracking-tight">Axiom</span>
        </Link>
      </div>

      <Button
        variant="secondary"
        size="sm"
        onClick={toggleSearch}
        className="flex items-center gap-2 rounded-lg bg-surface-secondary px-3 py-1.5 text-text-tertiary hover:text-text-secondary w-72"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">Search anything...</span>
        <kbd className="ml-auto text-[10px] font-mono bg-surface-tertiary text-text-tertiary px-1.5 py-0.5 rounded">
          Ctrl+K
        </kbd>
      </Button>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={toggleDark} className="p-2" title="Toggle theme">
          {isDark ? (
            <Sun className="h-4 w-4 text-text-tertiary hover:text-warning" />
          ) : (
            <Moon className="h-4 w-4 text-text-tertiary hover:text-primary" />
          )}
        </Button>

        <NotificationCenter />

        <div className="relative ml-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-lg px-2 py-1"
            title="User menu"
          >
            <Avatar name={user?.displayName ?? 'User'} src={user?.avatarUrl} size="sm" />
            <span className="text-xs font-medium text-text-secondary hidden sm:block">
              {user?.displayName}
            </span>
          </Button>

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
                    to="/settings/notifications"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text hover:bg-surface-tertiary transition-colors"
                  >
                    <Bell className="h-3.5 w-3.5" /> Notifications
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className="w-full justify-start rounded-none px-3 py-2 text-danger hover:bg-danger-light"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
