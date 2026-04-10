import type { LucideIcon } from 'lucide-react';
import { Tag, ListPlus, FileText, Zap, GitBranch, ShieldCheck, FileInput } from 'lucide-react';
import { NavLink, Outlet, useParams } from 'react-router';

import { cn } from '@/lib/utils';

const settingsNav: { path: string; icon: LucideIcon; label: string }[] = [
  { path: 'labels', icon: Tag, label: 'Labels' },
  { path: 'fields', icon: ListPlus, label: 'Custom Fields' },
  { path: 'templates', icon: FileText, label: 'Templates' },
  { path: 'automation', icon: Zap, label: 'Automations' },
  { path: 'workflow', icon: GitBranch, label: 'Workflows' },
  { path: 'approvals', icon: ShieldCheck, label: 'Approvals' },
  { path: 'forms', icon: FileInput, label: 'Forms' },
];

/**
 *
 */
export function ProjectSettingsLayout() {
  const { org, team, project } = useParams();
  const base = `/${org}/${team}/${project}/settings`;

  return (
    <div className="flex gap-8">
      <nav className="w-56 shrink-0">
        <h2 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider px-3 mb-2">
          Project Settings
        </h2>
        <div className="space-y-0.5">
          {settingsNav.map((item) => (
            <NavLink
              key={item.path}
              to={`${base}/${item.path}`}
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
