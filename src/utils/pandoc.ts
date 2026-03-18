import { spawn, execFile } from 'child_process';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Response } from 'express';

interface FormatInfo {
  mime: string;
  ext: string;
  binary: boolean;
}

const MERMAID_BLOCK_RE = /```mermaid\n([\s\S]*?)```/g;

async function renderMermaidToImage(code: string): Promise<Buffer | null> {
  const payload = JSON.stringify({ code: code.trim(), mermaid: { theme: 'default' } });
  const encoded = Buffer.from(payload).toString('base64');
  try {
    const res = await fetch(`https://mermaid.ink/img/${encoded}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Verify it's a JPEG (starts with FF D8)
    if (buf.length < 100 || (buf[0] !== 0xff && buf[0] !== 0x89)) return null;
    return buf;
  } catch {
    return null;
  }
}

async function preprocessMermaid(
  markdown: string,
  format: string,
): Promise<{ markdown: string; tempDir?: string }> {
  if (format === 'html') {
    // For HTML, use client-side mermaid.js rendering
    const processed = markdown.replace(MERMAID_BLOCK_RE, (_match, code: string) => {
      return `<pre class="mermaid">\n${code.trim()}\n</pre>`;
    });
    return { markdown: processed };
  }

  // For non-HTML formats, render mermaid blocks to SVG images via mermaid.ink
  const blocks: { placeholder: string; code: string }[] = [];
  let idx = 0;
  const withPlaceholders = markdown.replace(MERMAID_BLOCK_RE, (_match, code: string) => {
    const placeholder = `__MERMAID_${idx++}__`;
    blocks.push({ placeholder, code });
    return placeholder;
  });

  if (!blocks.length) return { markdown };

  const tempDir = await mkdtemp(join(tmpdir(), 'mermaid-'));
  let result = withPlaceholders;

  await Promise.all(
    blocks.map(async (block, i) => {
      const img = await renderMermaidToImage(block.code);
      if (img) {
        const imgPath = join(tempDir, `diagram-${i}.jpg`);
        await writeFile(imgPath, img);
        result = result.replace(block.placeholder, `![Diagram](${imgPath})`);
      } else {
        // Fallback: keep as labeled code block
        result = result.replace(
          block.placeholder,
          `**[Diagram]**\n\n\`\`\`\n${block.code.trim()}\n\`\`\``,
        );
      }
    }),
  );

  return { markdown: result, tempDir };
}

const MERMAID_HTML_FOOTER = `
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true});</script>
`;

export const PANDOC_FORMATS: Record<string, FormatInfo> = {
  html: { mime: 'text/html', ext: '.html', binary: false },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
    binary: true,
  },
  epub: { mime: 'application/epub+zip', ext: '.epub', binary: true },
  latex: { mime: 'application/x-latex', ext: '.tex', binary: false },
  pdf: { mime: 'application/pdf', ext: '.pdf', binary: true },
  rst: { mime: 'text/x-rst', ext: '.rst', binary: false },
  org: { mime: 'text/x-org', ext: '.org', binary: false },
  plain: { mime: 'text/plain', ext: '.txt', binary: false },
};

/**
 *
 */
export function checkPandocInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('pandoc', ['--version'], (err) => {
      resolve(!err);
    });
  });
}

/**
 *
 * @param markdown
 * @param title
 * @param format
 * @param res
 */
export async function convertMarkdown(
  markdown: string,
  title: string,
  format: string,
  res: Response,
): Promise<void> {
  const info = PANDOC_FORMATS[format];
  if (!info) {
    res.status(400).json({ error: { message: `Unsupported format: ${format}` } });
    return;
  }

  // Pre-render mermaid diagrams to SVG images for non-HTML formats
  const { markdown: processed, tempDir } = await preprocessMermaid(markdown, format);

  return new Promise((resolve, reject) => {
    const args = ['-f', 'markdown', '-t', format === 'plain' ? 'plain' : format, '--standalone'];

    if (title) {
      args.push('--metadata', `title=${title}`);
    }

    if (format === 'pdf') {
      args.push('--pdf-engine=weasyprint');
    }

    const child = spawn('pandoc', args);

    let stderrData = '';

    child.stderr.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      cleanup();
      if (err.code === 'ENOENT') {
        res.status(501).json({ error: { message: 'pandoc is not installed on the server' } });
        return resolve();
      }
      reject(err);
    });

    function cleanup() {
      if (tempDir) rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    child.on('close', (code) => {
      cleanup();
      if (code !== 0 && !res.headersSent) {
        if (stderrData.includes('weasyprint') && stderrData.includes('not found')) {
          res.status(501).json({
            error: { message: 'PDF export requires weasyprint which is not installed' },
          });
        } else {
          res.status(500).json({
            error: { message: `pandoc exited with code ${code}: ${stderrData.trim()}` },
          });
        }
        return resolve();
      }
      if (code === 0) {
        res.end();
      }
      resolve();
    });

    const safeFilename = title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'export';

    res.setHeader('Content-Type', info.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}${info.ext}"`);

    if (format === 'html') {
      // Collect output, inject mermaid script before </body>, then send
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stdout.on('end', () => {
        if (!res.headersSent) {
          let html = Buffer.concat(chunks).toString();
          html = html.replace('</body>', MERMAID_HTML_FOOTER + '</body>');
          res.write(html);
        }
      });
    } else {
      child.stdout.pipe(res, { end: false });
    }

    child.stdin.write(processed);
    child.stdin.end();
  });
}
