/**
 * Live blocks in wiki pages. Reading a page gives you what it embeds, evaluated with your own
 * rights, whoever may open the dashboard or saved query itself: that page's author chose to show
 * it to the page's readers. So what comes back is limited to widget titles and results: no query
 * text and nothing about who it is shared with.
 */
import type { DashboardWidget } from '@prisma/client';

import type { ActionContext } from '../../actions/define';
import { READS_BUSY, readSlots } from '../../actions/read.service';
import { prisma } from '../../config/database';
import { parseQueryEmbedTarget, queryEmbedsIn } from '../../lib/editor-core';
import { AppError } from '../../middleware/errorHandler';
import { assertPageAccess } from '../../middleware/rbac';
import { scopeAllows } from '../../middleware/token-scopes';
import { embeddedTextToRun } from '../saved-filters/saved-filters.service';

import {
  hiddenWidgetError,
  limitRender,
  renderWidgets,
  widgetError,
  widgetsOf,
  type RenderRules,
  type WidgetRow,
} from './dashboards.service';

/** Room for an inline query at query.run's cap of 1000, quoted as JSON */
export const EMBED_ID_MAX = 8000;
const INLINE_QUERY_MAX = 1000;

const notOnPage = () => new AppError(404, 'This block is not on this page');

/**
 * Throw unless the caller may read the page. A page they cannot read answers as one that does not
 * exist. A token also needs wiki:read, as the answer depends on the page's body.
 * @param ctx - The reader
 * @param pageId - The page
 * @throws {AppError} 403 SCOPE; 404
 */
export async function assertEmbedReadable(ctx: ActionContext, pageId: string): Promise<void> {
  if (ctx.scopes && !scopeAllows(ctx.scopes, 'wiki', 'read')) {
    throw new AppError(403, 'This API token does not have the scope for this request', 'SCOPE');
  }
  try {
    await assertPageAccess(ctx.userId, pageId, 'view');
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      throw new AppError(404, 'Wiki page not found');
    }
    throw err;
  }
}

/**
 * A single block's query as a widget, for what shows one table.
 * @param source - Where it gets its data
 * @param source.savedQueryId
 * @param source.query
 */
function queryWidget(source: Pick<DashboardWidget, 'savedQueryId' | 'query'>): WidgetRow {
  return { id: 'block', type: 'TABLE', title: 'Query', options: {}, position: 0, ...source };
}

/**
 * Render a live block for someone who may read its page: the embed must be in the page's current
 * body, by the same parse the editor does. Counts once against the dashboards' render limit and
 * takes one read slot, whichever of the three it is.
 * @param ctx - The reader, already through assertEmbedReadable
 * @param pageId - The page
 * @param embedId - The block's target as written in the Markdown
 * @returns Widget titles and results with the reader's rights, and the projects to follow
 * @throws {AppError} 404 when the block is not in the body or what it names is gone; 429 past the
 * limit or the read cap
 */
export async function renderEmbedded(ctx: ActionContext, pageId: string, embedId: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { body: true } });
  // The parse is the costly part: most wrong guesses do not get that far
  if (!page?.body.includes(embedId) || !queryEmbedsIn(page.body).includes(embedId)) {
    throw notOnPage();
  }
  const target = parseQueryEmbedTarget(embedId);
  if (!target) throw notOnPage();

  await limitRender(ctx.userId);
  return readSlots.run(ctx.userId, READS_BUSY, async () => {
    const hidden: RenderRules = {
      savedText: embeddedTextToRun,
      errorOf: (widget, err) => hiddenWidgetError(widget.id, err),
    };
    switch (target.kind) {
      case 'dashboard': {
        const dashboard = await prisma.dashboard.findUnique({
          where: { id: target.id },
          select: { id: true },
        });
        if (!dashboard) throw notOnPage();
        return renderWidgets(ctx, await widgetsOf(target.id), hidden);
      }
      case 'savedQuery':
        return renderWidgets(ctx, [queryWidget({ savedQueryId: target.id, query: null })], hidden);
      case 'inline':
        // Its text is in the page they are reading, so the language's messages tell them nothing new
        if (target.query.length > INLINE_QUERY_MAX) {
          throw new AppError(400, 'This query is too long', 'INVALID_QUERY');
        }
        return renderWidgets(ctx, [queryWidget({ savedQueryId: null, query: target.query })], {
          ...hidden,
          errorOf: (widget, err) => widgetError(widget.id, err),
        });
    }
  });
}
