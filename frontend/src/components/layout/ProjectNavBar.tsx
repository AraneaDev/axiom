import { useLocation, useNavigate, useParams } from 'react-router';
import {
  KanbanSquare,
  List,
  LayoutList,
  Map,
  Flag,
  BarChart3,
  Clock,
  Settings,
  FolderKanban,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const TABS = [
  { key: 'board', label: 'Board', icon: KanbanSquare },
  { key: 'issues', label: 'Issues', icon: List },
  { key: 'backlog', label: 'Backlog', icon: LayoutList },
  { key: 'roadmap', label: 'Roadmap', icon: Map },
  { key: 'milestones', label: 'Milestones', icon: Flag },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  { key: 'time-report', label: 'Time', icon: Clock },
  { key: 'settings', label: 'Settings', icon: Settings },
] as const;

export function ProjectNavBar() {
  const { org, team, project } = useParams<{ org: string; team: string; project: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  if (!org || !team || !project) return null;

  const basePath = `/${org}/${team}/${project}`;

  // Determine active tab from pathname
  const suffix = location.pathname.slice(basePath.length).replace(/^\//, '');
  const activeKey = TABS.find((t) => suffix === t.key || suffix.startsWith(t.key + '/'))?.key ?? 'board';

  // Format project name from slug
  const projectName = project.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return (
    <div className="flex items-center border-b border-border bg-surface">
      <div className="flex items-center gap-2 px-4 py-2 border-r border-border shrink-0">
        <FolderKanban className="h-4 w-4 text-text-tertiary" />
        <span className="text-sm font-semibold text-text">{projectName}</span>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none px-2">
        {TABS.map((tab) => {
          const active = tab.key === activeKey;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => navigate(`${basePath}/${tab.key}`)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                active ? 'text-primary' : 'text-text-tertiary hover:text-text',
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
