import { User, Shield, Coins, Bell, Bot, GitBranch, Plug } from 'lucide-react';
import { Outlet } from 'react-router';

import { SettingsNav, type SettingsNavItem } from './SettingsNav';

const settingsNav: SettingsNavItem[] = [
  { to: '/settings/profile', icon: User, label: 'Profile' },
  { to: '/settings/security', icon: Shield, label: 'Security' },
  { to: '/settings/tokens', icon: Coins, label: 'API Tokens' },
  { to: '/settings/connect-agent', icon: Plug, label: 'Connect an agent' },
  { to: '/settings/notifications', icon: Bell, label: 'Notifications' },
  { to: '/settings/agent-approvals', icon: Bot, label: 'Agent approvals' },
  { to: '/settings/github', icon: GitBranch, label: 'GitHub' },
];

/**
 * The user's own settings: a nav beside the page it opens.
 */
export function SettingsLayout() {
  return (
    <div className="flex gap-8">
      <SettingsNav heading="Settings" items={settingsNav} />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
