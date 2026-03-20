import { Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { PANDOC_FORMATS, checkPandocInstalled, convertMarkdown } from '../../utils/pandoc';

import { getPage } from './wiki.service';

/**
 * Export a wiki page in the specified format using pandoc.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param format - The export format (html, docx, epub, pdf, latex, plain)
 * @param res - Express response to pipe the export into
 * @throws {AppError} 400 if format is unsupported
 * @throws {AppError} 501 if pandoc is not installed
 * @throws {AppError} 404 if page not found
 */
export async function exportPage(spaceId: string, pageSlug: string, format: string, res: Response) {
  if (!PANDOC_FORMATS[format]) {
    throw new AppError(
      400,
      `Unsupported format: ${format}. Supported: ${Object.keys(PANDOC_FORMATS).join(', ')}`,
    );
  }

  const installed = await checkPandocInstalled();
  if (!installed) {
    throw new AppError(501, 'pandoc is not installed on the server');
  }

  const page = await getPage(spaceId, pageSlug);
  await convertMarkdown(page.body ?? '', page.title, format, res);
}
