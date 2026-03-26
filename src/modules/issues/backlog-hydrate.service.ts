import { settled } from '../../utils/settled';
import { listSprints, getBacklog, getVelocity } from '../sprints/sprints.service';

/**
 * Hydrate the Backlog view in a single call.
 * Fetches sprints, backlog issues, and velocity data in parallel.
 * @param projectId - The project to hydrate backlog for
 */
export async function hydrateBacklog(projectId: string) {
  const results = await Promise.allSettled([
    listSprints(projectId),
    getBacklog(projectId),
    getVelocity(projectId),
  ]);

  return {
    sprints: settled(results[0], 'sprints'),
    backlogIssues: settled(results[1], 'backlogIssues'),
    velocity: settled(results[2], 'velocity'),
  };
}
