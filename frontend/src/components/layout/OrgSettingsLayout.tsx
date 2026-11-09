import type { LucideIcon } from 'lucide-react';
import { Bot, ShieldCheck } from 'lucide-react';
import { NavLink, Outlet, useParams } from 'react-router';

import { cn } from '@/lib/utils';

const orgSettingsNav: { to: string; icon: LucideIcon; label: string }[] = [
  { to: 'service-accounts', icon: Bot, label: 'Service accounts' },
  { to: 'agent-approvals', icon: ShieldCheck, label: 'Agent approvals' },
];

/**
 * The settings of one org (`/:org/settings/...`): a nav beside the page it opens.
 */
export function OrgSettingsLayout() {
  const { org = '' } = useParams();
  return (
    <div className="flex gap-8">
      <nav className="w-56 shrink-0" aria-label="Org settings">
        <h2 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider px-3 mb-2">
          Org settings
        </h2>
        <div className="space-y-0.5">
          {orgSettingsNav.map((item) => (
            <NavLink
              key={item.to}
              to={`/${org}/settings/${item.to}`}
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
