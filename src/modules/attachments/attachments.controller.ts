import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as attachmentsService from './attachments.service';

export const upload = asyncHandler(async (req: Request, res: Response) => {
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
});

export const download = asyncHandler(async (req: Request, res: Response) => {
  const { attachment, data } = await attachmentsService.downloadAttachment(param(req, 'id'));

  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Length', data.length);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
  );
  res.send(data);
});

export const getMeta = asyncHandler(async (req: Request, res: Response) => {
  const attachment = await attachmentsService.getAttachment(param(req, 'id'));
  res.json(attachment);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { issueId, pageId } = req.query as { issueId?: string; pageId?: string };
  const attachments = await attachmentsService.listAttachments({ issueId, pageId });
  res.json(attachments);
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  const result = await attachmentsService.preview(param(req, 'id'));
  if (result.type === 'redirect') {
    res.redirect(`/api/attachments/${param(req, 'id')}`);
  } else if (result.type === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(result.content);
  } else {
    res.setHeader('Content-Type', result.mimeType);
    res.send(result.content);
  }
});

export const convertToMarkdown = asyncHandler(async (req: Request, res: Response) => {
  const result = await attachmentsService.convertToMarkdown(param(req, 'id'));
  res.json(result);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  await attachmentsService.deleteAttachment(param(req, 'id'), req.userId);
  res.status(204).send();
});
