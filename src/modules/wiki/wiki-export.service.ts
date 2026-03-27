// NOTE: This service intentionally accepts an Express Response parameter.
// The pandoc conversion streams binary data (PDF, DOCX, EPUB) directly to the
// HTTP response via child_process stdout.pipe(res). Buffering the entire output
// would break large exports and negate the streaming benefit. This is an
// accepted exception to the "services never touch req/res" rule.
import type { Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { PANDOC_FORMATS, checkPandocInstalled, convertMarkdown } from '../../utils/pandoc';

import { getPage } from './wiki.service';

/**
 * Export a wiki page in the specified format using pandoc.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param format - The export format (html, docx, epub, pdf, latex, plain)
 * @param res - Express response to pipe the export into (intentional exception -- see note above)
 * @throws {AppError} 400 if format is unsupported
 * @throws {AppError} 501 if pandoc is not installed
 * @throws {AppError} 404 if page not found
 */
const SUPPORTED_FORMATS = [...Object.keys(PANDOC_FORMATS), 'md'];

/**
 *
 * @param spaceId
 * @param pageSlug
 * @param format
 * @param res
 */
export async function exportPage(spaceId: string, pageSlug: string, format: string, res: Response) {
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new AppError(
      400,
      `Unsupported format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`,
    );
  }

  const page = await getPage(spaceId, pageSlug);

  // Markdown needs no conversion -- serve the raw body directly
  if (format === 'md') {
    const slug = page.slug || 'page';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.md"`);
    res.send(page.body ?? '');
    return;
  }

  const installed = await checkPandocInstalled();
  if (!installed) {
    throw new AppError(501, 'pandoc is not installed on the server');
  }

  await convertMarkdown(page.body ?? '', page.title, format, res);
}
