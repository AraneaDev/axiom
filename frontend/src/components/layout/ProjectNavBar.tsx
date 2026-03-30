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
import { useLocation, useNavigate, useParams } from 'react-router';

import { Tabs } from '@/components/ui/Tabs';

const NAV_TABS = [
  { key: 'board', label: 'Board', icon: <KanbanSquare className="h-4 w-4" /> },
  { key: 'issues', label: 'Issues', icon: <List className="h-4 w-4" /> },
  { key: 'backlog', label: 'Backlog', icon: <LayoutList className="h-4 w-4" /> },
  { key: 'roadmap', label: 'Roadmap', icon: <Map className="h-4 w-4" /> },
  { key: 'milestones', label: 'Milestones', icon: <Flag className="h-4 w-4" /> },
  { key: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
  { key: 'time-report', label: 'Time', icon: <Clock className="h-4 w-4" /> },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

/**
 *
 */
export function ProjectNavBar() {
  const { org, team, project } = useParams<{ org: string; team: string; project: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const basePath = `/${org}/${team}/${project}`;

  // Determine active tab from pathname
  const suffix = location.pathname.slice(basePath.length).replace(/^\//, '');
  const activeKey =
    NAV_TABS.find((t) => suffix === t.key || suffix.startsWith(t.key + '/'))?.key ?? 'board';

  return (
    <Tabs
      tabs={NAV_TABS}
      activeKey={activeKey}
      onChange={(key) => navigate(`${basePath}/${key}`)}
      className="overflow-x-auto px-4"
    />
  );
}
