import { Outlet } from 'react-router';

import { useProjectContext } from '@/hooks/useProjectContext';
import { useRealtimeRoom } from '@/hooks/useRealtimeInvalidation';

import { ProjectNavBar } from './ProjectNavBar';

/**
 * Layout for every project view. Joins the project's realtime room once the project has
 * loaded, so boards and lists refresh on changes made elsewhere.
 */
export function ProjectLayout() {
  const { currentProject } = useProjectContext();
  useRealtimeRoom(currentProject ? `project:${currentProject.id}` : null);

  return (
    <div className="flex flex-col h-full">
      <ProjectNavBar />
      <div className="flex-1 overflow-auto pt-2">
        <Outlet />
      </div>
    </div>
  );
}
