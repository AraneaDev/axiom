import type { LucideIcon } from 'lucide-react';
import { User, Shield, Key, Coins, Bell } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

import { cn } from '@/lib/utils';

const settingsNav: { to: string; icon: LucideIcon; label: string }[] = [
  { to: '/settings/profile', icon: User, label: 'Profile' },
  { to: '/settings/security', icon: Shield, label: 'Security' },
  { to: '/settings/ssh-keys', icon: Key, label: 'SSH Keys' },
  { to: '/settings/tokens', icon: Coins, label: 'API Tokens' },
  { to: '/settings/notifications', icon: Bell, label: 'Notifications' },
];

/**
 *
 */
export function SettingsLayout() {
  return (
    <div className="flex gap-8 px-6 py-4">
      <nav className="w-56 shrink-0">
        <h2 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider px-3 mb-2">
          Settings
        </h2>
        <div className="space-y-0.5">
          {settingsNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-all duration-150',
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold border-l-2 border-primary'
                    : 'text-text-secondary hover:text-text hover:bg-surface-tertiary border-l-2 border-transparent',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
