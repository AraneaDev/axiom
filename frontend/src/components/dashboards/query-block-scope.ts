import { createContext } from 'react';

/**
 * Says a live block may run here, and in which page. A renderer outside one, as for a comment or an
 * issue, shows the block's line as text. A page that has no id yet has a scope without one.
 */
export const QueryBlockScope = createContext<{ pageId?: string } | null>(null);
