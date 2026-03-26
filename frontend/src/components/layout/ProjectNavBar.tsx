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
} from 'lucide-react';

import { cn } from '@/lib/utils';

const TABS = [
  { key: 'board', label: 'Board', icon: <KanbanSquare className="h-4 w-4" /> },
  { key: 'issues', label: 'Issues', icon: <List className="h-4 w-4" /> },
  { key: 'backlog', label: 'Backlog', icon: <LayoutList className="h-4 w-4" /> },
  { key: 'roadmap', label: 'Roadmap', icon: <Map className="h-4 w-4" /> },
  { key: 'milestones', label: 'Milestones', icon: <Flag className="h-4 w-4" /> },
  { key: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
  { key: 'time-report', label: 'Time', icon: <Clock className="h-4 w-4" /> },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
] as const;

export function ProjectNavBar() {
  const { org, team, project } = useParams<{ org: string; team: string; project: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const basePath = `/${org}/${team}/${project}`;

  // Determine active tab from pathname
  const suffix = location.pathname.slice(basePath.length).replace(/^\//, '');
  const activeKey = TABS.find((t) => suffix === t.key || suffix.startsWith(t.key + '/'))?.key ?? 'board';

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border scrollbar-none px-4">
      {TABS.map((tab) => {
        const active = tab.key === activeKey;
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
            {tab.icon}
            {tab.label}
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
