import { createHmac, randomUUID } from 'node:crypto';

import request from 'supertest';

import app from '../index';
import { getGithubAppSecrets } from '../modules/github/github-app.service';

/**
 * Sends a webhook delivery as GitHub would: signed over the exact bytes of the body, with no CSRF
 * header and no credential.
 * @param event The `X-GitHub-Event` name
 * @param payload The payload, sent as JSON unless `rawBody` is given
 * @param opts The delivery id (random by default), the secret to sign with (the App's by default)
 *   and the exact body to send and sign
 * @param opts.deliveryId
 * @param opts.secret
 * @param opts.rawBody
 * @returns The response
 */
export async function postWebhook(
  event: string,
  payload: unknown,
  opts: { deliveryId?: string; secret?: string; rawBody?: string } = {},
): Promise<request.Response> {
  const body = opts.rawBody ?? JSON.stringify(payload);
  const secret = opts.secret ?? (await getGithubAppSecrets())?.webhookSecret ?? 'no-app';
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return request(app)
    .post('/api/github/webhook')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', event)
    .set('X-GitHub-Delivery', opts.deliveryId ?? randomUUID())
    .set('X-Hub-Signature-256', signature)
    .send(body);
}
