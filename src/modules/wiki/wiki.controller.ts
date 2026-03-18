import { Request, Response, NextFunction } from 'express';

import { PANDOC_FORMATS, checkPandocInstalled, convertMarkdown } from '../../utils/pandoc';
import { param } from '../../utils/params';
import {
  createWikiSpaceSchema,
  createPageSchema,
  updatePageSchema,
  createPageTemplateSchema,
  createPageCommentSchema,
  addPageLabelSchema,
  movePageSchema,
  copyPageSchema,
} from '../../utils/validation';

import * as wikiService from './wiki.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createWikiSpaceSchema.parse(req.body);
    const space = await wikiService.createSpace(param(req, 'teamId'), data);
    res.status(201).json(space);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const space = await wikiService.getSpace(param(req, 'spaceId'));
    res.json(space);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listSpaces(req: Request, res: Response, next: NextFunction) {
  try {
    const spaces = await wikiService.listSpaces(param(req, 'teamId'));
    res.json(spaces);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createPage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPageSchema.parse(req.body);
    const page = await wikiService.createPage(param(req, 'spaceId'), req.userId!, data);
    res.status(201).json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getPage(req: Request, res: Response, next: NextFunction) {
  try {
    const page = await wikiService.getPage(param(req, 'spaceId'), param(req, 'pageSlug'));
    res.json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function updatePage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updatePageSchema.parse(req.body);
    const page = await wikiService.updatePage(
      param(req, 'spaceId'),
      param(req, 'pageSlug'),
      req.userId!,
      data,
    );
    res.json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deletePage(req: Request, res: Response, next: NextFunction) {
  try {
    await wikiService.deletePage(param(req, 'spaceId'), param(req, 'pageSlug'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function pageHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const versions = await wikiService.getPageHistory(
      param(req, 'spaceId'),
      param(req, 'pageSlug'),
    );
    res.json(versions);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function exportPage(req: Request, res: Response, next: NextFunction) {
  try {
    const format = (req.query.format as string) || 'html';
    if (!PANDOC_FORMATS[format]) {
      res
        .status(400)
        .json({
          error: {
            message: `Unsupported format: ${format}. Supported: ${Object.keys(PANDOC_FORMATS).join(', ')}`,
          },
        });
      return;
    }

    const installed = await checkPandocInstalled();
    if (!installed) {
      res.status(501).json({ error: { message: 'pandoc is not installed on the server' } });
      return;
    }

    const page = await wikiService.getPage(param(req, 'spaceId'), param(req, 'pageSlug'));
    await convertMarkdown(page.body ?? '', page.title, format, res);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function pageTree(req: Request, res: Response, next: NextFunction) {
  try {
    const tree = await wikiService.getPageTree(param(req, 'spaceId'));
    res.json(tree);
  } catch (err) {
    next(err);
  }
}

// ─── Templates ──────────────────────────────────────────────

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPageTemplateSchema.parse(req.body);
    const template = await wikiService.createTemplate(param(req, 'spaceId'), data);
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listTemplates(req: Request, res: Response, next: NextFunction) {
  try {
    const templates = await wikiService.listTemplates(param(req, 'spaceId'));
    res.json(templates);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const template = await wikiService.getTemplate(param(req, 'templateId'));
    res.json(template);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deleteTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    await wikiService.deleteTemplate(param(req, 'templateId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─── Page Comments ──────────────────────────────────────────

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function addPageComment(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPageCommentSchema.parse(req.body);
    const comment = await wikiService.addPageComment(
      param(req, 'pageId'),
      req.userId!,
      data.body,
      data.anchorText,
    );
    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listPageComments(req: Request, res: Response, next: NextFunction) {
  try {
    const comments = await wikiService.listPageComments(param(req, 'pageId'));
    res.json(comments);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function resolveComment(req: Request, res: Response, next: NextFunction) {
  try {
    const comment = await wikiService.resolveComment(param(req, 'commentId'));
    res.json(comment);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deletePageComment(req: Request, res: Response, next: NextFunction) {
  try {
    await wikiService.deletePageComment(param(req, 'commentId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─── Page Labels ────────────────────────────────────────────

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function addPageLabel(req: Request, res: Response, next: NextFunction) {
  try {
    const data = addPageLabelSchema.parse(req.body);
    const label = await wikiService.addLabel(param(req, 'pageId'), data.label);
    res.status(201).json(label);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function removePageLabel(req: Request, res: Response, next: NextFunction) {
  try {
    const label = decodeURIComponent(param(req, 'label'));
    await wikiService.removeLabel(param(req, 'pageId'), label);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function searchByLabel(req: Request, res: Response, next: NextFunction) {
  try {
    const label = req.query.label as string;
    if (!label) {
      res.status(400).json({ error: { message: 'label query parameter required' } });
      return;
    }
    const pages = await wikiService.searchPagesByLabel(param(req, 'spaceId'), label);
    res.json(pages);
  } catch (err) {
    next(err);
  }
}

// ─── Page Move / Copy ───────────────────────────────────────

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function movePage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = movePageSchema.parse(req.body);
    const page = await wikiService.movePage(
      param(req, 'pageId'),
      data.targetSpaceId,
      data.targetParentId,
    );
    res.json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function copyPage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = copyPageSchema.parse(req.body);
    const page = await wikiService.copyPage(
      param(req, 'pageId'),
      req.userId!,
      data.targetSpaceId,
      data.newSlug,
    );
    res.status(201).json(page);
  } catch (err) {
    next(err);
  }
}
