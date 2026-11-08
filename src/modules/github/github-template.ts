import type { GithubTriggerContext } from './github-automation';

const TITLE_MAX = 200;
const NAME_MAX = 100;
const MARKDOWN_SPECIAL = /[&\\`*_{}[\]()#+\-.!|<>@^~:]/g;

/**
 * GitHub's text as literal Markdown text: one line, cut to length, every Markdown character
 * escaped, so it renders as itself (no image, link, mention or issue link).
 * @param text GitHub's text
 * @param max The longest text kept, in characters
 * @param markdown Whether to escape it for Markdown
 */
export function literal(text: string, max: number, markdown: boolean): string {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, max);
  if (!markdown) return line;
  return line.replace(MARKDOWN_SPECIAL, (c) => `\\${c}`);
}

// Only the https URLs the stores made are kept
const httpsUrl = (url: string): string => (/^https:\/\/[^\s<>"]+$/.test(url) ? url : '');

/**
 * The GitHub part of a template context, made safe for Markdown-bound actions: every string but
 * the URLs is escaped, one line and cut (titles at 200 characters, other text at 100); a URL that
 * is not an https URL is dropped.
 * @param github What the event was
 * @param markdown Whether the text goes where Markdown renders (a comment body, a description);
 *   elsewhere (an email, a title, a field, a webhook) it stays as GitHub wrote it, on one line
 */
export function safeGithubContext(
  github: GithubTriggerContext,
  markdown: boolean,
): GithubTriggerContext {
  const name = (text: string) => literal(text, NAME_MAX, markdown);
  const out: GithubTriggerContext = {
    trigger: github.trigger,
    repo: name(github.repo),
    actorLogin: name(github.actorLogin),
  };
  const { pr, review, checks, branch } = github;
  if (pr) {
    out.pr = {
      number: pr.number,
      title: literal(pr.title, TITLE_MAX, markdown),
      url: httpsUrl(pr.url),
      state: name(pr.state),
      draft: pr.draft,
      author: name(pr.author),
      headRef: name(pr.headRef),
      baseRef: name(pr.baseRef),
      headSha: name(pr.headSha),
    };
  }
  if (review) {
    out.review = {
      author: name(review.author),
      state: name(review.state),
      url: httpsUrl(review.url),
    };
  }
  if (checks) {
    out.checks = {
      headSha: name(checks.headSha),
      failedNames: name(checks.failed.map((r) => r.name).join(', ')),
      failed: checks.failed.map((r) => ({
        name: name(r.name),
        failedStep: r.failedStep === null ? null : name(r.failedStep),
        url: httpsUrl(r.url),
      })),
    };
  }
  if (branch) out.branch = { name: name(branch.name), url: httpsUrl(branch.url) };
  return out;
}
