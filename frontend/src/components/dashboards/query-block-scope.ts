import { createContext } from 'react';

/**
 * Says a live block may run here, and in which page. A renderer outside one, as for a comment or an
 * issue, shows the block's line as text. A page that has no id yet has a scope without one. `editing` says the page may
 * hold unsaved text, which a reload would lose.
 */
export const QueryBlockScope = createContext<{ pageId?: string; editing?: boolean } | null>(null);
