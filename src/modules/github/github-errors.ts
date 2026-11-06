import { AppError } from '../../middleware/errorHandler';

/** Who a failed call was made as: decides what a 401 means for the caller */
export type GithubAuthKind = 'app' | 'installation' | 'user' | 'none';

/** Seconds to wait when GitHub names no time, as its docs advise for secondary limits */
const DEFAULT_RETRY_SECONDS = 60;
const MAX_MESSAGE_LENGTH = 500;

// GitHub token formats (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_) and JWTs, which an error
// body may echo back
const TOKEN_PATTERNS = [
  /\bgh[opusr]_[A-Za-z0-9_]+/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\beyJ[\w-]*\.[\w-]+\.[\w-]+/g,
];

/**
 * Text from GitHub with every credential taken out: the one this call sent, anything shaped
 * like a GitHub token or a JWT. GitHub's error bodies are not ours, and some echo input back.
 * @param text The text GitHub sent
 * @param credential The Authorization value this call sent, if any
 */
export function scrubGithubText(text: string, credential?: string): string {
  let clean = text;
  if (credential) {
    // The scheme ("token", "Bearer") is no secret, the value after it is
    const value = credential.replace(/^\S+\s+/, '');
    if (value) clean = clean.split(value).join('[redacted]');
  }
  for (const pattern of TOKEN_PATTERNS) clean = clean.replace(pattern, '[redacted]');
  return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH)}...` : clean;
}

/**
 * GitHub's own words: its `message`, with the messages of its `errors` list after it
 * @param body
 */
function githubMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body : '';
  const { message, errors } = body as { message?: unknown; errors?: unknown };
  const parts = typeof message === 'string' && message ? [message] : [];
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof (item as { message?: unknown }).message === 'string') {
        parts.push((item as { message: string }).message);
      }
    }
  }
  return parts.join(': ');
}

function retryAfterSeconds(headers: Headers, now: number): number {
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter);
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(1, Math.ceil(reset - now / 1000));
  return DEFAULT_RETRY_SECONDS;
}

function isRateLimited(status: number, headers: Headers, message: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return headers.get('x-ratelimit-remaining') === '0' || /secondary rate limit/i.test(message);
}

/**
 * The AppError for a GitHub answer that was not a success. Its message is never built from
 * request headers, and GitHub's text in it is scrubbed of credentials.
 * @param kind Who the call was made as
 * @param status GitHub's status
 * @param headers GitHub's response headers
 * @param body GitHub's parsed body (JSON or text)
 * @param credential The Authorization value the call sent, to scrub from GitHub's text
 */
export function githubError(
  kind: GithubAuthKind,
  status: number,
  headers: Headers,
  body: unknown,
  credential?: string,
): AppError {
  const message = scrubGithubText(githubMessage(body), credential);

  if (isRateLimited(status, headers, message)) {
    const seconds = retryAfterSeconds(headers, Date.now());
    return new AppError(
      503,
      `GitHub's rate limit was reached. Try again in ${seconds} seconds.`,
      'GITHUB_RATE_LIMITED',
      { retryAfterSeconds: seconds },
    );
  }
  if (status === 401 || (status === 403 && /bad credentials/i.test(message))) {
    return kind === 'user'
      ? new AppError(
          409,
          'Your GitHub connection expired. Connect GitHub again in Settings.',
          'GITHUB_RECONNECT',
        )
      : new AppError(
          502,
          'GitHub refused the credentials of the GitHub App. Check the App in the admin settings.',
          'GITHUB_APP_AUTH',
        );
  }
  switch (status) {
    case 403:
      return new AppError(
        403,
        'GitHub refused this request: the connection has no access to it.',
        'GITHUB_FORBIDDEN',
      );
    case 404:
      return new AppError(
        404,
        'GitHub has no such resource, or this connection cannot see it.',
        'GITHUB_NOT_FOUND',
      );
    case 409:
      return new AppError(
        409,
        message ? `GitHub reported a conflict: ${message}` : 'GitHub reported a conflict.',
        'GITHUB_CONFLICT',
      );
    case 422:
      return new AppError(
        422,
        message ? `GitHub rejected the request: ${message}` : 'GitHub rejected the request.',
        'GITHUB_INVALID',
      );
    default:
      return new AppError(502, `GitHub answered with status ${status}.`, 'GITHUB_UNAVAILABLE');
  }
}

const UNAVAILABLE_MESSAGES = {
  timeout: 'GitHub did not answer in time.',
  unreachable: 'Could not reach GitHub.',
  unreadable: 'GitHub answered, but the answer could not be read.',
  'off-host': 'GitHub pointed the next page at another host, so it was not fetched.',
} as const;

/**
 * The AppError for a call without a usable answer: a timeout, a network failure, a body that
 * breaks off or does not parse, or a next page on another host. The cause is not attached, so
 * nothing of the request rides along.
 * @param reason What went wrong
 */
export function githubUnavailable(reason: keyof typeof UNAVAILABLE_MESSAGES): AppError {
  return new AppError(502, UNAVAILABLE_MESSAGES[reason], 'GITHUB_UNAVAILABLE');
}
