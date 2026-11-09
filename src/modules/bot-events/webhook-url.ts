import { AppError } from '../../middleware/errorHandler';
import { assertPublicUrl } from '../automation/webhook';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Check the URL a bot's events are sent to: HTTPS, no credentials, no private address. The one
 * exception is for development: plain HTTP to localhost, 127.0.0.1 or [::1] when
 * AXIOM_BOT_WEBHOOK_ALLOW_LOCAL=1 and NODE_ENV is not production.
 * @param url - The URL
 * @throws {AppError} 400 when the URL is refused
 */
export async function assertWebhookUrl(url: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production' && process.env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL === '1') {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      // assertPublicUrl names the problem
    }
    if (parsed && parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) {
      if (parsed.username || parsed.password) {
        throw new AppError(400, 'Webhook URLs must not contain credentials');
      }
      return;
    }
  }
  await assertPublicUrl(url, 'Webhook');
}
