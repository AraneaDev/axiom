import { Outlet } from 'react-router';

import { ProjectNavBar } from './ProjectNavBar';

/**
 *
 */
export function ProjectLayout() {
  return (
    <div className="flex flex-col h-full">
      <ProjectNavBar />
      <div className="flex-1 overflow-auto pt-2">
        <Outlet />
      </div>
    </div>
  );
}
