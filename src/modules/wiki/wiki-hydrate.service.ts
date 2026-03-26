import { settled } from '../../utils/settled';
import { listAttachments } from '../attachments/attachments.service';

import { listPageLabels } from './wiki-labels.service';
import { getPage, getPageHistory } from './wiki.service';

/**
 * Hydrate the Wiki Page view in a single call.
 * The primary page lookup is performed first (404 if not found).
 * All secondary queries fan out in parallel via Promise.allSettled so
 * partial failures degrade gracefully without blocking the response.
 * @param spaceId - The wiki space containing the page
 * @param pageSlug - The page slug within the space
 */
export async function hydrateWikiPage(spaceId: string, pageSlug: string) {
  // Primary lookup -- must succeed or 404
  const page = await getPage(spaceId, pageSlug);

  // page already includes children, so no need to fetch separately
  const pageId = page.id;

  // Fan out all secondary queries
  const results = await Promise.allSettled([
    listPageLabels(pageId),
    listAttachments({ pageId }),
    getPageHistory(spaceId, pageSlug),
  ]);

  // Limit history to 20 entries
  const historyRaw = settled(results[2], 'history');
  const history = historyRaw ? historyRaw.slice(0, 20) : null;

  return {
    page,
    labels: settled(results[0], 'labels'),
    attachments: settled(results[1], 'attachments'),
    history,
    children: page.children,
  };
}
