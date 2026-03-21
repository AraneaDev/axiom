import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';

import * as attachmentsService from './attachments.service';

/**
 * POST / -- upload a single file (multipart/form-data, field: 'file')
 * @param req
 * @param res
 * @param next
 */
export async function upload(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError(400, 'No file provided', 'MISSING_FILE');
    if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');

    const { issueId, pageId, commentId } = req.body as {
      issueId?: string;
      pageId?: string;
      commentId?: string;
    };

    const attachment = await attachmentsService.uploadAttachment(req.file, req.userId, {
      issueId,
      pageId,
      commentId,
    });

    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:id -- download file with correct Content-Type
 * @param req
 * @param res
 * @param next
 */
export async function download(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    const { attachment, data } = await attachmentsService.downloadAttachment(req.params.id);

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', data.length);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
    );
    res.send(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:id/meta -- get metadata only
 * @param req
 * @param res
 * @param next
 */
export async function getMeta(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    const attachment = await attachmentsService.getAttachment(req.params.id);
    res.json(attachment);
  } catch (err) {
    next(err);
  }
}

/**
 * GET / -- list attachments (query: issueId, pageId)
 * @param req
 * @param res
 * @param next
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { issueId, pageId } = req.query as { issueId?: string; pageId?: string };
    const attachments = await attachmentsService.listAttachments({ issueId, pageId });
    res.json(attachments);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:id/preview -- preview attachment content
 * @param req
 * @param res
 * @param next
 */
export async function preview(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    const result = await attachmentsService.preview(req.params.id);
    if (result.type === 'redirect') {
      res.redirect(`/api/attachments/${req.params.id}`);
    } else if (result.type === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.send(result.content);
    } else {
      res.setHeader('Content-Type', result.mimeType);
      res.send(result.content);
    }
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:id/convert -- convert attachment to markdown
 * @param req
 * @param res
 * @param next
 */
export async function convertToMarkdown(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await attachmentsService.convertToMarkdown(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /:id -- delete attachment
 * @param req
 * @param res
 * @param next
 */
export async function remove(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
    await attachmentsService.deleteAttachment(req.params.id, req.userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
