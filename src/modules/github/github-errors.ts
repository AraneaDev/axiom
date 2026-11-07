import { Prisma } from '@prisma/client';

import { SecretBoxError } from '../../lib/secret-box';
import { AppError } from '../../middleware/errorHandler';

/** Who a failed call was made as: decides what a 401 means for the caller */
export type GithubAuthKind = 'app' | 'installation' | 'user' | 'oauth-app' | 'token' | 'none';

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

// The user:password part of a URL, whatever the secret looks like
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

// C1 controls and format characters (bidi overrides, zero-width): they make text look like other text

const HIDDEN_CHARACTERS = /[\u0080-\u009f\p{Cf}]/gu;

/**
 * Text from GitHub with every credential taken out: the one this call sent, anything shaped
 * like a GitHub token or a JWT, and the user:password of any URL. C1 controls and invisible
 * format characters are dropped. GitHub's error bodies are not ours, and some echo input back.
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
  clean = clean.replace(URL_CREDENTIALS, '$1[redacted]@').replace(HIDDEN_CHARACTERS, '');
  return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH)}...` : clean;
}

const MAX_REASON_LENGTH = 300;

/**
 * GitHub's reason for a refusal as plain text to append to a fixed message: tags and control
 * characters gone, white space collapsed, cut to 300 characters. It is built from the scrubbed
 * message, so it holds no token, and never from headers.
 * @param message GitHub's scrubbed message
 */
function plainReason(message: string): string {
  const plain = message
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f<>]+/g, ' ')
    .replace(HIDDEN_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REASON_LENGTH)
    .trim();
  return plain ? ` GitHub says: ${plain}` : '';
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
    // A person's token: their connection is what GitHub refused. The App's own calls, and its
    // client secret (oauth-app), blame the App.
    return kind === 'user' || kind === 'token'
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
        `GitHub refused this request: the connection has no access to it.${plainReason(message)}`,
        'GITHUB_FORBIDDEN',
      );
    case 404:
      return new AppError(
        404,
        'GitHub has no such resource, or this connection cannot see it.',
        'GITHUB_NOT_FOUND',
      );
    case 410:
      return new AppError(410, 'GitHub no longer has this resource.', 'GITHUB_GONE');
    case 405:
      // Not a 405 of ours: that would tell a client the route's method is wrong
      return new AppError(
        409,
        `GitHub does not allow this right now.${plainReason(message)}`,
        'GITHUB_NOT_ALLOWED',
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
  'redirected-off-host':
    'GitHub redirected the request with its body to another host, so it was not followed.',
} as const;

/**
 * The AppError for a call without a usable answer: a timeout, a network failure, a body that
 * breaks off or does not parse, a next page on another host, or a redirect that would carry
 * a body to another host. The cause is not attached, so
 * nothing of the request rides along.
 * @param reason What went wrong
 */
export function githubUnavailable(reason: keyof typeof UNAVAILABLE_MESSAGES): AppError {
  return new AppError(502, UNAVAILABLE_MESSAGES[reason], 'GITHUB_UNAVAILABLE');
}

/**
 * The id of a GitHub row as JSON carries it. GitHub's ids are 64 bit and stored as BigInt; one
 * that a JSON number holds exactly (up to 2^53 - 1) is a number, a larger one is a string.
 * @param id The stored id
 */
export const githubIdJson = (id: bigint): number | string =>
  id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id.toString();

/**
 * Runs a read of a stored GitHub secret. One that does not open (the key changed, or the row
 * was restored without it) answers a coded 409 the admin can act on, not a bare 500.
 * @param read Opens the secret
 */
export function openGithubSecret<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    if (!(err instanceof SecretBoxError)) throw err;
    throw new AppError(
      409,
      'A stored GitHub secret cannot be read with the configured encryption key. Restore the key, or forget the GitHub App and set it up again',
      'GITHUB_SECRET_UNREADABLE',
    );
  }
}

/**
 * Whether a database call failed on a unique key: two writers raced to create the same row.
 * @param err What was thrown
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
