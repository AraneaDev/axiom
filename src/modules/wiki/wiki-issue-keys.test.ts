// Which issue keys in a page body link the page to the issue: the keys a reader sees as text.
// A key in code is shown as written and links nothing; a key in plain text, a table, the editor's
// HTML table fallback or a pasted <details> block is text and links.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';

import { writePageBody } from './page-writes';
import { createPage } from './wiki.service';

let ctx: TestContext;
let spaceId: string;
let issueId: string;
let key: string;
let pages = 0;

beforeAll(async () => {
  ctx = await createTestContext('wkey');
  spaceId = (
    await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Keys', slug: 'keys-wkey' },
    })
  ).id;
  issueId = (
    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'Linked',
        body: '',
        creatorId: ctx.owner.id,
      },
    })
  ).id;
  key = `${ctx.projectPrefix}-1`;
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

/**
 * Writes a page with this body and answers whether it links the issue.
 * @param body The page body
 */
async function links(body: string): Promise<boolean> {
  pages++;
  const page = await createPage(spaceId, ctx.owner.id, {
    title: `Page ${pages}`,
    slug: `page-${pages}`,
    body,
  });
  const found = await prisma.wikiPageIssueLink.count({
    where: { pageId: page.id, issueId, linkType: 'MENTION' },
  });
  return found > 0;
}

describe('issue keys in a page body', () => {
  it('links a key in plain text and in a table', async () => {
    expect(await links(`Fixed in ${key} today.`)).toBe(true);
    expect(await links(`| issue | state |\n| --- | --- |\n| ${key} | done |`)).toBe(true);
  });

  it('links a key in an HTML table and in a details block', async () => {
    expect(
      await links(
        `<table><tbody><tr><td><p>${key}</p><p>second paragraph</p></td></tr></tbody></table>`,
      ),
    ).toBe(true);
    expect(await links(`<details><summary>More</summary>\n\nSee ${key}\n\n</details>`)).toBe(true);
    expect(await links(`<div>\nSee ${key}\n</div>`)).toBe(true);
  });

  it('does not link a key in code', async () => {
    expect(await links(`Run \`${key}\` as written.`)).toBe(false);
    expect(await links(`\`\`\`\n${key}\n\`\`\``)).toBe(false);
    expect(await links(`<pre>\n${key}\n</pre>`)).toBe(false);
    expect(await links(`<div>\n<code>${key}</code>\n</div>`)).toBe(false);
  });

  it('keeps the link when a key moves into an HTML table', async () => {
    pages++;
    const page = await createPage(spaceId, ctx.owner.id, {
      title: `Page ${pages}`,
      slug: `page-${pages}`,
      body: `See ${key}`,
    });
    await writePageBody({
      pageId: page.id,
      authorId: ctx.owner.id,
      body: `<table><tbody><tr><td><p>${key}</p><p>merged</p></td></tr></tbody></table>`,
      kind: 'EDIT',
      source: 'api',
    });
    const found = await prisma.wikiPageIssueLink.count({
      where: { pageId: page.id, issueId, linkType: 'MENTION' },
    });
    expect(found).toBe(1);
  });
});
